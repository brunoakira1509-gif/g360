// Leitura e interpretação de planilhas. Tudo roda no navegador.
// Regra de ouro: nada vira 0 em silêncio. Valor que não dá para interpretar vira null e é contado.

const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  feb: 2, apr: 4, may: 5, aug: 8, sep: 9, oct: 10, dec: 12 };
const pad = n => String(n).padStart(2, '0');
const blank = v => v == null || (typeof v === 'string' && v.trim() === '');

// "1.234,56", "1,234.56", "R$ 1.234,56", "(1.234,56)", "-12%", "1234" -> número | null
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (blank(v) || typeof v === 'boolean') return null;
  let s = String(v).trim().replace(/[\s\u00a0]/g, '');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^(R\$|US\$|\$|€)/i, '').replace(/%$/, '');
  if (s.startsWith('-') || s.startsWith('−')) { neg = !neg; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  let t;
  if (lc > -1 && ld > -1) {
    // os dois aparecem: o último é o decimal
    const dec = lc > ld ? ',' : '.', mil = dec === ',' ? '.' : ',';
    t = s.split(mil).join('').replace(dec, '.');
  } else if (lc > -1 || ld > -1) {
    const sep = lc > -1 ? ',' : '.', parts = s.split(sep);
    if (parts.length > 2) t = parts.join('');                       // 1.234.567 -> milhar
    else if (sep === ',') t = parts[0] + '.' + parts[1];            // 12,5 -> decimal (padrão pt-BR)
    else if (parts[1].length === 3 && parts[0].length <= 3 && parts[0] !== '0') t = parts.join(''); // 1.234 -> milhar
    else t = s;                                                     // 12.5 / 0.123 -> decimal
  } else t = s;
  const n = Number(t);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

// Aceita 2025-03-07, 07/03/2025, 7/3/25, 03/2025, 2025-03, jan/2025, jan-25 -> 'YYYY-MM-DD' ou 'YYYY-MM' | null
export function parseDateText(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  let m;
  const ok = (y, mo, d) => (mo >= 1 && mo <= 12 && (d == null || (d >= 1 && d <= 31)) && y >= 1900 && y <= 2200);
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t\s].*)?$/))) return ok(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : null;
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})$/))) return ok(+m[1], +m[2]) ? `${m[1]}-${pad(+m[2])}` : null;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:\s.*)?$/))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return ok(y, +m[2], +m[1]) ? `${y}-${pad(+m[2])}-${pad(+m[1])}` : null;
  }
  if ((m = s.match(/^(\d{1,2})[/.-](\d{4})$/))) return ok(+m[2], +m[1]) ? `${m[2]}-${pad(+m[1])}` : null;
  if ((m = s.match(/^([a-zç]{3})[a-z]*[/.\s-]+(\d{2}|\d{4})$/)) && MESES[m[1]]) {
    const y = m[2].length === 2 ? 2000 + +m[2] : +m[2];
    return `${y}-${pad(MESES[m[1]])}`;
  }
  return null;
}

// Serial do Excel -> 'YYYY-MM-DD' (sem fuso horário, direto do número)
export function serialToIso(serial) {
  const ms = Math.round((serial - 25569) * 86400000);   // 25569 = 1970-01-01 no calendário do Excel
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

// Período normalizado para ordenar certo: 'YYYY-MM' quando é data; senão o texto limpo
export function toPeriod(v) {
  if (blank(v)) return '';
  const s = String(v).trim();
  const d = parseDateText(s);
  if (d) return d.slice(0, 7);
  return s.replace(/[^0-9A-Za-zÀ-ÿ _./:-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

// ---------- CSV ----------
function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }   // CSV do Excel brasileiro
}
export function parseCsv(text) {
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  const count = c => first.split(c).length - 1;
  const delim = [';', '\t', ',', '|'].reduce((best, c) => count(c) > count(best) ? c : best, ';');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------- Tabela ----------
function toTable(matrix, name) {
  const filled = matrix.map(r => r.filter(c => !blank(c)).length);
  const width = Math.max(0, ...filled);
  let h = filled.findIndex(n => n >= Math.min(2, width) && n > 0);
  if (h < 0) return { name, headers: [], rows: [] };
  const seen = new Map();
  const ncol = Math.max(...matrix.slice(h).map(r => r.length));
  const headers = Array.from({ length: ncol }, (_, i) => {
    let base = blank(matrix[h][i]) ? `Coluna ${i + 1}` : String(matrix[h][i]).trim().slice(0, 80);
    const n = (seen.get(base) || 0) + 1; seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });
  const rows = matrix.slice(h + 1).filter(r => r.some(c => !blank(c))).map(r => headers.map((_, i) => r[i] ?? ''));
  return { name, headers, rows };
}

// Lê .xlsx/.xls/.csv. Devolve { tables: [{name, headers, rows(array de arrays)}] }, uma tabela por aba.
export function readSpreadsheet(XLSX, buffer, fileName) {
  if (/\.(csv|tsv|txt)$/i.test(fileName)) return { tables: [toTable(parseCsv(decodeText(buffer)), 'CSV')] };
  const wb = XLSX.read(buffer, { type: 'array', cellNF: true });
  const tables = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]; if (!ws || !ws['!ref']) continue;
    const r = XLSX.utils.decode_range(ws['!ref']), matrix = [];
    for (let R = r.s.r; R <= r.e.r; R++) {
      const line = [];
      for (let C = r.s.c; C <= r.e.c; C++) {
        const c = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        let v = '';
        if (c && c.t !== 'z' && c.t !== 'e') {
          // data pelo formato da célula: converte o serial direto, sem fuso horário
          if (c.t === 'n' && c.z && XLSX.SSF.is_date(c.z) && c.v >= 1) v = serialToIso(c.v);
          else v = c.v;
        }
        line.push(v);
      }
      matrix.push(line);
    }
    const t = toTable(matrix, name);
    if (t.headers.length && t.rows.length) tables.push(t);
  }
  return { tables };
}

// Inferência de tipo por coluna: number | date | text. Conta o que não foi entendido.
export function inferColumns(table) {
  return table.headers.map((name, i) => {
    const vals = table.rows.map(r => r[i]).filter(v => !blank(v));
    const n = vals.length;
    const nums = vals.filter(v => parseNumber(v) != null).length;
    const dates = vals.filter(v => typeof v === 'string' && parseDateText(v)).length;
    const distinct = new Set(vals.map(String)).size;
    let type = 'text';
    if (n && dates / n >= .9) type = 'date';
    else if (n && nums / n >= .7) type = 'number';
    return { name, index: i, type, filled: n, empty: table.rows.length - n, distinct, invalid: type === 'number' ? n - nums : 0 };
  });
}
