'use strict';
/* Utilitários: formatação pt-BR, datas, valores (em centavos) e similaridade de texto */
const U = {};

U.brl = c => (c < 0 ? '-' : '') + 'R$ ' + (Math.abs(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
U.pct = v => (v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
U.norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
U.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

U.iso2br = iso => (iso ? iso.split('-').reverse().join('/') : '');
U.iso2short = iso => (iso ? iso.split('-').reverse().slice(0, 2).join('/') : '');
U.isoToDay = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
U.dayToIso = n => new Date(n * 864e5).toISOString().slice(0, 10);

U.colName = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; };

function chkDate(y, mo, d) {
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/* Aceita: serial do Excel, Date, dd/mm/aaaa, dd-mm-aa, aaaa-mm-dd, dd/mm (com ano padrão) */
U.parseDate = (v, defYear) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : chkDate(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === 'number') return v > 20000 && v < 80000 ? U.dayToIso(Math.floor(v) - 25569) : null;
  const s = String(v).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return chkDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?!\d)/))) { let y = +m[3]; if (y < 100) y += 2000; return chkDate(y, +m[2], +m[1]); }
  if (defYear && (m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})(?![\d\/.\-])/))) return chkDate(defYear, +m[2], +m[1]);
  return null;
};

/* Retorna centavos (inteiro) ou null. Aceita 1.234,56 | -1234.56 | (1.234,56) | 1.234,56 D | R$ 10,00 */
U.parseAmount = v => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v * 100) : null;
  let s = String(v).trim().replace(/R\$|\s/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
  const tail = s.match(/([CD])$/i);
  if (tail) { if (tail[1].toUpperCase() === 'D') neg = true; s = s.slice(0, -1); }
  if (/^-/.test(s)) { neg = true; s = s.slice(1); }
  if (/^\+/.test(s)) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (lc >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else if (ld >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!isFinite(n)) return null;
  const c = Math.round(n * 100);
  return (neg ? -c : c) || 0;
};

const STOP = new Set(['pix', 'ted', 'doc', 'de', 'da', 'do', 'das', 'dos', 'em', 'pgto', 'pagto', 'pagamento', 'compra', 'transf', 'transferencia', 'recebido', 'recebimento', 'enviado', 'cred', 'deb', 'ref', 'para', 'por', 'com', 'no', 'na', 'cliente', 'fornecedor']);
U.tokens = s => U.norm(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));

/* Similaridade 0..1 entre descrições */
U.sim = (a, b) => {
  const na = U.norm(a), nb = U.norm(b);
  if (na && na === nb) return 1;
  const A = new Set(U.tokens(a)), B = new Set(U.tokens(b));
  if (!A.size || !B.size) return 0;
  let i = 0; A.forEach(t => { if (B.has(t)) i++; });
  return Math.max(i / (A.size + B.size - i), 0.85 * i / Math.min(A.size, B.size));
};

U.loadScript = src => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = () => rej(new Error('Falha ao carregar ' + src));
  document.head.appendChild(s);
});

U.download = (name, blob) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
