// Tema único dos gráficos. Regra: UMA cor de dado (o que importa) e um cinza-azulado para o resto.
// As cores precisam ser literais porque o Recharts as escreve direto no SVG.
export const C = {
  data: '#2dd4bf',    // o dado principal (período atual, maior categoria)
  rest: '#364070',    // o contexto (períodos anteriores, demais categorias)
  compare: '#8f84ff', // segundo período, só nas comparações
  grid: '#232846',
  axis: '#8d93bd',
};
export const tooltipProps = {
  contentStyle: { background: '#161a31', border: '1px solid #2c3256', borderRadius: 8, fontSize: 13 },
  labelStyle: { color: '#a4aacb', marginBottom: 2 },
  itemStyle: { color: '#e9ebff' },
  cursor: { fill: 'rgb(255 255 255 / 4%)' },
};
export const axisProps = { stroke: C.axis, fontSize: 11, tickLine: false, axisLine: false };
// Eixo Y curto: 1,2 mi / 350 mil, em vez de "1.234.567,89" ocupando 70px
export const compact = n => Number.isFinite(+n)
  ? new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : '';
