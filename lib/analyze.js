// Análise 100% determinística. A IA local só narra o que sai daqui.
import { parseNumber, toPeriod } from './sheet.js';

export const AGG = { sum: 'Soma', mean: 'Média', count: 'Contagem', min: 'Mínimo', max: 'Máximo' };
export const fmt = n => n == null || !Number.isFinite(+n) ? '-' : Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const pct = n => `${fmt(n)}%`;

function reduceGroup(vals, agg) {
  if (agg === 'count') return vals.length;
  if (!vals.length) return null;
  if (agg === 'sum') return vals.reduce((a, b) => a + b, 0);
  if (agg === 'mean') return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (agg === 'min') return Math.min(...vals);
  return Math.max(...vals);
}

// Agrupa linhas por uma função de chave e agrega o valor numérico.
export function groupBy(table, keyIdx, valIdx, agg, keyFn = v => String(v ?? '').trim() || '(vazio)') {
  const g = new Map(); let ignored = 0;
  for (const r of table.rows) {
    const k = keyFn(r[keyIdx]);
    if (!g.has(k)) g.set(k, []);
    if (agg === 'count') { g.get(k).push(1); continue; }
    const n = parseNumber(r[valIdx]);
    if (n == null) { if (String(r[valIdx] ?? '').trim() !== '') ignored++; continue; }
    g.get(k).push(n);
  }
  return { groups: [...g].map(([k, v]) => ({ k, v: reduceGroup(v, agg), n: v.length })).filter(x => x.v != null), ignored };
}

export function numericStats(table, idx) {
  const v = table.rows.map(r => parseNumber(r[idx])).filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const q = p => { const i = (v.length - 1) * p, lo = Math.floor(i); return v[lo] + (v[Math.ceil(i)] - v[lo]) * (i - lo); };
  const sum = v.reduce((a, b) => a + b, 0), mean = sum / v.length;
  const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  const q1 = q(.25), q3 = q(.75), iqr = q3 - q1;
  const outliers = iqr > 0 ? v.filter(x => x < q1 - 1.5 * iqr || x > q3 + 1.5 * iqr) : [];
  return { n: v.length, sum, mean, median: q(.5), min: v[0], max: v[v.length - 1], std, q1, q3, outliers: outliers.length,
    outlierExamples: outliers.slice(0, 3), negatives: v.filter(x => x < 0).length, zeros: v.filter(x => x === 0).length };
}

// Alertas de qualidade: o que pode distorcer a análise
export function qualityWarnings(table, cols, valueCol) {
  const w = [];
  const dup = table.rows.length - new Set(table.rows.map(r => JSON.stringify(r))).size;
  if (dup > 0) w.push(`${dup} linha(s) idêntica(s) repetida(s). Se não forem legítimas, os totais ficam inflados.`);
  cols.filter(c => c.type === 'number' && c.invalid > 0).forEach(c =>
    w.push(`Coluna "${c.name}": ${c.invalid} valor(es) não numérico(s) foram ignorados (não contam como zero).`));
  cols.filter(c => c.filled === 0).forEach(c => w.push(`Coluna "${c.name}" está vazia.`));
  cols.filter(c => c.filled > 0 && c.empty / table.rows.length > .3).forEach(c =>
    w.push(`Coluna "${c.name}" tem ${Math.round(c.empty / table.rows.length * 100)}% de células vazias.`));
  if (valueCol) {
    const s = numericStats(table, valueCol.index);
    if (s?.outliers) w.push(`"${valueCol.name}": ${s.outliers} valor(es) atípico(s) (ex.: ${s.outlierExamples.map(fmt).join(', ')}). Confira se não são erros de digitação.`);
    if (s?.negatives) w.push(`"${valueCol.name}" tem ${s.negatives} valor(es) negativo(s).`);
  }
  return w;
}

// Sugestão automática de colunas (regras + tipos reais)
export function suggest(cols) {
  const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const find = (list, re) => list.find(c => re.test(norm(c.name)));
  const nums = cols.filter(c => c.type === 'number'), dates = cols.filter(c => c.type === 'date');
  const value = find(nums, /(valor|total|soma|amount|revenue|receita|preco|custo|despesa|venda|votos|quantidade|qtd)/) || nums.find(c => !/(^id$|codigo|cod\b|cpf|cnpj|ano|mes)/.test(norm(c.name))) || nums[0];
  const period = dates[0] || find(cols, /\b(ano|mes|periodo|trimestre|semana|competencia)\b/);
  const bad = /\b(cpf|cnpj|e-?mail|telefone|celular|endereco|nome|senha|rg)\b/;
  const dim = cols.filter(c => c.type === 'text' && c.filled && !bad.test(norm(c.name)) && c.distinct > 1 && c.distinct <= 60)
    .sort((a, b) => /(categoria|regiao|uf|estado|cidade|municipio|produto|departamento|tipo|grupo|segmento|canal)/.test(norm(b.name)) - /(categoria|regiao|uf|estado|cidade|municipio|produto|departamento|tipo|grupo|segmento|canal)/.test(norm(a.name)))[0];
  return { value: value?.name || '', period: period?.name || '', dim: dim?.name || '' };
}

// Analisa com o mapeamento escolhido. Devolve séries para os gráficos + insights + fatos para a IA.
export function analyze(table, cols, map) {
  const col = n => cols.find(c => c.name === n);
  const V = col(map.value), P = col(map.period), D = col(map.dim);
  const agg = map.agg || 'sum', out = { series: [], byDim: [], insights: [], facts: {}, ignored: 0 };
  if (!V && agg !== 'count') return out;
  const vi = V?.index;
  const label = `${AGG[agg]} de ${V?.name || 'registros'}`;
  const stats = V ? numericStats(table, vi) : null;
  out.facts = { arquivo: { linhas: table.rows.length, colunas: cols.length }, metrica: label, estatisticas: stats && { total: stats.sum, media: stats.mean, mediana: stats.median, minimo: stats.min, maximo: stats.max, atipicos: stats.outliers } };
  if (stats && agg !== 'count') out.insights.push(`${fmt(stats.n)} registros válidos em "${V.name}": total ${fmt(stats.sum)}, média ${fmt(stats.mean)}, mediana ${fmt(stats.median)}, de ${fmt(stats.min)} a ${fmt(stats.max)}.`);

  if (P) {
    const r = groupBy(table, P.index, vi, agg, toPeriod); out.ignored = Math.max(out.ignored, r.ignored);
    out.series = r.groups.filter(g => g.k).sort((a, b) => a.k.localeCompare(b.k, 'pt-BR', { numeric: true }));
    const s = out.series;
    if (s.length >= 2) {
      const first = s[0], last = s.at(-1), prev = s.at(-2);
      const hi = s.reduce((a, b) => b.v > a.v ? b : a), lo = s.reduce((a, b) => b.v < a.v ? b : a);
      const ch = (a, b) => a.v ? (b.v - a.v) / Math.abs(a.v) * 100 : null;
      const lc = ch(prev, last), tc = ch(first, last);
      out.insights.push(`Maior ${label.toLowerCase()} em ${hi.k} (${fmt(hi.v)}); menor em ${lo.k} (${fmt(lo.v)}).`);
      if (lc != null) out.insights.push(`De ${prev.k} para ${last.k}: ${lc >= 0 ? 'alta' : 'queda'} de ${pct(Math.abs(lc))} (${fmt(prev.v)} → ${fmt(last.v)}).`);
      if (tc != null && s.length > 2) out.insights.push(`Do início (${first.k}) ao fim (${last.k}): variação de ${pct(tc)}.`);
      out.facts.periodos = s.map(x => ({ periodo: x.k, valor: x.v }));
      out.facts.variacaoUltimoPeriodo = lc;
    }
  }
  if (D) {
    const r = groupBy(table, D.index, vi, agg); out.ignored = Math.max(out.ignored, r.ignored);
    out.byDim = r.groups.sort((a, b) => b.v - a.v);
    const total = out.byDim.reduce((a, b) => a + b.v, 0), d = out.byDim;
    if (d.length) {
      out.insights.push(`Por "${D.name}": ${d[0].k} lidera com ${fmt(d[0].v)}${agg === 'sum' && total ? ` (${pct(d[0].v / total * 100)} do total)` : ''}.`);
      if (agg === 'sum' && d.length >= 4 && total > 0) {
        const top3 = d.slice(0, 3).reduce((a, b) => a + b.v, 0) / total * 100;
        out.insights.push(`As 3 maiores categorias concentram ${pct(top3)} do total.`);
      }
      out.facts.categorias = { coluna: D.name, quantidade: d.length, top: d.slice(0, 12).map(x => ({ nome: x.k, valor: x.v, participacao: total ? x.v / total * 100 : null })) };
    }
  }
  if (out.ignored) out.insights.push(`Atenção: ${out.ignored} célula(s) de valor não numérica(s) foram ignoradas.`);
  return out;
}

// Confere os números que a IA citou contra os fatos calculados.
export function verifyNumbers(answer, factsObj) {
  const known = [];
  JSON.stringify(factsObj, (k, v) => {
    if (typeof v === 'number') known.push(v);
    else if (typeof v === 'string') for (const m of v.matchAll(/\d[\d.,]*\d|\d/g)) { const n = parseNumber(m[0]); if (n != null) known.push(n); }
    return v;
  });
  const found = [...answer.matchAll(/\d[\d.,]*\d|\d/g)].map(m => m[0]);
  const bad = [];
  for (const raw of found) {
    const n = parseNumber(raw); if (n == null) continue;
    if (Number.isInteger(n) && (Math.abs(n) <= 12 || (n >= 1900 && n <= 2100))) continue;   // contagens pequenas e anos
    const ok = known.some(k => [k, Math.abs(k)].some(x => Math.abs(x - Math.abs(n)) <= Math.max(0.011, Math.abs(x) * 0.006)));
    if (!ok) bad.push(raw);
  }
  return [...new Set(bad)];
}
