'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import * as XLSX from 'xlsx';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { C, tooltipProps, axisProps, compact } from '@/lib/chart-theme';
import { supabase } from '@/lib/supabase/client';
import AppHeader from '@/components/AppHeader';
import { suggestColumns } from '@/lib/suggest-columns';
import { readSpreadsheet, inferColumns, parseNumber, toPeriod, comparePeriods, periodLabel, splitSummaryRows } from '@/lib/sheet';
import LocalAiChat from '@/components/LocalAiChat';
const HeatMap = dynamic(() => import('@/components/HeatMap'), { ssr: false });
const fmt = n => n == null || !Number.isFinite(+n) ? '-' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const signed = n => n == null || !Number.isFinite(+n) ? '-' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;
const cleanPeriod = toPeriod;
// Agrega no navegador: milhares de linhas viram poucas linhas (período + dimensões + soma)
function build(rows, m, stats = { skipped: 0 }) {
  const g = new Map();
  rows.forEach(r => {
    const p = m.period ? toPeriod(r[m.period]) : m.label;
    if (!p) { if (String(r[m.val] ?? '').trim() === '') return; throw new Error('Há linhas com valor mas sem período válido. Confira a coluna de período ou informe um rótulo válido.'); }
    const d = [0, 1, 2].map(i => m.dims[i] ? String(r[m.dims[i]] ?? '').trim().slice(0, 120) : '');
    const k = [p, ...d].join('\u0001'); const a = g.get(k) || { p, d, value: 0, cnt: 0 };
    const n = parseNumber(r[m.val]);
    if (n == null) { if (String(r[m.val] ?? '').trim() !== '') stats.skipped++; return; }
    a.value += n; a.cnt++; g.set(k, a);
  });
  for (const { p, value } of g.values()) {
    if (!Number.isFinite(value) || Math.abs(value) >= 1e15)
      throw new Error(`O valor agregado do período "${p}" excede o limite permitido. Confira a coluna de valor.`);
  }
  const out = new Map();
  g.forEach(a => { if (!out.has(a.p)) out.set(a.p, []); out.get(a.p).push({ d1: a.d[0], d2: a.d[1], d3: a.d[2], value: a.value, cnt: a.cnt }); });
  return out;
}
const Sel = ({ v, on, opts, ph }) => <select value={v} onChange={e => on(e.target.value)}><option value="">{ph}</option>{opts.map(o => <option key={o}>{o}</option>)}</select>;
export default function Home() {
  const [list, setList] = useState([]), [sel, setSel] = useState(null), [tot, setTot] = useState([]);
  const [file, setFile] = useState(null), [f, setF] = useState({ name: '', kind: 'valores', period: '', label: '', dims: ['', '', ''], val: '' });
  const [cmp, setCmp] = useState([]), [ab, setAb] = useState({ a: '', b: '', dim: 1, mode: 'b' }), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false);
  const loadList = async () => { const { data } = await supabase.from('series').select('*').order('created_at', { ascending: false }); setList(data || []); return data || []; };
  useEffect(() => { (async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: p } = await supabase.from('profiles').select('terms_version').eq('id', user.id).single(); if (!p?.terms_version) { location.href = '/privacidade'; return; } loadList(); })(); }, []);
  async function pick(s) {
    setSel(s); setCmp([]); if (!s) return setTot([]);
    const { data } = await supabase.rpc('totals', { p_series: s.id }); const t = [...(data || [])].sort((x, y) => comparePeriods(x.period, y.period)); setTot(t);
    setAb(v => ({ ...v, a: t.at(-2)?.period || '', b: t.at(-1)?.period || '', dim: 1 }));
  }
  useEffect(() => { if (!sel || !ab.a || !ab.b) return;
    supabase.rpc('compare', { p_series: sel.id, p_a: ab.a, p_b: ab.b, p_dim: ab.dim }).then(({ data }) => setCmp(data || [])); }, [sel, ab.a, ab.b, ab.dim]);
  async function readFile(e) {
    const x = e.target.files[0]; if (!x) return;
    if (x.size > 25e6) return setMsg('Arquivo maior que 25 MB.');
    try {
      const { tables } = readSpreadsheet(XLSX, await x.arrayBuffer(), x.name);
      const { table: t, removed } = splitSummaryRows(tables[0]); if (!t?.rows.length) return setMsg('Planilha vazia.');
      const rows = t.rows.map(r => Object.fromEntries(t.headers.map((h, i) => [h, r[i]])));
      const cols = inferColumns(t); setFile({ rows, cols });
      setF(v => ({ ...v, val: cols.find(c => c.type === 'number')?.name || '' }));
      setMsg([tables.length > 1 ? `A planilha tem ${tables.length} abas; foi lida a primeira ("${t.name}"). Use Analisar planilha para escolher a aba.` : '', removed.length ? `${removed.length} linha(s) de total foram ignoradas para não duplicar os valores.` : ''].filter(Boolean).join(' '));
    } catch (err) { setMsg(err.message || 'Não foi possível ler o arquivo.'); }
  }
  async function suggest() {
    if (!file?.cols?.length) return setMsg('Carregue uma planilha antes de pedir uma sugestão.');
    const suggestion = suggestColumns(file.cols);
    setF(v => ({ ...v, kind: suggestion.kind, period: suggestion.period, val: suggestion.value || v.val, dims: [0, 1, 2].map(i => suggestion.dims[i] || '') }));
    setMsg(suggestion.value ? 'Sugestão local aplicada sem enviar a planilha. Confira as colunas antes de guardar.' : 'Não identifiquei uma coluna numérica de valor. Selecione as colunas manualmente.');
  }
  async function doImport() {
    const nd = sel ? sel.dims.length : f.dims.filter(Boolean).length;
    const dims = sel ? f.dims.slice(0, nd) : f.dims.filter(Boolean);
    if (!f.val || (!f.period && !f.label)) return setMsg('Escolha a coluna de valor e o período.');
    if (!f.period && !cleanPeriod(f.label)) return setMsg('Informe um rótulo de período válido, com até 40 caracteres.');
    if (!sel && !f.name) return setMsg('Dê um nome para a série.');
    if (dims.length < nd || dims.some(d => !d)) return setMsg('Escolha as colunas de agrupamento.');
    if (dims.some(d => /cpf|cnpj|nome|e-?mail|telefone|celular|endere|\brg\b|titulo|cnh/i.test(d)) && !confirm('Uma coluna de agrupamento parece conter dado pessoal identificável. Para a LGPD, prefira agrupar por categoria ou região. Guardar mesmo assim?')) return;
    setBusy(true); setMsg('Guardando...');
    try {
      const st = { skipped: 0 };
      const groups = build(file.rows, { period: f.period, label: cleanPeriod(f.label), dims, val: f.val }, st);
      let s = sel;
      if (!s) { const { data, error } = await supabase.from('series').insert({ name: f.name, kind: f.kind, dims }).select().single(); if (error) throw error; s = data; }
      let n = 0;
      for (const [p, rows] of groups) { const { error } = await supabase.rpc('import_facts', { p_series: s.id, p_period: p, p_rows: rows }); if (error) throw error; n += rows.length; }
      await loadList(); await pick(s); setMsg(`Guardado: ${n} linhas agregadas a partir de ${file.rows.length} linhas da planilha. A planilha em si não é armazenada.${st.skipped ? ` Atenção: ${st.skipped} valor(es) não numérico(s) foram ignorados.` : ''}`); setFile(null);
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }
  async function del() { if (!confirm('Excluir esta série e todos os dados dela?')) return;
    await supabase.from('series').delete().eq('id', sel.id); setSel(null); setTot([]); loadList(); }
  const rows = useMemo(() => cmp.map(r => ({ k: r.k, a: +r.a, b: +r.b, d: +r.b - +r.a, p: +r.a ? (+r.b - +r.a) / Math.abs(+r.a) * 100 : null })).sort((x, y) => y.d - x.d), [cmp]);
  const top = useMemo(() => [...rows].sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b)).slice(0, 12), [rows]);
  const mapData = useMemo(() => rows.map(r => ({ k: r.k, v: r[ab.mode === 'diff' ? 'd' : ab.mode] })), [rows, ab.mode]);
  const cols = file?.cols.map(c => c.name) || [], periods = tot.map(t => t.period);
  const sum = useMemo(() => {
    if (!tot.length) return null;
    const last = tot.at(-1), prev = tot.at(-2), lv = +last.total, pv = prev ? +prev.total : null;
    return { last, lv, prev, change: pv ? (lv - pv) / Math.abs(pv) * 100 : null, peak: tot.reduce((a, b) => +b.total > +a.total ? b : a) };
  }, [tot]);
  return <><AppHeader active="series"/>
    <main className="dashboard">
    <section className="page-intro"><h1>Suas séries</h1><p className="m">Escolha uma série para continuar ou crie uma nova importando uma planilha.</p></section>
    <section className="card workspace-card"><div className="section-heading"><div><h2>Escolha ou crie uma série</h2></div>
      <select aria-label="Série selecionada" value={sel?.id || ''} onChange={e => pick(list.find(x => x.id === e.target.value) || null)}>
        <option value="">Nova série</option>{list.map(l => <option key={l.id} value={l.id}>{l.name} ({l.kind})</option>)}</select></div>
      <p className="m">{sel ? 'Importe outro período para comparar com os dados existentes.' : 'Uma série reúne dados do mesmo assunto ao longo do tempo.'}</p>
      {sel && <button className="ghost danger-ghost" onClick={del}>Excluir esta série</button>}
      <div className="upload-box"><label htmlFor="spreadsheet">1. Envie sua planilha</label>
        <input id="spreadsheet" type="file" accept=".xlsx,.xls,.csv" onChange={readFile} disabled={busy}/>
        <span className="m">Excel ou CSV, até 25 MB. A planilha original não é guardada.</span>
        {file && <span className="file-summary">{file.rows.length.toLocaleString('pt-BR')} linhas e {file.cols.length} colunas lidas</span>}</div>
      {file && <div className="import-config"><div className="section-heading"><div><h2>Confira como organizar os dados</h2><p className="m">Escolha o valor, o período e, se quiser, até três agrupamentos.</p></div>
        <button className="secondary-button" disabled={busy} onClick={suggest}>Sugerir colunas automaticamente</button></div>
        {!sel && <div className="form-grid"><label>Nome da série<input placeholder="Ex.: despesas mensais" value={f.name} onChange={e => setF({ ...f, name: e.target.value })}/></label>
          <label>Categoria<select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })}><option value="valores">Valores</option><option value="despesas">Despesas</option><option value="votos">Votos</option><option value="outro">Outro</option></select></label></div>}
        <div className="form-grid"><label>Coluna de valor<Sel v={f.val} on={v => setF({ ...f, val: v })} opts={cols} ph="Selecione uma coluna"/></label>
          <label>Coluna que contém o período<Sel v={f.period} on={v => setF({ ...f, period: v })} opts={cols} ph="Selecione uma coluna"/></label>
          {!f.period && <label>Período fixo para toda a planilha<input placeholder="Ex.: 2025-03" value={f.label} onChange={e => setF({ ...f, label: e.target.value })}/></label>}</div>
        <div className="form-grid">{[0, 1, 2].map(i => sel && i >= sel.dims.length ? null :
          <label key={i}>{sel ? `Coluna ${sel.dims[i]}` : `Agrupamento ${i + 1}${i ? ' (opcional)' : ''}`}<Sel v={f.dims[i]} on={v => setF({ ...f, dims: f.dims.map((d, j) => j === i ? v : d) })} opts={cols} ph="Sem agrupamento"/></label>)}</div>
        <button disabled={busy} onClick={doImport}>{busy ? 'Guardando dados...' : '3. Guardar dados agregados'}</button>
      </div>}
      {msg && <p className="status-message" role="status">{msg}</p>}
    </section>
    {sel && <LocalAiChat key={sel.id} series={sel}/>}
    {sel && sum && <>
      <p className="headline">Em <b>{periodLabel(sum.last.period)}</b>, <b>{sel.name}</b> somou <b>{fmt(sum.lv)}</b>.{sum.change != null && <> Isso é <b className="delta">{sum.change >= 0 ? 'uma alta' : 'uma queda'} de {fmt(Math.abs(sum.change))}%</b> em relação a {periodLabel(sum.prev.period)}.</>}</p>
      <dl className="kpis"><div><dt>Último período</dt><dd>{fmt(sum.lv)}</dd></div>
        <div><dt>Variação</dt><dd>{sum.change == null ? '-' : `${signed(sum.change)}%`}</dd></div>
        <div><dt>Maior período</dt><dd>{fmt(sum.peak.total)}<small>{periodLabel(sum.peak.period)}</small></dd></div>
        <div><dt>Períodos na série</dt><dd>{tot.length}</dd></div></dl></>}
    {sel && <section className="card chart-card"><div className="section-heading"><div><h2>Evolução por período</h2><p className="m small">Soma do valor de cada período. Se um período foi importado de novo, vale a última importação.</p></div></div>
      {tot.length ? <div className="chart-area"><ResponsiveContainer><LineChart data={tot.map(t => ({ ...t, total: +t.total, label: periodLabel(t.period) }))} margin={{ left: 0, right: 8, top: 8 }}><CartesianGrid stroke={C.grid} vertical={false}/>
        <XAxis dataKey="label" {...axisProps} minTickGap={24}/><YAxis {...axisProps} tickFormatter={compact} width={48}/><Tooltip {...tooltipProps} formatter={v => [fmt(v), 'Total']}/>
        <Line dataKey="total" name="Total" stroke={C.data} strokeWidth={2.5} dot={tot.length < 25 ? { r: 3, fill: C.data } : false}/></LineChart></ResponsiveContainer></div>
        : <p className="empty-state">Ainda não há dados nesta série. Importe uma planilha para ver a evolução.</p>}</section>}
    {sel && periods.length > 1 && <><section className="card chart-card"><div className="section-heading"><div><h2>Compare períodos</h2><p className="m small">{ab.a === ab.b ? 'Escolha dois períodos diferentes para ver a diferença.' : `${periodLabel(ab.a)} contra ${periodLabel(ab.b)}, por ${sel.dims[ab.dim - 1] || 'total'}.`}</p></div></div><div className="form-grid comparison-controls">
      <label>Período inicial<select value={ab.a} onChange={e => setAb({ ...ab, a: e.target.value })}>{periods.map(p => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></label>
      <label>Período final<select value={ab.b} onChange={e => setAb({ ...ab, b: e.target.value })}>{periods.map(p => <option key={p} value={p}>{periodLabel(p)}</option>)}</select></label>
      {sel.dims.length > 0 && <label>Agrupar por<select value={ab.dim} onChange={e => setAb({ ...ab, dim: +e.target.value })}>{sel.dims.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select></label>}</div>
      {sel.dims.length > 0 && <div className="chart-area comparison-chart"><ResponsiveContainer><BarChart data={top}><CartesianGrid stroke="#2c3256"/><XAxis dataKey="k" {...axisProps} interval={0} angle={-30} textAnchor="end" height={70} tickFormatter={v => String(v).length > 14 ? String(v).slice(0, 13) + '…' : (v || '(vazio)')}/>
        <YAxis {...axisProps} tickFormatter={compact} width={48}/><Tooltip {...tooltipProps} formatter={v => fmt(v)}/><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }}/>
        <Bar dataKey="a" name={periodLabel(ab.a)} fill={C.compare} radius={[3, 3, 0, 0]}/><Bar dataKey="b" name={periodLabel(ab.b)} fill={C.data} radius={[3, 3, 0, 0]}/></BarChart></ResponsiveContainer></div>}
      {sel.dims.length > 0 && <div className="table-wrap"><table><thead><tr><th>{sel.dims[ab.dim - 1]}</th><th className="num">{periodLabel(ab.a)}</th><th className="num">{periodLabel(ab.b)}</th><th className="num">Diferença</th><th className="num">Variação</th></tr></thead><tbody>
        {rows.slice(0, 50).map(r => <tr key={r.k}><td>{r.k || '(vazio)'}</td><td className="num">{fmt(r.a)}</td><td className="num">{fmt(r.b)}</td>
          <td className="num">{signed(r.d)}</td><td className="num">{r.p == null ? <span title="O período inicial não tem valor para comparar">novo</span> : signed(r.p) + '%'}</td></tr>)}</tbody></table></div>}
      {rows.length > 50 && <p className="m small">A tabela mostra as 50 maiores diferenças de {rows.length} itens.</p>}</section>
      {sel.dims.length > 0 && <section className="card chart-card"><div className="section-heading"><div><h2>Mapa</h2></div>
        <select aria-label="Valor exibido no mapa" value={ab.mode} onChange={e => setAb({ ...ab, mode: e.target.value })}><option value="b">Valor em {periodLabel(ab.b)}</option><option value="a">Valor em {periodLabel(ab.a)}</option><option value="diff">Variação</option></select></div>
        <p className="m">Use siglas de UF ou códigos IBGE de município para mapear os dados.</p><HeatMap data={mapData} diverging={ab.mode === 'diff'}/></section>}</>}
    </main></>;
}
