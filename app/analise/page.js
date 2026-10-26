'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import * as XLSX from 'xlsx';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import AppHeader from '@/components/AppHeader';
import LocalAiChat from '@/components/LocalAiChat';
import { readSpreadsheet, inferColumns, splitSummaryRows, periodLabel } from '@/lib/sheet';
import { MODELS, ensureEngine, releaseEngine, checkWebGpu } from '@/lib/local-engine';
import { aiSuggest } from '@/lib/ai-select';
import { analyze, suggest, qualityWarnings, numericStats, fmt, AGG } from '@/lib/analyze';
import { C, tooltipProps, axisProps, compact } from '@/lib/chart-theme';

const MAX_BYTES = 25e6;
const MAX_BARS = 12;
const short = (s, n = 18) => String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s);
const TYPE_LABEL = { number: 'número', date: 'data', text: 'texto' };
const HeatMap = dynamic(() => import('@/components/HeatMap'), { ssr: false });

function Segmented({ value, onChange, options, label }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(([v, l]) =>
    <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}</div>;
}
const Pick = ({ label, value, onChange, cols, none, hint }) => <label>{label}
  <select value={value} onChange={e => onChange(e.target.value)}>{none && <option value="">{none}</option>}{cols.map(c => <option key={c.name} value={c.name}>{c.name} ({TYPE_LABEL[c.type]})</option>)}</select>
  {hint && <small>{hint}</small>}</label>;

// Uma frase que responde "o que aconteceu?" antes de qualquer gráfico
function Headline({ h }) {
  if (!h) return null;
  const up = h.variacao != null && h.variacao >= 0;
  return <p className="headline">
    {h.periodo
      ? <>Em <b>{h.periodo}</b>, {h.metrica}: <b>{fmt(h.valor)}</b>.{h.variacao != null && <> Isso é <b className="delta">{up ? 'uma alta' : 'uma queda'} de {fmt(Math.abs(h.variacao))}%</b> em relação a {h.anterior}.</>}</>
      : <>{h.lider} lidera: {h.metrica} de <b>{fmt(h.valor)}</b>.</>}
  </p>;
}

export default function Analise() {
  const [book, setBook] = useState(null);           // { fileName, tables }
  const [ti, setTi] = useState(0);
  const [keepTotals, setKeepTotals] = useState(false);
  const [map, setMap] = useState({ value: '', period: '', dim: '', agg: 'sum' });
  const [timeChart, setTimeChart] = useState('bar');
  const [dimChart, setDimChart] = useState('bar');
  const [cityFilter, setCityFilter] = useState('');
  const [msg, setMsg] = useState(''), [busy, setBusy] = useState(false), [drag, setDrag] = useState(false);
  const input = useRef();
  const [modelId, setModelId] = useState(MODELS[0].id), [gpu, setGpu] = useState(null);
  const [aiBusy, setAiBusy] = useState(false), [aiStatus, setAiStatus] = useState(''), [aiNote, setAiNote] = useState(null);
  useEffect(() => { checkWebGpu().then(setGpu); return () => { releaseEngine(); }; }, []);

  // Linhas "Total"/"Subtotal" saem da conta por padrão: se ficassem, tudo seria contado em dobro.
  const rawTable = book?.tables[ti];
  const split = useMemo(() => rawTable ? splitSummaryRows(rawTable) : null, [rawTable]);
  const table = keepTotals ? rawTable : split?.table;
  const removed = split?.removed.length || 0;

  const cols = useMemo(() => table ? inferColumns(table) : [], [table]);
  const numCols = cols.filter(c => c.type === 'number');
  const valueCol = cols.find(c => c.name === map.value);
  const result = useMemo(() => table ? analyze(table, cols, map) : null, [table, cols, map]);
  const warnings = useMemo(() => table ? qualityWarnings(table, cols, valueCol) : [], [table, cols, valueCol]);
  const stats = useMemo(() => table && valueCol ? numericStats(table, valueCol.index) : null, [table, valueCol]);
  const aiContext = useMemo(() => {
    if (!result) return null;
    const periods = result.facts.periodos || [];
    const compactFacts = { ...result.facts, periodos: periods.slice(-36) };
    return {
      analise: compactFacts,
      resumo: result.insights,
      avisos: warnings,
      ...(periods.length > 36 ? { limitacoes: `A série tem ${periods.length} períodos; a IA recebeu os 36 mais recentes.` } : {}),
    };
  }, [result, warnings]);

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
      setBook({ fileName: file.name, tables }); setTi(0); setKeepTotals(false); choose(splitSummaryRows(tables[0]).table);
      setMsg(`${file.name}: ${tables[0].rows.length.toLocaleString('pt-BR')} linhas lidas.`);
    } catch (e) { setBook(null); setMsg(e.message || 'Não foi possível ler este arquivo.'); }
    setBusy(false);
  }
  function changeTable(i) { setTi(i); setKeepTotals(false); choose(splitSummaryRows(book.tables[i]).table); }
  function toggleTotals(v) { setKeepTotals(v); choose(v ? rawTable : split.table); }
  function download() {
    const q = v => `"${String(v).replace(/"/g, '""')}"`, num = v => String(v).replace('.', ',');
    const lines = [['tipo', 'item', 'valor', 'registros'].join(';')];
    result.series.forEach(r => lines.push(['periodo', q(r.k), num(r.v), r.n].join(';')));
    result.byDim.forEach(r => lines.push(['categoria', q(r.k), num(r.v), r.n].join(';')));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })); a.download = 'resumo-analise.csv'; a.click();
  }

  const label = `${AGG[map.agg]}${map.value && map.agg !== 'count' ? ' de ' + map.value : ' de registros'}`;
  const hasTime = result?.series.length > 1, hasDim = result?.byDim.length > 0;
  const additive = map.agg === 'sum' || map.agg === 'count';
  const dimTotal = result?.byDim.reduce((a, b) => a + b.v, 0) || 0;
  const share = v => additive && dimTotal > 0 ? `${fmt(v / dimTotal * 100)}%` : '-';
  // As maiores categorias + uma barra "Outras" quando a soma faz sentido; assim o gráfico fecha com o total.
  const topDim = useMemo(() => {
    if (!result) return [];
    const d = result.byDim, head = d.slice(0, MAX_BARS);
    if (d.length > MAX_BARS && additive) head.push({ k: `Outras ${d.length - MAX_BARS}`, v: d.slice(MAX_BARS).reduce((a, b) => a + b.v, 0), rest: true });
    return head;
  }, [result, additive]);
  const timeData = useMemo(() => (result?.series || []).map(s => ({ ...s, label: periodLabel(s.k) })), [result]);
  const sameCol = map.period && map.period === map.dim;
  const filteredDim = useMemo(() => {
    if (!result?.byDim?.length) return [];
    const rows = cityFilter ? result.byDim.filter(r => String(r.k).toLowerCase().includes(cityFilter.toLowerCase())) : result.byDim;
    return rows.slice(0, MAX_BARS);
  }, [result, cityFilter]);
  const geoData = useMemo(() => {
    if (!result?.byDim?.length || !map.dim) return [];
    const base = result.byDim.filter(r => r.v != null && Number.isFinite(r.v));
    return base.map(r => ({ k: r.k, v: r.v }));
  }, [result, map.dim]);

  return <><AppHeader active="analise"/>
    <main className="dashboard">
      <section className="page-intro"><h1>Analisar planilha</h1>
        <p className="m">Envie um arquivo e veja o que mudou, quem lidera e o que merece conferência. A planilha não sai do seu navegador.</p></section>

      <section className="card">
        <div className={`dropzone${drag ? ' over' : ''}${book ? ' loaded' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); load(e.dataTransfer.files[0]); }}>
          <div><p><b>{book ? book.fileName : 'Arraste a planilha aqui'}</b></p>
            <p className="m">{book ? `${(table?.rows.length ?? 0).toLocaleString('pt-BR')} linhas · ${cols.length} colunas` : 'Excel (.xlsx, .xls) ou CSV, até 25 MB'}</p></div>
          <button type="button" className={book ? 'secondary-button' : ''} disabled={busy} onClick={() => input.current.click()}>{book ? 'Trocar arquivo' : 'Escolher arquivo'}</button>
          <input ref={input} type="file" hidden accept=".xlsx,.xls,.csv,.tsv,.txt" onChange={e => { load(e.target.files[0]); e.target.value = ''; }}/>
        </div>
        {msg && !book && <p className="status-message" role="status">{msg}</p>}
      </section>

      {table && <>
        {removed > 0 && <section className="notice" role="status">
          <p><b>{removed} linha{removed > 1 ? 's' : ''} de total {keepTotals ? 'incluída' + (removed > 1 ? 's' : '') : 'ignorada' + (removed > 1 ? 's' : '')}.</b> {keepTotals ? 'Os números abaixo estão contando o total junto com os dados, ou seja, em dobro.' : 'Linhas como "Total" e "Subtotal" já resumem as outras; contá-las duplicaria os valores.'}</p>
          <label className="check"><input type="checkbox" checked={keepTotals} onChange={e => toggleTotals(e.target.checked)}/> Incluir mesmo assim</label></section>}

        <section className="card setup">
          <div className="section-heading"><h2>O que analisar</h2>
            <div className="btn-row"><button className="secondary-button" disabled={aiBusy} onClick={() => choose(table)}>Sugerir automaticamente</button>
              <button className="secondary-button" disabled={aiBusy || gpu === false} onClick={pickWithAi} title={gpu === false ? 'Este navegador não tem WebGPU' : ''}>{aiBusy ? 'IA trabalhando...' : 'Escolher com IA'}</button></div></div>
          {aiStatus && <p className="status-message" role="status">{aiStatus}</p>}
          {aiNote?.error && <p className="status-message" role="alert">{aiNote.error}</p>}
          {aiNote && !aiNote.error && <p className="status-message" role="status"><b>A IA escolheu as colunas abaixo.</b>{aiNote.reason ? ` ${aiNote.reason}` : ''}{aiNote.fallback ? ' Parte da escolha foi completada pelas regras automáticas. Confira antes de seguir.' : ' Você pode trocar qualquer uma.'}</p>}
          <div className="form-grid four">
            {book.tables.length > 1 && <label>Aba<select value={ti} onChange={e => changeTable(+e.target.value)}>{book.tables.map((t, i) => <option key={t.name} value={i}>{t.name} ({t.rows.length} linhas)</option>)}</select></label>}
            <Pick label="Medir" value={map.value} onChange={v => setMap({ ...map, value: v, agg: v ? (map.agg === 'count' ? 'sum' : map.agg) : 'count' })} cols={numCols} none="Só contar linhas"/>
            <label>Como combinar<select value={map.agg} onChange={e => setMap({ ...map, agg: e.target.value })}>{Object.entries(AGG).map(([k, v]) => <option key={k} value={k} disabled={!map.value && k !== 'count'}>{v}</option>)}</select></label>
            <Pick label="Ao longo de" value={map.period} onChange={v => setMap({ ...map, period: v })} cols={cols} none="Sem período" hint="Datas viram meses."/>
            <Pick label="Separar por" value={map.dim} onChange={v => setMap({ ...map, dim: v })} cols={cols.filter(c => c.name !== map.value && c.type !== 'date')} none="Sem separação"/>
          </div>
          {sameCol && <p className="m small">O período e a separação usam a mesma coluna; escolha outra em uma delas para ver as duas visões.</p>}
          {gpu === false && <p className="m small">Sem WebGPU neste dispositivo: o resumo automático funciona normalmente; para conversar com a IA local use Chrome ou Edge atualizados.</p>}
        </section>

        {result?.headline && <Headline h={result.headline}/>}

        {stats && <dl className="kpis">
          <div><dt>Registros válidos</dt><dd>{fmt(stats.n)}</dd></div>
          <div><dt>Soma</dt><dd>{fmt(stats.sum)}</dd></div>
          <div><dt>Média</dt><dd>{fmt(stats.mean)}</dd></div>
          <div><dt>Mediana</dt><dd>{fmt(stats.median)}</dd></div>
          <div><dt>Menor</dt><dd>{fmt(stats.min)}</dd></div>
          <div><dt>Maior</dt><dd>{fmt(stats.max)}</dd></div></dl>}

        {warnings.length > 0 && <section className="notice warn" aria-label="Avisos sobre os dados"><p><b>Confira antes de confiar nos números</b></p>
          <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></section>}

        {hasTime && <section className="card chart-card"><div className="section-heading"><div><h2>{label} por período</h2>
          <p className="m small">{timeData.length} períodos · {periodLabel(result.series[0].k)} a {periodLabel(result.series.at(-1).k)}</p></div>
          <Segmented label="Tipo de gráfico" value={timeChart} onChange={setTimeChart} options={[['bar', 'Barras'], ['line', 'Linha']]}/></div>
          <div className="chart-area"><ResponsiveContainer>{timeChart === 'line'
            ? <LineChart data={timeData} margin={{ left: 0, right: 8, top: 8 }}><CartesianGrid stroke={C.grid} vertical={false}/><XAxis dataKey="label" {...axisProps} minTickGap={24}/><YAxis {...axisProps} tickFormatter={compact} width={48}/><Tooltip {...tooltipProps} formatter={v => [fmt(v), label]}/><Line dataKey="v" stroke={C.data} strokeWidth={2.5} dot={timeData.length < 25 ? { r: 3, fill: C.data } : false}/></LineChart>
            : <BarChart data={timeData} margin={{ left: 0, right: 8, top: 8 }}><CartesianGrid stroke={C.grid} vertical={false}/><XAxis dataKey="label" {...axisProps} minTickGap={24}/><YAxis {...axisProps} tickFormatter={compact} width={48}/><Tooltip {...tooltipProps} formatter={v => [fmt(v), label]}/><Bar dataKey="v" radius={[3, 3, 0, 0]}>{timeData.map((_, i) => <Cell key={i} fill={i === timeData.length - 1 ? C.data : C.rest}/>)}</Bar></BarChart>}</ResponsiveContainer></div>
          <p className="m small">{timeChart === 'bar' ? 'O período mais recente está destacado.' : ''}</p></section>}

        {hasDim && <section className="card chart-card"><div className="section-heading"><div><h2>{label} por {map.dim}</h2>
          <p className="m small">{result.byDim.length} categorias{result.byDim.length > MAX_BARS ? ` · mostrando as ${MAX_BARS} maiores${additive ? ' e o resto agrupado' : ''}` : ''}</p></div>
          <div className="btn-row"><button className="secondary-button" onClick={download}>Baixar resumo (CSV)</button><Segmented label="Tipo de gráfico" value={dimChart} onChange={setDimChart} options={[['bar', 'Barras'], ['area', 'Área'], ['pie', 'Pizza']]}/></div></div>
          {(dimChart === 'bar' || dimChart === 'area') && <div className="chart-area tall" style={{ height: Math.max(220, filteredDim.length * 30 + 40) }}><ResponsiveContainer><BarChart data={filteredDim.length ? filteredDim : topDim} layout="vertical" margin={{ left: 0, right: 16 }}>
            <CartesianGrid stroke={C.grid} horizontal={false}/><XAxis type="number" {...axisProps} tickFormatter={compact}/><YAxis type="category" dataKey="k" {...axisProps} width={130} tickFormatter={v => short(v, 20)} interval={0}/>
            <Tooltip {...tooltipProps} formatter={v => [fmt(v), label]}/>
            <Bar dataKey="v" radius={[0, 3, 3, 0]} barSize={18}>{(filteredDim.length ? filteredDim : topDim).map((d, i) => <Cell key={i} fill={i === 0 && !d.rest ? C.data : C.rest}/>)}</Bar></BarChart></ResponsiveContainer></div>}
          {dimChart === 'pie' && <div className="chart-area" style={{ height: 260 }}><ResponsiveContainer><PieChart><Pie data={filteredDim.length ? filteredDim : topDim} dataKey="v" nameKey="k" innerRadius={45} outerRadius={90} paddingAngle={2}>{(filteredDim.length ? filteredDim : topDim).map((d, i) => <Cell key={i} fill={i % 2 === 0 ? C.data : C.rest}/>)}</Pie><Tooltip {...tooltipProps} formatter={v => [fmt(v), label]}/></PieChart></ResponsiveContainer></div>}
          <div className="form-grid inline"><label className="search-field">Filtrar por nome<input value={cityFilter} onChange={e => setCityFilter(e.target.value)} placeholder="Digite parte do nome"/></label></div>
          <div className="table-wrap"><table><thead><tr><th>{map.dim}</th><th className="num">{label}</th><th className="num">{additive ? 'Parte do total' : ''}</th><th className="num">Registros</th></tr></thead>
            <tbody>{(cityFilter ? filteredDim : result.byDim.slice(0, 30)).map(r => <tr key={r.k}><td>{r.k}</td><td className="num">{fmt(r.v)}</td><td className="num">{share(r.v)}</td><td className="num">{fmt(r.n)}</td></tr>)}</tbody></table></div>
          {result.byDim.length > 30 && <p className="m small">A tabela mostra as 30 maiores de {result.byDim.length}. O CSV traz todas.</p>}</section>}

        {geoData.length > 0 && <section className="card chart-card"><div className="section-heading"><div><h2>Mapa de calor por município/UF</h2><p className="m small">Consulta geográfica pelos municípios ou estados da categoria selecionada.</p></div></div>
          <HeatMap data={geoData} diverging={map.agg === 'mean'} />
        </section>}

        {!hasTime && !hasDim && <section className="card"><p className="empty-state">Escolha uma coluna em <b>Ao longo de</b> e/ou <b>Separar por</b> para gerar gráficos.</p></section>}

        {result.insights.length > 0 && <section className="card"><div className="section-heading"><h2>O que os dados mostram</h2></div>
          <ul className="insights">{result.insights.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <p className="m small">Textos calculados diretamente dos dados, sem IA.</p></section>}

        <LocalAiChat key={`${book.fileName}-${ti}-${keepTotals}`} context={aiContext} title="Peça uma análise dos seus dados" modelId={modelId} onModelChange={setModelId}/>

        <details className="card preview"><summary>Ver as primeiras linhas da planilha</summary>
          <div className="table-wrap"><table><thead><tr>{cols.map(c => <th key={c.name} className={c.type === 'number' ? 'num' : ''}>{c.name}<span className={`badge ${c.type}`}>{TYPE_LABEL[c.type]}</span></th>)}</tr></thead>
            <tbody>{table.rows.slice(0, 8).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={cols[j]?.type === 'number' ? 'num' : ''}>{String(v).slice(0, 40)}</td>)}</tr>)}</tbody></table></div></details>
      </>}
    </main></>;
}
