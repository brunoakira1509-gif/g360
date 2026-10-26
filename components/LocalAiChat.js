'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { verifyNumbers } from '@/lib/analyze';
import { MODELS, ensureEngine, peekEngine, releaseEngine, hasWebGpu } from '@/lib/local-engine';

const QUICK_QUESTIONS = ['Resuma os principais pontos desta análise.', 'O que mais chama atenção nos dados?', 'Há algo que eu deva conferir antes de confiar nesses números?'];
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

export default function LocalAiChat({ series, context: givenContext, title = 'Converse sobre esta série', modelId: modelProp, onModelChange }) {
  const [modelLocal, setModelLocal] = useState(MODELS[0].id);
  const modelId = modelProp ?? modelLocal, setModelId = onModelChange ?? setModelLocal;
  const [ready, setReady] = useState(false);
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
  const seriesId = series?.id ?? 'quick';
  const dims = useMemo(() => (series?.dims || []).slice(0, 3), [series?.dims]);
  const quick = !!givenContext;

  useEffect(() => {
    setSupported(hasWebGpu());
  }, []);

  useEffect(() => { setReady(!!peekEngine(modelId)); }, [modelId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // Modo "Análise rápida": o motor é compartilhado com a página e ela mesma o libera.
      if (!quick) releaseEngine();
    };
  }, [seriesId]);

  async function loadModel() {
    if (!hasWebGpu()) { setSupported(false); return null; }
    const loaded = peekEngine(modelId);
    if (loaded) { engineRef.current = loaded; setReady(true); return loaded; }
    if (loading) return null;
    setLoading(true);
    setStatus('Baixando e preparando o modelo local. Na primeira vez pode levar alguns minutos e usar bastante espaço.');
    try {
      const engine = await ensureEngine(modelId, text => mountedRef.current && setStatus(text));
      engineRef.current = engine;
      if (mountedRef.current) { setReady(true); setStatus('Modelo pronto neste dispositivo.'); }
      return engine;
    } catch (error) {
      setStatus(`Não foi possível iniciar o modelo local: ${error.message || 'verifique o suporte WebGPU e a memória do dispositivo.'}`);
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function getContext() {
    if (quick) return givenContext;
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

  async function ask(e, preset) {
    e?.preventDefault?.();
    const text = (preset || question).trim();
    if (!text || sending) return;
    setQuestion('');
    setSending(true);
    setMessages(current => [...current, { role: 'user', content: text }]);
    try {
      const engine = await loadModel();
      if (!engine) throw new Error('O modelo local não conseguiu iniciar. Verifique WebGPU, memória disponível e conexão para baixar o modelo.');
      const context = await getContext();
      setStatus('Analisando no seu dispositivo...');
      const conversation = [
        {
          role: 'system',
          content: `Você é um assistente de análise de dados em português do Brasil. Os números abaixo JÁ foram calculados e conferidos por código. Regras: (1) cite os números exatamente como aparecem; (2) não faça contas novas nem estime valores; (3) não afirme causas, apenas descreva o que os dados mostram; (4) se a resposta não estiver nos dados, diga que não consegue responder com o que foi calculado; (5) seja curto e direto. ${
            context.truncated ? `ATENÇÃO: o resumo cobre ${context.loadedRows} de ${context.totalRows} linhas agregadas; informe essa limitação quando relevante.` : ''
          }\nDADOS: ${JSON.stringify(context)}`,
        },
        ...messages.filter(m => !m.warning).slice(-MAX_HISTORY_MESSAGES).map(({ role, content }) => ({ role, content })),
        { role: 'user', content: text },
      ];
      const response = await engine.chat.completions.create({
        messages: conversation,
        temperature: 0.1,
        max_tokens: 400,
      });
      const answer = response.choices?.[0]?.message?.content;
      if (!answer) throw new Error('O modelo não produziu resposta. Tente reformular a pergunta.');
      const unverified = verifyNumbers(answer, context);
      setMessages(current => [...current, { role: 'assistant', content: answer,
        warning: unverified.length ? `Conferência automática: ${unverified.join(', ')} não aparece(m) nos dados calculados. Confira nos gráficos antes de usar.` : '' }]);
      setStatus('A análise foi executada localmente neste dispositivo.');
    } catch (error) {
      setMessages(current => [...current, { role: 'assistant', content: `Não consegui analisar agora: ${error.message}` }]);
      setStatus('Os dados não foram enviados a um serviço externo de IA.');
    } finally {
      setSending(false);
    }
  }

  return <section className="card chart-card local-ai-card">
    <div className="section-heading"><div><p className="eyebrow">ASSISTENTE LOCAL</p><h2>{title}</h2></div>
      <button className="secondary-button" onClick={() => setOpen(value => !value)}>{open ? 'Fechar assistente' : 'Abrir assistente'}</button></div>
    <p className="m">A análise roda neste navegador. Na primeira utilização, o modelo precisa ser baixado (conexão e espaço disponíveis). Requer navegador e dispositivo compatíveis com WebGPU; os dados não são enviados a uma API de IA.</p>
    {open && <div className="local-ai-body">
      {supported === false && <p className="status-message" role="status">Este navegador não oferece WebGPU. Use uma versão atual do Chrome/Edge em um dispositivo compatível; as sugestões locais de colunas continuam disponíveis.</p>}
      {supported && !ready && <label className="model-pick">Modelo<select value={modelId} disabled={loading} onChange={e => setModelId(e.target.value)}>{MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>}
      {supported && !ready && <button disabled={loading} onClick={loadModel}>{loading ? 'Preparando modelo...' : 'Baixar e preparar modelo local'}</button>}
      {status && <p className="m" role="status">{status}</p>}
      {supported && <><div className="chat-transcript" aria-live="polite">
        {messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}>
          <b>{message.role === 'user' ? 'Você' : 'Assistente'}</b><p>{message.content}</p>
          {message.warning && <p className="verify-warning" role="alert">⚠ {message.warning}</p>}</div>)}
        {!messages.length && <div className="quick-questions"><p className="m">Sugestões:</p>{QUICK_QUESTIONS.map(q => <button type="button" className="ghost" key={q} disabled={sending || loading} onClick={e => ask(e, q)}>{q}</button>)}</div>}
      </div>
      <form className="chat-form" onSubmit={ask}>
        <label htmlFor="local-ai-question">Sua pergunta</label>
        <textarea id="local-ai-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} rows={3} placeholder="Pergunte sobre os períodos e agrupamentos desta série..." disabled={sending || loading}/>
        <button disabled={sending || loading || !question.trim()}>{sending ? 'Analisando...' : 'Perguntar'}</button>
      </form></>}
    </div>}
  </section>;
}
