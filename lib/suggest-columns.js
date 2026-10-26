const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const kindRules = [
  ['despesas', /\b(despesa|gasto|custo|orcamento|preco|valor pago)\b/],
  ['votos', /\b(voto|votacao|eleicao|candidato|urna)\b/],
];

export function suggestColumns(columns) {
  const normalized = columns.map(column => ({ ...column, normalized: normalize(column.name) }));
  const find = regex => normalized.find(column => regex.test(column.normalized));
  const numeric = normalized.filter(column => column.type === 'number');
  const value = numeric.find(column => /\b(valor|total|soma|amount|revenue|receita|preco|custo|despesa|votos|quantidade|qtd)\b/.test(column.normalized))
    || numeric.find(column => !/\b(id|codigo|cpf|cnpj|ano|mes)\b/.test(column.normalized)) || numeric[0];
  const period = normalized.find(column => column.type === 'date') || find(/\b(data|date|periodo|mes|ano|trimestre|semana)\b/);
  const kind = kindRules.find(([, regex]) => normalized.some(column => regex.test(column.normalized)))?.[0] || 'valores';
  const excluded = /\b(cpf|cnpj|email|e mail|telefone|celular|endereco|nome|senha|rg)\b/;
  const preferredDimension = /\b(categoria|municipio|cidade|estado|uf|regiao|produto|departamento|tipo|grupo|segmento|canal)\b/;
  const dims = normalized
    .filter(column => column.type === 'text' && column !== period && !excluded.test(column.normalized))
    .sort((a, b) => Number(preferredDimension.test(b.normalized)) - Number(preferredDimension.test(a.normalized)))
    .slice(0, 3)
    .map(column => column.name);

  return { kind, period: period?.name || '', value: value?.name || '', dims };
}
