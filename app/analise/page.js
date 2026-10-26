'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import AppHeader from '@/components/AppHeader';
import LocalAiChat from '@/components/LocalAiChat';
import { readSpreadsheet, inferColumns } from '@/lib/sheet';
import { MODELS, ensureEngine, releaseEngine, hasWebGpu } from '@/lib/local-engine';
import { aiSuggest } from '@/lib/ai-select';
import { analyze, suggest, qualityWarnings, numericStats, fmt, AGG } from '@/lib/analyze';

const COLORS = ['#2dd4bf', '#7c6cff', '#f472b6', '#f59e0b', '#38bdf8', '#a3e635', '#fb7185', '#c084fc', '#facc15', '#34d399', '#60a5fa', '#f97316'];
const tip = { contentStyle: { background: '#161a31', border: '1px solid #2c3256', borderRadius: 8 } };
const MAX_BYTES = 25e6;
const short = (s, n = 18) => String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s);
const TYPE_LABEL = { number: 'número', date: 'data', text: 'texto' };

function Segmented({ value, onChange, options, label }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(([v, l]) =>
    <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
const Pick = ({ label, value, onChange, cols, none, hint }) => <label>{label}
  <select value={value} onChange={e => onChange(e.target.value)}>{none && <option value="">{none}</option>}{cols.map(c => <option key={c.name} value={c.name}>{c.name} ({TYPE_LABEL[c.type]})</option>)}</select>
  {hint && <small>{hint}</small>}</label>;

export default function Analise() {
  const [book, setBook] = useState(null);           // { fileName, tables }
  const [ti, setTi] = useState(0);
  const [map, setMap] = useState({ value: '', period: '', dim: '', agg: 'sum' });
  const [timeChart, setTimeChart] = useState('line'), [dimChart, setDimChart] = useState('bar');
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false), [drag, setDrag] = useState(false);
  const input = useRef();
  const [modelId, setModelId] = useState(MODELS[0].id), [gpu, setGpu] = useState(null);
  const [aiBusy, setAiBusy] = useState(false), [aiStatus, setAiStatus] = useState(''), [aiNote, setAiNote] = useState(null);
  useEffect(() => { setGpu(hasWebGpu()); return () => { releaseEngine(); }; }, []);

  const table = book?.tables[ti];
  const cols = useMemo(() => table ? inferColumns(table) : [], [table]);
  const numCols = cols.filter(c => c.type === 'number');
  const result = useMemo(() => table ? analyze(table, cols, map) : null, [table, cols, map]);
  const warnings = useMemo(() => table ? qualityWarnings(table, cols, cols.find(c => c.name === map.value)) : [], [table, cols, map.value]);
  const stats = useMemo(() => table && map.value ? numericStats(table, cols.find(c => c.name === map.value)?.index) : null, [table, cols, map.value]);
  const aiContext = useMemo(() => result ? { analise: result.facts, resumo: result.insights, avisos: warnings } : null, [result, warnings]);

  function choose(tbl) {
    setAiNote(null);
    const c = inferColumns(tbl), s = suggest(c);
    setMap({ value: s.value, period: s.period, dim: s.dim, agg: s.value ? 'sum' : 'count' });
  }
  async function pickWithAi() {
    setAiBusy(true); setAiNote(null); setAiStatus('Preparando a IA local (na primeira vez baixa o modelo)...');
    try {
      const engine = await ensureEngine(modelId, setAiStatus);
      setAiStatus('A IA está analisando as colunas...');
      const r = await aiSuggest(engine, table, cols);
      setMap(r.map); setAiNote({ reason: r.reason, fallback: r.fallback, used: r.usedAi });
    } catch (e) { setAiNote({ error: `Não foi possível usar a IA local (${e.message || 'erro desconhecido'}). Use "Sugerir automaticamente".` }); }
    setAiBusy(false); setAiStatus('');
  }
  async function load(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) return setMsg('Arquivo maior que 25 MB.');
    setBusy(true); setMsg('Lendo a planilha...');
    try {
      const { tables } = readSpreadsheet(XLSX, await file.arrayBuffer(), file.name);
      if (!tables.length) throw new Error('Não encontrei dados nesta planilha. Confira se há um cabeçalho e linhas preenchidas.');
      setBook({ fileName: file.name, tables }); setTi(0); choose(tables[0]);
      setMsg(`${file.name}: ${tables[0].rows.length.toLocaleString('pt-BR')} linhas lidas. As colunas foram sugeridas automaticamente; ajuste se precisar.`);
    } catch (e) { setBook(null); setMsg(e.message || 'Não foi possível ler este arquivo.'); }
    setBusy(false);
  }
  function download() {
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [['tipo', 'item', 'valor'].join(';')];
    result.series.forEach(r => lines.push(['periodo', q(r.k), String(r.v).replace('.', ',')].join(';')));
    result.byDim.forEach(r => lines.push(['categoria', q(r.k), String(r.v).replace('.', ',')].join(';')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'resumo-analise.csv'; a.click();
  }

  const label = `${AGG[map.agg]}${map.value && map.agg !== 'count' ? ' de ' + map.value : ' de registros'}`;
  const topDim = result?.byDim.slice(0, 12) || [];
  const hasTime = result?.series.length > 1, hasDim = result?.byDim.length > 0;

  return <><AppHeader active="analise"/>
    <main className="dashboard">
      <section className="page-intro"><p className="eyebrow">ANÁLISE RÁPIDA</p><h1>Planilha → gráficos e análise</h1>
        <p className="m">Tudo é calculado no seu navegador. A planilha não é enviada nem guardada.</p></section>

      <section className="card">
        <div className={`dropzone${drag ? ' over' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files[0]); }}>
          <p><b>{book ? book.fileName : 'Arraste a planilha aqui'}</b></p>
          <p className="m">Excel (.xlsx, .xls) ou CSV, até 25 MB</p>
          <button type="button" disabled={busy} onClick={() => input.current.click()}>{book ? 'Trocar arquivo' : 'Escolher arquivo'}</button>
          <input ref={input} type="file" hidden accept=".xlsx,.xls,.csv,.tsv,.txt" onChange={e => { load(e.target.files[0]); e.target.value = ''; }}/>
        </div>
        {msg && <p className="status-message" role="status">{msg}</p>}
      </section>

      {table && <>
        <section className="card">
          <div className="section-heading"><div><p className="eyebrow">PASSO 2</p><h2>O que analisar</h2></div>
            <div className="btn-row"><button className="secondary-button" disabled={aiBusy} onClick={() => choose(table)}>Sugerir automaticamente</button>
              <button disabled={aiBusy || gpu === false} onClick={pickWithAi} title={gpu === false ? 'Este navegador não tem WebGPU' : ''}>{aiBusy ? 'IA trabalhando...' : '✨ Escolher com IA'}</button></div></div>
          {gpu === false && <p className="m small">"Escolher com IA" precisa de WebGPU (Chrome ou Edge atuais em computador compatível). "Sugerir automaticamente" funciona em qualquer navegador.</p>}
          {gpu && <label className="model-pick">Modelo da IA<select value={modelId} disabled={aiBusy} onChange={e => setModelId(e.target.value)}>{MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>}
          {aiStatus && <p className="status-message" role="status">{aiStatus}</p>}
          {aiNote?.error && <p className="status-message" role="alert">{aiNote.error}</p>}
          {aiNote && !aiNote.error && <p className="status-message" role="status">✨ <b>A IA escolheu as colunas abaixo.</b>{aiNote.reason ? ` ${aiNote.reason}` : ''}{aiNote.fallback ? ' Parte da escolha foi completada pelas regras automáticas, porque a IA indicou colunas inadequadas ou inexistentes. Confira antes de seguir.' : ' Você pode trocar qualquer uma.'}</p>}
          <div className="form-grid">
            {book.tables.length > 1 && <label>Aba<select value={ti} onChange={e => { setTi(+e.target.value); choose(book.tables[+e.target.value]); }}>{book.tables.map((t, i) => <option key={t.name} value={i}>{t.name} ({t.rows.length} linhas)</option>)}</select></label>}
            <Pick label="Coluna de valor" value={map.value} onChange={v => setMap({ ...map, value: v })} cols={numCols} none="Nenhuma (só contar linhas)"/>
            <label>Como combinar<select value={map.agg} onChange={e => setMap({ ...map, agg: e.target.value })}>{Object.entries(AGG).map(([k, v]) => <option key={k} value={k} disabled={!map.value && k !== 'count'}>{v}</option>)}</select></label>
            <Pick label="Período (eixo do tempo)" value={map.period} onChange={v => setMap({ ...map, period: v })} cols={cols} none="Sem período" hint="Datas viram meses (AAAA-MM)."/>
            <Pick label="Agrupar por" value={map.dim} onChange={v => setMap({ ...map, dim: v })} cols={cols.filter(c => c.type !== 'number')} none="Sem agrupamento"/>
          </div>
          <details className="preview"><summary>Ver as primeiras linhas da planilha</summary>
            <div className="table-wrap"><table><thead><tr>{cols.map(c => <th key={c.name}>{c.name}<span className={`badge ${c.type}`}>{TYPE_LABEL[c.type]}</span></th>)}</tr></thead>
              <tbody>{table.rows.slice(0, 8).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{String(v).slice(0, 40)}</td>)}</tr>)}</tbody></table></div></details>
        </section>

        {warnings.length > 0 && <section className="card warn-card" aria-label="Avisos sobre os dados"><p className="eyebrow">ATENÇÃO AOS DADOS</p>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></section>}

        {stats && <div className="kpis">
          <div className="kpi"><span>Registros válidos</span><b>{fmt(stats.n)}</b></div>
          <div className="kpi"><span>Total</span><b>{fmt(stats.sum)}</b></div>
          <div className="kpi"><span>Média</span><b>{fmt(stats.mean)}</b></div>
          <div className="kpi"><span>Mediana</span><b>{fmt(stats.median)}</b></div>
          <div className="kpi"><span>Mín. / Máx.</span><b>{fmt(stats.min)} / {fmt(stats.max)}</b></div></div>}

        {result.insights.length > 0 && <section className="card"><div className="section-heading"><div><p className="eyebrow">DESTAQUES</p><h2>O que os dados mostram</h2></div>
          <button className="secondary-button" onClick={download}>Baixar resumo (CSV)</button></div>
          <ul className="insights">{result.insights.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <p className="m small">Textos calculados diretamente dos dados, sem IA.</p></section>}

        {hasTime && <section className="card chart-card"><div className="section-heading"><div><p className="eyebrow">EVOLUÇÃO</p><h2>{label} por período</h2></div>
          <Segmented label="Tipo de gráfico" value={timeChart} onChange={setTimeChart} options={[['line', 'Linha'], ['bar', 'Barras'], ['area', 'Área']]}/></div>
          <div className="chart-area"><ResponsiveContainer>{timeChart === 'bar'
            ? <BarChart data={result.series}><CartesianGrid stroke="#2c3256"/><XAxis dataKey="k" stroke="#8d93bd" fontSize={11} minTickGap={16}/><YAxis stroke="#8d93bd" fontSize={11} tickFormatter={fmt} width={70}/><Tooltip {...tip} formatter={v => fmt(v)}/><Bar dataKey="v" name={label} fill="#2dd4bf" radius={[4, 4, 0, 0]}/></BarChart>
            : timeChart === 'area'
            ? <AreaChart data={result.series}><CartesianGrid stroke="#2c3256"/><XAxis dataKey="k" stroke="#8d93bd" fontSize={11} minTickGap={16}/><YAxis stroke="#8d93bd" fontSize={11} tickFormatter={fmt} width={70}/><Tooltip {...tip} formatter={v => fmt(v)}/><Area dataKey="v" name={label} stroke="#2dd4bf" fill="#2dd4bf33" strokeWidth={2}/></AreaChart>
            : <LineChart data={result.series}><CartesianGrid stroke="#2c3256"/><XAxis dataKey="k" stroke="#8d93bd" fontSize={11} minTickGap={16}/><YAxis stroke="#8d93bd" fontSize={11} tickFormatter={fmt} width={70}/><Tooltip {...tip} formatter={v => fmt(v)}/><Line dataKey="v" name={label} stroke="#2dd4bf" strokeWidth={3} dot={{ r: 3 }}/></LineChart>}</ResponsiveContainer></div></section>}

        {hasDim && <section className="card chart-card"><div className="section-heading"><div><p className="eyebrow">COMPOSIÇÃO</p><h2>{label} por {map.dim}</h2></div>
          <Segmented label="Tipo de gráfico" value={dimChart} onChange={setDimChart} options={[['bar', 'Barras'], ['pie', 'Pizza']]}/></div>
          {result.byDim.length > 12 && <p className="m small">Mostrando as 12 maiores de {result.byDim.length} categorias.</p>}
          <div className="chart-area tall"><ResponsiveContainer>{dimChart === 'pie' && map.agg !== 'min' && topDim.every(d => d.v >= 0)
            ? <PieChart><Pie data={topDim} dataKey="v" nameKey="k" outerRadius="80%" label={({ name, percent }) => `${short(name, 12)} ${(percent * 100).toFixed(0)}%`}>{topDim.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}</Pie><Tooltip {...tip} formatter={v => fmt(v)}/><Legend/></PieChart>
            : <BarChart data={topDim} layout="vertical" margin={{ left: 10 }}><CartesianGrid stroke="#2c3256" horizontal={false}/><XAxis type="number" stroke="#8d93bd" fontSize={11} tickFormatter={fmt}/><YAxis type="category" dataKey="k" stroke="#8d93bd" fontSize={11} width={130} tickFormatter={v => short(v, 20)} interval={0}/><Tooltip {...tip} formatter={v => fmt(v)}/><Bar dataKey="v" name={label} radius={[0, 4, 4, 0]}>{topDim.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]}/>)}</Bar></BarChart>}</ResponsiveContainer></div>
          <div className="table-wrap"><table><thead><tr><th>{map.dim}</th><th>{label}</th><th>Registros</th></tr></thead><tbody>{result.byDim.slice(0, 30).map(r => <tr key={r.k}><td>{r.k}</td><td>{fmt(r.v)}</td><td>{fmt(r.n)}</td></tr>)}</tbody></table></div></section>}

        {!hasTime && !hasDim && <section className="card"><p className="empty-state">Escolha uma coluna de período e/ou de agrupamento (acima) para gerar gráficos.</p></section>}

        <LocalAiChat key={`${book.fileName}-${ti}`} context={aiContext} title="Pergunte sobre estes dados" modelId={modelId} onModelChange={setModelId}/>
      </>}
    </main></>;
}
