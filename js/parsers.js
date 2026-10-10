'use strict';
/* Leitura dos arquivos (CSV, Excel, PDF, OFX) e normalização para lançamentos.
   Os arquivos nunca são alterados: tudo é lido em memória. */
const P = {};

P.progress = null;
P.decode = buf => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder('windows-1252').decode(buf); }
};

P.parseCsv = text => {
  const first = text.split(/\r?\n/).slice(0, 5).join('\n');
  const cnt = d => (first.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length;
  const sep = [';', '\t', ',', '|'].sort((a, b) => cnt(b) - cnt(a))[0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
};

P.readOfx = (text, name) => {
  const rows = [['Data', 'Descrição', 'Valor']];
  (text.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi) || []).forEach(b => {
    const g = t => { const m = b.match(new RegExp('<' + t + '>([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : ''; };
    const d = g('DTPOSTED').slice(0, 8);
    rows.push([d ? d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8) : '', g('MEMO') || g('NAME'), Number(g('TRNAMT').replace(',', '.'))]);
  });
  return { name, kind: 'ofx', sheets: [{ name: 'OFX', rows }], sheet: 0 };
};

const PDFJS = 'js/vendor/';
P.loadPdfjs = async () => {
  if (!window.pdfjsLib) await U.loadScript(PDFJS + 'pdf.min.js');
  if (!P._worker) {
    try {
      const blob = await fetch(PDFJS + 'pdf.worker.min.js').then(r => r.blob());
      P._worker = URL.createObjectURL(blob);
    } catch (e) { P._worker = PDFJS + 'pdf.worker.min.js'; }
    pdfjsLib.GlobalWorkerOptions.workerSrc = P._worker;
  }
};

const AMT = /-?\(?(?:R\$\s?)?\d{1,3}(?:\.\d{3})*,\d{2}\)?-?(?:\s?[CD](?![A-Za-z]))?/g;
P.readPdf = async (buf, name) => {
  await P.loadPdfjs();
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  const pages = [];
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const items = tc.items.filter(i => i.str.trim()).map(i => ({ s: i.str, x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));
    pages.push(items);
  }
  const total = pages.reduce((a, p) => a + p.length, 0);
  // 1) extrato Cora (texto)
  if (total && X.isCora(pages)) {
    const r = X.parseCora(pages);
    return { name, kind: 'pdf', sheets: [{ name: 'Extrato', rows: r.rows }], sheet: 0, meta: r.meta, preset: { headerRow: 1, date: 0, desc: 1, value: 2, credit: -1, debit: -1, type: -1, cat: -1, mode: 'single', invert: false, filterCol: -1, filterText: '' } };
  }
  // 2) PDF sem texto (desenhado/escaneado): OCR
  if (!total) {
    const r = await X.ocrCaixa(buf, P.progress);
    if (r.rows) {
      return { name, kind: 'pdf', sheets: [{ name: 'Caixa', rows: r.rows }], sheet: 0, meta: r.meta, preset: { headerRow: 1, date: 0, desc: 10, value: 9, credit: -1, debit: -1, type: -1, cat: -1, mode: 'single', invert: false, filterCol: r.meta.bankAcc ? 3 : -1, filterText: r.meta.bankAcc || '' } };
    }
    throw new Error('Este PDF não contém texto e o OCR não reconheceu o layout do relatório de caixa.');
  }
  // 3) PDF genérico com texto
  pages.forEach(items => {
    const rows = []; let cur = [], y = null;
    items.slice().sort((a, b) => b.y - a.y || a.x - b.x).forEach(i => { if (y !== null && Math.abs(i.y - y) > 3) { rows.push(cur); cur = []; } if (!cur.length) y = i.y; cur.push(i); });
    if (cur.length) rows.push(cur);
    rows.forEach(r => lines.push(r.sort((a, b) => a.x - b.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim()));
  });
  const years = {};
  lines.forEach(l => (l.match(/\d{2}\/\d{2}\/(\d{4})/g) || []).forEach(d => { const y = d.slice(-4); years[y] = (years[y] || 0) + 1; }));
  const best = Object.keys(years).sort((a, b) => years[b] - years[a])[0];
  const defYear = best ? +best : new Date().getFullYear();
  const rows = [['Data', 'Descrição', 'Valor']];
  lines.forEach(l => {
    const dm = l.match(/^\s*(\d{2}\/\d{2}(?:\/\d{2,4})?)\s+/);
    const am = [...l.matchAll(AMT)];
    if (!dm && !am.length) return;
    let desc = l;
    if (dm) desc = desc.slice(dm[0].length);
    am.forEach(a => { desc = desc.replace(a[0], ' '); });
    rows.push([dm ? dm[1] : '', desc.replace(/\s+/g, ' ').trim(), am.length ? am[0][0] : '']);
  });
  return { name, kind: 'pdf', sheets: [{ name: 'PDF', rows }], sheet: 0, defYear };
};

P.readFile = async file => {
  const ext = file.name.split('.').pop().toLowerCase();
  const buf = await file.arrayBuffer();
  if (ext === 'pdf') return P.readPdf(buf, file.name);
  if (ext === 'ofx') return P.readOfx(P.decode(buf), file.name);
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
    return { name: file.name, kind: 'csv', sheets: [{ name: 'CSV', rows: P.parseCsv(P.decode(buf)) }], sheet: 0 };
  }
  if (!window.XLSX) throw new Error('Biblioteca de Excel não carregada (verifique a conexão com a internet).');
  const wb = XLSX.read(buf, { type: 'array' });
  const sheets = wb.SheetNames.map(n => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }) }));
  return { name: file.name, kind: ext, sheets, sheet: 0 };
};

/* ---------- mapeamento de colunas ---------- */
const KW = {
  date: /^(data|dt|date|dia)\b|data\s*(do\s*)?(lancamento|movimento|operacao|mov|transacao|pagamento)/,
  desc: /historico|descricao|memo|detalhe|favorecido|complemento|lancamento|nome|observ/,
  value: /^(valor|vlr|montante|amount|quantia)/,
  credit: /credito|entrada|recebimento|receita/,
  debit: /debito|saida|pagamento|despesa/,
  type: /^(tipo|d\/c|c\/d|natureza|dc)$/,
  cat: /categoria|centro de custo|classificacao|plano de contas/,
};

P.detectHeader = rows => {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const hits = (rows[i] || []).filter(c => typeof c === 'string' && c.trim() && Object.values(KW).some(re => re.test(U.norm(c)))).length;
    if (hits >= 2) return i + 1;
  }
  return 0;
};

P.labels = (rows, hr) => {
  const width = Math.max(1, ...rows.slice(0, 60).map(r => (r || []).length));
  return Array.from({ length: width }, (_, i) => {
    const h = hr > 0 && rows[hr - 1] ? String(rows[hr - 1][i] == null ? '' : rows[hr - 1][i]).trim() : '';
    return U.colName(i) + (h ? ' – ' + h : '');
  });
};

P.autoMap = (rows, hr) => {
  const width = P.labels(rows, hr).length;
  const m = { date: -1, desc: -1, value: -1, credit: -1, debit: -1, type: -1, cat: -1, mode: 'single' };
  const taken = new Set();
  if (hr > 0) {
    const head = (rows[hr - 1] || []).map(U.norm);
    ['date', 'value', 'type', 'cat', 'credit', 'debit', 'desc'].forEach(k => {
      const i = head.findIndex((h, idx) => !taken.has(idx) && h && KW[k].test(h));
      if (i >= 0) { m[k] = i; taken.add(i); }
    });
  }
  // fallback por conteúdo
  const sample = rows.slice(hr, hr + 40).filter(r => r && r.some(c => c !== ''));
  const ratio = (col, fn) => sample.length ? sample.filter(r => fn(r[col])).length / sample.length : 0;
  if (m.date < 0) {
    let best = -1, bs = 0.5;
    for (let c = 0; c < width; c++) { if (taken.has(c)) continue; const r = ratio(c, v => U.parseDate(v, 2000) != null); if (r > bs) { bs = r; best = c; } }
    if (best >= 0) { m.date = best; taken.add(best); }
  }
  if (m.value < 0 && m.credit < 0 && m.debit < 0) {
    let best = -1, bs = 0.5;
    for (let c = 0; c < width; c++) { if (taken.has(c)) continue; const r = ratio(c, v => v !== '' && U.parseAmount(v) != null); if (r > bs) { bs = r; best = c; } }
    if (best >= 0) { m.value = best; taken.add(best); }
  }
  if (m.desc < 0) {
    let best = -1, bl = 0;
    for (let c = 0; c < width; c++) {
      if (taken.has(c)) continue;
      const avg = sample.reduce((a, r) => a + (typeof r[c] === 'string' && U.parseAmount(r[c]) == null ? r[c].length : 0), 0) / (sample.length || 1);
      if (avg > bl) { bl = avg; best = c; }
    }
    if (best >= 0 && bl > 3) m.desc = best;
  }
  if (m.value < 0 && (m.credit >= 0 || m.debit >= 0)) m.mode = 'split';
  return m;
};

P.makeCfg = file => {
  if (file.preset) return Object.assign({}, file.preset);
  const rows = file.sheets[file.sheet].rows;
  const headerRow = P.detectHeader(rows);
  return Object.assign({ headerRow, invert: false }, P.autoMap(rows, headerRow));
};

/* ---------- normalização ---------- */
const DEB = /^(d|deb|debito|saida|s|pagamento|despesa|pgto)\b/;
const CRE = /^(c|cred|credito|entrada|e|receb|recebimento|receita)\b/;
const SALDO = /^(saldo|sdo|s a l d o|total)\b/;

P.normalize = (file, cfg) => {
  const rows = file.sheets[file.sheet].rows;
  const defYear = file.defYear || new Date().getFullYear();
  const items = [], ignored = [], filtered = [];
  const cell = (r, i) => (i >= 0 && r[i] != null ? r[i] : '');
  for (let i = cfg.headerRow; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every(c => c === '' || c == null)) continue;
    if (cfg.filterCol >= 0 && cfg.filterText && !U.norm(r[cfg.filterCol]).includes(U.norm(cfg.filterText))) { filtered.push({ line: i + 1, raw: r.map(c => (c == null ? '' : String(c))).join(' | ') }); continue; }
    const date = cfg.date >= 0 ? U.parseDate(cell(r, cfg.date), defYear) : null;
    const desc = String(cell(r, cfg.desc)).trim();
    let cents = null;
    if (cfg.mode === 'split') {
      const cr = U.parseAmount(cell(r, cfg.credit)), db = U.parseAmount(cell(r, cfg.debit));
      if (cr != null || db != null) cents = Math.abs(cr || 0) - Math.abs(db || 0);
    } else {
      let v = U.parseAmount(cell(r, cfg.value));
      if (v != null && cfg.type >= 0) {
        const t = U.norm(cell(r, cfg.type));
        if (DEB.test(t)) v = -Math.abs(v); else if (CRE.test(t)) v = Math.abs(v);
      }
      cents = v;
    }
    if (cents != null && cfg.invert) cents = -cents;
    const line = i + 1;
    const raw = r.map(c => (c == null ? '' : String(c))).join(' | ');
    if (date == null && cents == null) { ignored.push({ line, kind: 'info', reason: 'Sem data e sem valor (título/rodapé)', raw }); continue; }
    if (SALDO.test(U.norm(desc))) { ignored.push({ line, kind: 'info', reason: 'Linha de saldo/total', raw }); continue; }
    if (date == null) { ignored.push({ line, kind: 'warn', reason: 'Valor sem data válida', raw }); continue; }
    if (cents == null) { ignored.push({ line, kind: 'warn', reason: 'Data sem valor válido', raw }); continue; }
    items.push({ id: (file._side || 'x') + line, line, date, day: U.isoToDay(date), desc, cents, cat: cfg.cat >= 0 ? String(cell(r, cfg.cat)).trim() : '' });
  }
  return { items, ignored, filtered };
};
