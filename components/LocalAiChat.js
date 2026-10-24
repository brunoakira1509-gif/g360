'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

const MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
const MAX_FACT_ROWS = 3000;
const MAX_HISTORY_MESSAGES = 8;
const fmt = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

function summarizeFacts(facts, dimensions) {
  const byPeriod = new Map();
  const byDimension = dimensions.map(() => new Map());
  for (const fact of facts) {
    byPeriod.set(fact.period, (byPeriod.get(fact.period) || 0) + Number(fact.value));
    dimensions.forEach((_, index) => {
      const key = fact[`d${index + 1}`];
      if (key) byDimension[index].set(key, (byDimension[index].get(key) || 0) + Number(fact.value));
    });
  }
  return {
    periods: [...byPeriod].map(([period, total]) => ({ period, total })).sort((a, b) => a.period.localeCompare(b.period)).slice(-36),
    dimensions: dimensions.map((name, index) => ({
      name,
      top: [...byDimension[index]].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, total]) => ({ label, total })),
    })),
  };
}

export default function LocalAiChat({ series }) {
  const engineRef = useRef(null);
  const mountedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([]);
  const contextRef = useRef(null);
  const seriesId = series?.id;
  const dims = useMemo(() => (series?.dims || []).slice(0, 3), [series?.dims]);

  useEffect(() => {
    setSupported(typeof navigator !== 'undefined' && !!navigator.gpu);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const engine = engineRef.current;
      engineRef.current = null;
      if (engine) {
        engine.unload().then(
          () => engine.worker?.terminate?.(),
          error => {
            console.error('Local AI engine cleanup failed:', error);
            engine.worker?.terminate?.();
          },
        );
      }
    };
  }, [seriesId]);

  async function loadModel() {
    if (engineRef.current || loading) return;
    if (!navigator.gpu) {
      setSupported(false);
      return;
    }
    setLoading(true);
    setStatus('Baixando e preparando o modelo local. Na primeira vez pode levar alguns minutos e usar bastante espaço.');
    let worker;
    try {
      const { CreateWebWorkerMLCEngine } = await import('@mlc-ai/web-llm');
      worker = new Worker(new URL('../lib/local-llm.worker.js', import.meta.url), { type: 'module' });
      const engine = await CreateWebWorkerMLCEngine(worker, MODEL_ID, {
        initProgressCallback: progress => setStatus(progress.text || 'Preparando o modelo local...'),
      });
      if (!mountedRef.current) {
        await engine.unload();
        worker.terminate();
        return null;
      }
      engineRef.current = engine;
      setStatus('Modelo pronto neste dispositivo.');
      return engine;
    } catch (error) {
      worker?.terminate();
      setStatus(`Não foi possível iniciar o modelo local: ${error.message || 'verifique o suporte WebGPU e a memória do dispositivo.'}`);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function getContext() {
    if (contextRef.current) return contextRef.current;
    setStatus('Carregando os dados agregados desta série no navegador...');
    const { count, error: countError } = await supabase
      .from('facts')
      .select('series_id', { count: 'exact', head: true })
      .eq('series_id', seriesId);
    if (countError) throw countError;
    const limit = Math.min(count || 0, MAX_FACT_ROWS);
    const facts = [];
    for (let offset = 0; offset < limit; offset += 1000) {
      const { data, error } = await supabase
        .from('facts')
        .select('period,d1,d2,d3,value,cnt')
        .eq('series_id', seriesId)
        .order('period')
        .range(offset, Math.min(offset + 999, limit - 1));
      if (error) throw error;
      facts.push(...(data || []));
    }
    contextRef.current = {
      series: { name: series.name, kind: series.kind },
      loadedRows: facts.length,
      totalRows: count || 0,
      truncated: (count || 0) > MAX_FACT_ROWS,
      summary: summarizeFacts(facts, dims),
    };
    return contextRef.current;
  }

  async function ask(e) {
    e.preventDefault();
    const text = question.trim();
    if (!text || sending) return;
    setQuestion('');
    setSending(true);
    setMessages(current => [...current, { role: 'user', content: text }]);
    try {
      const engine = engineRef.current || await loadModel();
      if (!engine) throw new Error('O modelo local não conseguiu iniciar. Verifique WebGPU, memória disponível e conexão para baixar o modelo.');
      const context = await getContext();
      setStatus('Analisando no seu dispositivo...');
      const conversation = [
        {
          role: 'system',
          content: `Você é um assistente de análise de dados em português do Brasil. Responda somente com base no resumo agregado fornecido; não invente nem afirme causalidade. Se o resumo não tiver detalhe suficiente, diga isso. O contexto contém dados de uma série do usuário, sem linhas originais da planilha. ${
            context.truncated ? `ATENÇÃO: o resumo foi calculado sobre ${context.loadedRows} de ${context.totalRows} linhas agregadas; informe essa limitação quando relevante.` : ''
          }\nResumo: ${JSON.stringify(context)}`,
        },
        ...messages.slice(-MAX_HISTORY_MESSAGES),
        { role: 'user', content: text },
      ];
      const response = await engine.chat.completions.create({
        messages: conversation,
        temperature: 0.2,
        max_tokens: 400,
      });
      const answer = response.choices?.[0]?.message?.content;
      if (!answer) throw new Error('O modelo não produziu resposta. Tente reformular a pergunta.');
      setMessages(current => [...current, { role: 'assistant', content: answer }]);
      setStatus('A análise foi executada localmente neste dispositivo.');
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `Não consegui analisar agora: ${error.message}` }]);
      setStatus('Os dados não foram enviados a um serviço externo de IA.');
    } finally {
      setSending(false);
    }
  }

  return <section className="card chart-card local-ai-card">
    <div className="section-heading"><div><p className="eyebrow">ASSISTENTE LOCAL</p><h2>Converse sobre esta série</h2></div>
      <button className="secondary-button" onClick={() => setOpen(value => !value)}>{open ? 'Fechar assistente' : 'Abrir assistente'}</button></div>
    <p className="m">O modelo e a análise rodam no navegador. Os dados agregados são lidos do Supabase para este dispositivo e não são enviados a uma API de IA.</p>
    {open && <div className="local-ai-body">
      {supported === false && <p className="status-message" role="status">Este navegador não oferece WebGPU. Use uma versão atual do Chrome/Edge em um dispositivo compatível; as sugestões locais de colunas continuam disponíveis.</p>}
      {supported && !engineRef.current && <button disabled={loading} onClick={loadModel}>{loading ? 'Preparando modelo...' : 'Baixar e preparar modelo local'}</button>}
      {status && <p className="m" role="status">{status}</p>}
      {supported && <><div className="chat-transcript" aria-live="polite">
        {messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
          <b>{message.role === 'user' ? 'Você' : 'Assistente'}</b><p>{message.content}</p></div>)}
        {!messages.length && <p className="m">Exemplos: “Qual período teve o maior total?” ou “Quais categorias mais cresceram?”</p>}
      </div>
      <form className="chat-form" onSubmit={ask}>
        <label htmlFor="local-ai-question">Sua pergunta</label>
        <textarea id="local-ai-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} rows={3} placeholder="Pergunte sobre os períodos e agrupamentos desta série..." disabled={sending || loading}/>
        <button disabled={sending || loading || !question.trim()}>{sending ? 'Analisando...' : 'Perguntar'}</button>
      </form></>}
    </div>}
  </section>;
}
