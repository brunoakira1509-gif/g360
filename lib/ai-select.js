// Seleção de colunas feita pela IA local. A IA só ESCOLHE entre colunas que existem
// (o JSON é restrito por schema) e tudo é validado; o que for inválido cai nas regras.
import { suggest } from './analyze.js';
import { getErrorMessage } from './local-engine.js';

const PERSONAL = /\b(cpf|cnpj|e-?mail|telefone|celular|endereco|endereço|nome|senha|rg)\b/i;
const ID_LIKE = /(^|[^a-z])(id|cod|codigo|código|cep|cpf|cnpj|telefone|celular|ano|mes|mês|ddd)([^a-z]|$)/i;
const clip = v => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 24);

export function describeColumns(table, cols) {
  return cols.map(c => {
    const personal = PERSONAL.test(c.name);
    const samples = personal ? '(oculto)' : [...new Set(table.rows.slice(0, 200).map(r => clip(r[c.index])).filter(Boolean))].slice(0, 4).join(' | ');
    return `- "${c.name}" | tipo: ${{ number: 'número', date: 'data', text: 'texto' }[c.type]} | valores distintos: ${c.distinct} | exemplos: ${samples}`;
  }).join('\n');
}

export function buildSchema(cols) {
  const names = t => cols.filter(c => t.includes(c.type)).map(c => c.name);
  return {
    type: 'object',
    properties: {
      value: { enum: ['', ...names(['number'])] },
      period: { enum: ['', ...names(['date', 'text', 'number'])] },
      dim: { enum: ['', ...names(['text'])] },
      agg: { enum: ['sum', 'mean', 'count'] },
      motivo: { type: 'string', maxLength: 160 },
    },
    required: ['value', 'period', 'dim', 'agg', 'motivo'],
  };
}

export async function aiSuggest(engine, table, cols) {
  const rules = suggest(cols);
  const system = `Você ajuda pessoas sem conhecimento técnico a montar um painel a partir de uma planilha. Escolha as colunas e responda SOMENTE com JSON.
- value: coluna numérica com a medida principal (dinheiro, quantidade, votos, vendas). Nunca escolha códigos, IDs, CEP, telefone ou anos. Vazio se não houver.
- period: coluna de data/mês/ano para o eixo do tempo. Vazio se não houver.
- dim: coluna de texto para comparar categorias (produto, região, tipo...). Evite nomes de pessoas, CPF e e-mail. Vazio se não houver.
- agg: "sum" para valores que se acumulam (vendas, despesas, quantidade); "mean" para taxas, notas, percentuais e preços unitários; "count" se não houver coluna de valor.
- motivo: uma frase curta em português explicando a escolha.`;
  const user = `Planilha com ${table.rows.length} linhas e estas colunas:\n${describeColumns(table, cols)}`;
  const base = { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, max_tokens: 250 };
  let text;
  try {
    const r = await engine.chat.completions.create({ ...base, response_format: { type: 'json_object', schema: JSON.stringify(buildSchema(cols)) } });
    text = r.choices?.[0]?.message?.content;
  } catch (schemaError) {
    try {
      const r = await engine.chat.completions.create(base);   // modelo sem suporte a schema: tenta texto livre
      text = r.choices?.[0]?.message?.content;
    } catch (fallbackError) {
      throw new Error(`A IA falhou ao gerar uma resposta estruturada (${getErrorMessage(schemaError)}). A tentativa simples também falhou (${getErrorMessage(fallbackError)}).`, { cause: fallbackError });
    }
  }
  if (typeof text !== 'string' || !text.trim()) throw new Error('A IA não retornou uma resposta. Tente novamente ou use "Sugerir automaticamente".');
  let raw = {};
  try { raw = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)); } catch { /* usa regras */ }

  const by = n => cols.find(c => c.name === n);
  const fromAi = {}, map = { value: '', period: '', dim: '', agg: 'sum' };
  const take = (key, ok) => {
    if (raw[key] && by(raw[key]) && ok(by(raw[key]))) { map[key] = raw[key]; fromAi[key] = true; }
    else { map[key] = rules[key]; fromAi[key] = false; }
  };
  const isId = c => ID_LIKE.test(c.name) || (c.filled > 5 && c.distinct === c.filled && c.type === 'number');   // código/ID, não é medida
  take('value', c => c.type === 'number' && !isId(c));
  take('period', c => c.type !== 'number' || /ano|mes|mês|period/i.test(c.name));
  take('dim', c => c.type === 'text' && c.name !== map.period && !PERSONAL.test(c.name));
  if (map.dim === map.period) map.dim = '';
  map.agg = ['sum', 'mean', 'count'].includes(raw.agg) ? raw.agg : 'sum';
  if (!map.value) map.agg = 'count';
  if (map.value && map.agg === 'count') map.agg = 'sum';
  const used = Object.values(fromAi).filter(Boolean).length;
  return { map, reason: String(raw.motivo || '').slice(0, 200), usedAi: used, fallback: used < 3 };
}
