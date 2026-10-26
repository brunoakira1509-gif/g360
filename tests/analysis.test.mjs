// Rode com: npm test   (usa o test runner nativo do Node 20+, sem dependências)
import test from 'node:test';
import assert from 'node:assert/strict';
import { toPeriod, comparePeriods, periodLabel, splitSummaryRows, inferColumns, parseNumber } from '../lib/sheet.js';
import { analyze, suggest } from '../lib/analyze.js';

const table = (headers, rows) => ({ name: 't', headers, rows });

test('meses por extenso com acento (março/2025) viram AAAA-MM', () => {
  assert.equal(toPeriod('março/2025'), '2025-03');
  assert.equal(toPeriod('Fevereiro-25'), '2025-02');
  assert.equal(toPeriod('dez. de 2024'), '2024-12');
});

test('períodos ordenam como pessoas esperam', () => {
  assert.deepEqual(['Março', 'Janeiro', 'Dezembro', 'Fevereiro'].sort(comparePeriods), ['Janeiro', 'Fevereiro', 'Março', 'Dezembro']);
  assert.deepEqual(['1', '10', '2', '11', '3'].sort(comparePeriods), ['1', '2', '3', '10', '11']);
  assert.equal(periodLabel('2025-03'), 'mar/2025');
});

test('linhas de Total saem da conta e não viram categoria', () => {
  const t = table(['Categoria', 'Valor'], [['A', 10], ['B', 20], ['Total', 30], ['SUBTOTAL', 99]]);
  const { table: clean, removed } = splitSummaryRows(t);
  assert.equal(removed.length, 2);
  const cols = inferColumns(clean);
  const r = analyze(clean, cols, { value: 'Valor', period: '', dim: 'Categoria', agg: 'sum' });
  assert.deepEqual(r.byDim.map(d => d.k), ['B', 'A']);
  assert.equal(r.byDim.reduce((a, b) => a + b.v, 0), 30);
});

test('categoria que só começa com "Total" não é removida', () => {
  const { removed } = splitSummaryRows(table(['C', 'V'], [['Totalmente novo', 1], ['Total de vendas online', 2]]));
  assert.equal(removed.length, 0);
});

test('o texto dos destaques não vira minúsculo no nome da coluna', () => {
  const t = table(['Mês', 'Valor (R$)'], [['jan/2025', 100], ['fev/2025', 150], ['mar/2025', 120]]);
  const r = analyze(t, inferColumns(t), { value: 'Valor (R$)', period: 'Mês', dim: '', agg: 'sum' });
  assert.ok(r.insights.some(i => i.includes('Maior soma de Valor (R$) em fev/2025')), r.insights.join('\n'));
  assert.equal(r.headline.periodo, 'mar/2025');
  assert.ok(Math.abs(r.headline.variacao - (-20)) < 1e-9);
});

test('série com meses por nome sai em ordem de calendário', () => {
  const t = table(['Mês', 'V'], [['Março', 3], ['Janeiro', 1], ['Fevereiro', 2]]);
  const r = analyze(t, inferColumns(t), { value: 'V', period: 'Mês', dim: '', agg: 'sum' });
  assert.deepEqual(r.series.map(s => s.k), ['Janeiro', 'Fevereiro', 'Março']);
});

test('sugestão não confunde "plano"/"urbano" com a coluna Ano', () => {
  const t = table(['Plano', 'Ano', 'Receita'], [['x', 2024, 5], ['y', 2025, 7], ['z', 2025, 9]]);
  const s = suggest(inferColumns(t));
  assert.equal(s.value, 'Receita');
});

test('números brasileiros e americanos', () => {
  assert.equal(parseNumber('R$ 1.234,56'), 1234.56);
  assert.equal(parseNumber('(1.234,56)'), -1234.56);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('n/d'), null);
});
