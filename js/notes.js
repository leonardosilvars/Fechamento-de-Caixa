'use strict';
/* Divergências Notas: lê notas/recibos digitalizados (imagem, PDF, texto, XML, HTML, Word, planilha),
   extrai nome, data e valor e confere com o caixa da empresa. Somente leitura. */
const N = {};

N.TYPES = {
  ok: { label: 'Com nota', color: '#16a34a' },
  only_caixa: { label: 'Caixa sem nota', color: '#d97706' },
  only_bank: { label: 'Nota sem lançamento no caixa', color: '#2563eb' },
  value: { label: 'Valor divergente', color: '#dc2626' },
  date: { label: 'Data divergente', color: '#7c3aed' },
  dup: { label: 'Possível duplicidade', color: '#be185d' },
  unread: { label: 'Nota não interpretada', color: '#64748b' },
};

N.s = {
  files: [], items: [], nextId: 1, result: null, busy: false,
  opts: { window: 60, tolOk: 30, valueTol: 0, simMin: 0.5, splitPages: false, saidas: true, entradas: true, ignore: 'transferência' },
  filt: { show: 'pending', types: new Set(), q: '', limit: 150 },
};
N.reset = () => { N.s.files = []; N.s.items = []; N.s.result = null; N.s.nextId = 1; N.s.filt = { show: 'pending', types: new Set(), q: '', limit: 150 }; };

/* ---------------- leitura de arquivos ---------------- */
N.kind = name => {
  const e = (name.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff'].includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (['txt', 'md', 'rtf', 'log', 'json', 'tsv', 'text'].includes(e)) return 'text';
  if (['csv', 'xlsx', 'xls', 'ods'].includes(e)) return 'sheet';
  if (e === 'xml') return 'xml';
  if (['html', 'htm'].includes(e)) return 'html';
  if (e === 'docx') return 'docx';
  return 'unknown';
};

N.unzip = async (buf, wanted) => {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('arquivo ZIP inválido');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.slice(p + 46, p + 46 + nl));
    if (name === wanted) {
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const data = u8.slice(start, start + csize);
      if (method === 0) return data;
      const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      return new Uint8Array(out);
    }
    p += 46 + nl + el + cl;
  }
  return null;
};

/* OCR compartilhado (Tesseract local) */
N.getSched = async () => {
  if (location.protocol === 'file:') throw new Error('OCR indisponível com o arquivo aberto direto; abra pelo atalho .bat ou pelo site publicado');
  if (N._sched) return N._sched;
  if (!window.Tesseract) await U.loadScript('js/vendor/tesseract/tesseract.min.js');
  const base = 'js/vendor/tesseract/', s = Tesseract.createScheduler();
  const nW = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
  for (let i = 0; i < nW; i++) s.addWorker(await Tesseract.createWorker('por', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base, gzip: false, workerBlobURL: false }));
  N._sched = s;
  return s;
};
N.closeSched = async () => { if (N._sched) { const s = N._sched; N._sched = null; await s.terminate(); } };
N.ocr = async canvas => { const s = await N.getSched(); const r = await s.addJob('recognize', canvas); return r.data.text || ''; };

N.imageToCanvas = async file => {
  const bmp = await createImageBitmap(file);
  const longest = Math.max(bmp.width, bmp.height);
  const scale = longest < 1400 ? 1400 / longest : longest > 3200 ? 3200 / longest : 1;
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
  const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv;
};

/* devolve [{label, text, ocr}] — um por arquivo (ou por página, se splitPages) */
N.readText = async (file, splitPages) => {
  const kind = N.kind(file.name);
  const one = (text, ocr) => [{ label: '', text, ocr: !!ocr }];
  if (kind === 'image') return one(await N.ocr(await N.imageToCanvas(file)), true);
  if (kind === 'pdf') {
    await P.loadPdfjs();
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      const items = tc.items.filter(i => i.str.trim()).map(i => ({ s: i.str, x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) }));
      pages.push(groupRows(items).map(r => r.map(i => i.s).join(' ')).join('\n'));
    }
    let usedOcr = false;
    if (pages.join('').replace(/\s/g, '').length < 20) {           // PDF digitalizado: OCR página a página
      usedOcr = true;
      const raf = window.requestAnimationFrame; window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 0);
      try {
        for (let p = 1; p <= pdf.numPages; p++) {
          const pg = await pdf.getPage(p), vp = pg.getViewport({ scale: 2.2 });
          const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
          const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
          await pg.render({ canvasContext: ctx, viewport: vp }).promise;
          pages[p - 1] = await N.ocr(cv);
        }
      } finally { window.requestAnimationFrame = raf; }
    }
    if (splitPages && pages.length > 1) return pages.map((t, i) => ({ label: 'p.' + (i + 1), text: t, ocr: usedOcr }));
    return one(pages.join('\n'), usedOcr);
  }
  if (kind === 'xml') return one(await file.text());
  if (kind === 'html') {
    const html = (await file.text()).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<\/(p|div|tr|li|h\d|table|section)>|<br\s*\/?>/gi, '\n').replace(/<\/t[dh]>/gi, '  ');
    return one(new DOMParser().parseFromString(html, 'text/html').body.textContent);
  }
  if (kind === 'docx') {
    const xml = await N.unzip(await file.arrayBuffer(), 'word/document.xml');
    if (!xml) throw new Error('documento Word sem conteúdo');
    return one(new TextDecoder().decode(xml).replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '  ').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }
  if (kind === 'sheet') {
    if (/\.csv$/i.test(file.name)) return one(P.decode(await file.arrayBuffer()).replace(/;/g, '  '));
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return one(wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }).map(r => r.join('  ')).join('\n')).join('\n'));
  }
  const txt = P.decode(await file.arrayBuffer());
  if (kind === 'text' || /^[\x09\x0a\x0d\x20-\x7e -￿]*$/.test(txt.slice(0, 2000))) return one(txt);
  throw new Error('formato não suportado');
};

/* ---------------- extração de nome, data e valor ---------------- */
const MONTHS = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
const MON_RE = /(?:R\s?\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/g;
const BAD_NAME = /nota fiscal|cupom|recibo|danfe|extrato|comprovante|documento|via do|consumidor|cnpj|cpf|data|valor|total|pagamento|inscri|endereco|telefone|\bvia\b|^\d/;

N.xmlFields = text => {
  let doc;
  try { doc = new DOMParser().parseFromString(text, 'application/xml'); } catch (e) { return null; }
  if (doc.querySelector('parsererror')) return null;
  const tag = (...names) => { for (const n of names) { const el = doc.getElementsByTagName(n)[0] || doc.getElementsByTagNameNS('*', n)[0]; if (el && el.textContent.trim()) return el.textContent.trim(); } return ''; };
  const emit = doc.getElementsByTagName('emit')[0], dest = doc.getElementsByTagName('dest')[0];
  const sub = (el, n) => { const x = el && el.getElementsByTagName(n)[0]; return x ? x.textContent.trim() : ''; };
  const names = [sub(emit, 'xNome'), sub(dest, 'xNome')].filter(Boolean);
  if (!names.length) names.push(...[tag('RazaoSocial'), tag('NomeFantasia'), tag('xNome')].filter(Boolean));
  const v = tag('vNF', 'ValorLiquidoNfse', 'ValorServicos', 'vLiq', 'vOrig', 'Valor', 'valor');
  const d = tag('dhEmi', 'dEmi', 'DataEmissao', 'dhProc', 'data');
  const cents = v ? U.parseAmount(/,/.test(v) ? v : Number(v)) : null;
  return { names, cents, date: d ? U.parseDate(d.slice(0, 10)) || U.parseDate(d) : null, doc: sub(emit, 'CNPJ') || tag('Cnpj', 'CNPJ') };
};

N.extract = (text, kind) => {
  if (kind === 'xml') { const x = N.xmlFields(text); if (x && (x.cents != null || x.date)) return Object.assign({ via: 'XML' }, x); }
  const lines = text.replace(/\r/g, '\n').split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // --- valor ---
  const STRONG = /valor total|total a pagar|total geral|total da nota|total nota|valor liquido|valor a pagar|vl\.? total|vlr\.? total|valor do documento|valor pago|total pago|valor recebido|importancia|total r\$|^total\b/;
  const WEAK = /\bvalor\b|\btotal\b|r\$|quantia|pago|recebi/;
  const NEG = /troco|desconto|subtotal|sub-total|icms|\biss\b|\bpis\b|cofins|base de c|acrescimo|juros|multa|tribut|frete|dinheiro|cartao|qtd|quantidade|unit/;
  let best = null;
  lines.forEach((ln, i) => {
    const L = U.norm(ln), prev = i ? U.norm(lines[i - 1]) : '';
    for (const m of ln.matchAll(MON_RE)) {
      const cents = U.parseAmount(m[1]);
      if (!cents) continue;
      let sc = 0;
      if (STRONG.test(L)) sc += 6; else if (WEAK.test(L)) sc += 3;
      if (NEG.test(L) && !STRONG.test(L)) sc -= 4;
      if (STRONG.test(prev) && !/\d{1,3},\d{2}/.test(prev)) sc += 3;
      sc += Math.min(cents / 1e9, 0.5);
      if (!best || sc > best.sc || (sc === best.sc && cents > best.cents)) best = { sc, cents };
    }
  });
  // --- data ---
  let bd = null;
  lines.forEach((ln, i) => {
    const L = U.norm(ln);
    const found = [];
    for (const m of ln.matchAll(/\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g)) found.push(U.parseDate(m[1]));
    for (const m of U.norm(ln).matchAll(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/g)) if (MONTHS[m[2]]) found.push(U.parseDate(m[1] + '/' + MONTHS[m[2]] + '/' + m[3]));
    found.filter(Boolean).forEach(iso => {
      let sc = 1 - i * 0.01;
      if (/emiss|emitid/.test(L)) sc += 5; else if (/\bdata\b/.test(L)) sc += 3; else if (/pagamento|pago em|recebi|quitac/.test(L)) sc += 2;
      if (/vencimento|venc\b|nascimento|validade/.test(L)) sc -= 3;
      if (!bd || sc > bd.sc) bd = { sc, iso };
    });
  });
  // --- nomes ---
  const names = [];
  const add = s => { s = (s || '').replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b.*$/, '').replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b.*$/, '').replace(/\s*(CNPJ|CPF|IE|Inscri).*$/i, '').replace(/[:;|]+$/, '').trim(); if (s.length >= 3 && s.length <= 80 && /[A-Za-zÀ-ú]{3}/.test(s) && !names.includes(s)) names.push(s); };
  lines.forEach((ln, i) => {
    let m = ln.match(/(?:raz[ãa]o social|nome\s*\/\s*raz[ãa]o social|nome fantasia|emitente|favorecido|benefici[áa]rio|prestador(?: de servi[çc]os?)?|cedente|fornecedor|credor|recebedor|estabelecimento|loja)\s*[:\-]\s*(.+)/i);
    if (m) add(m[1]);
    m = ln.match(/recebi(?:emos)?\s+d[eo]\s+(.+?)(?:\s+(?:a\s+import|a\s+quantia|o\s+valor|a\s+soma|CPF|CNPJ|inscrit)|,|$)/i);
    if (m) add(m[1]);
    m = ln.match(/(?:pagador|sacado|cliente|destinat[áa]rio|tomador|nome)\s*[:\-]\s*(.+)/i);
    if (m) add(m[1]);
    if (/^(raz[ãa]o social|emitente|nome|favorecido)\s*[:\-]?\s*$/i.test(ln) && lines[i + 1]) add(lines[i + 1]);
  });
  if (!names.length) {
    for (const ln of lines.slice(0, 8)) {
      if (ln.length > 60 || !/[A-Za-zÀ-ú]{3,}\s+[A-Za-zÀ-ú]{2,}/.test(ln) || BAD_NAME.test(U.norm(ln))) continue;
      add(ln); if (names.length) break;
    }
  }
  const cnpj = (text.match(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/) || text.match(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/) || [''])[0];
  return { via: 'texto', names, cents: best ? best.cents : null, date: bd ? bd.iso : null, doc: cnpj };
};

/* ---------------- carga de arquivos ---------------- */
N.addFiles = async fileList => {
  const s = N.s;
  const list = [...fileList].filter(f => f.size >= 0 && !/^\./.test(f.name) && !/^(thumbs\.db|desktop\.ini)$/i.test(f.name));
  const fresh = list.filter(f => !s.files.some(x => x.name === (f.webkitRelativePath || f.name) && x.size === f.size));
  if (!fresh.length) { toast('Nenhum arquivo novo para ler.'); return; }
  const entries = fresh.map(f => ({ id: s.nextId++, name: f.webkitRelativePath || f.name, size: f.size, kind: N.kind(f.name), status: 'fila', msg: '', file: f }));
  s.files.push(...entries);
  let done = 0;
  busy(true, 'Lendo notas e recibos', 0, entries.length + ' arquivo(s)…');
  const raf = window.requestAnimationFrame;
  let idx = 0;
  const worker = async () => {
    while (idx < entries.length) {
      const e = entries[idx++];
      try {
        e.status = 'lendo';
        const parts = await N.readText(e.file, s.opts.splitPages);
        parts.forEach((pt, k) => {
          const x = N.extract(pt.text, e.kind);
          s.items.push({ id: s.nextId++, fileId: e.id, file: e.name + (pt.label ? ' (' + pt.label + ')' : ''), kind: e.kind, ocr: pt.ocr, via: x.via, names: x.names || [], date: x.date || null, cents: x.cents == null ? null : Math.abs(x.cents), doc: x.doc || '', text: pt.text.slice(0, 4000), edited: false });
        });
        e.status = 'lida'; e.msg = parts.some(p => p.ocr) ? 'OCR' : '';
      } catch (err) { e.status = 'erro'; e.msg = String(err.message || err); }
      done++;
      busy(true, 'Lendo notas e recibos', done / entries.length, 'Arquivo ' + done + ' de ' + entries.length + (e.kind === 'image' || e.kind === 'pdf' ? ' (pode usar OCR)' : ''));
    }
  };
  try {
    await Promise.all([worker(), worker(), worker()]);
  } finally { window.requestAnimationFrame = raf; busy(false); await N.closeSched(); }
  const bad = entries.filter(e => e.status === 'erro').length;
  toast(entries.length - bad + ' nota(s) lida(s)' + (bad ? ', ' + bad + ' com erro' : '') + '.', !!bad);
  renderAll();
};

N.collectDrop = async dt => {
  const entries = [...(dt.items || [])].map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const files = [];
  const walk = async en => {
    if (en.isFile) files.push(await new Promise(r => en.file(r)));
    else if (en.isDirectory) {
      const rd = en.createReader(); let batch;
      do { batch = await new Promise(r => rd.readEntries(r)); for (const c of batch) await walk(c); } while (batch.length);
    }
  };
  for (const en of entries) await walk(en);
  return files;
};

/* ---------------- conferência notas x caixa ---------------- */
N.caixaItems = () => {
  const o = N.s.opts, ig = o.ignore.split(',').map(x => U.norm(x)).filter(Boolean);
  return (S.norm.caixa ? S.norm.caixa.items : []).filter(c => {
    if (c.cents < 0 && !o.saidas) return false;
    if (c.cents > 0 && !o.entradas) return false;
    const d = U.norm(c.desc);
    return !ig.some(g => d.includes(g));
  });
};

N.noteName = n => n.names[0] || '';
N.run = () => {
  const s = N.s, o = s.opts;
  s.result = null;
  const caixaAll = S.norm.caixa ? S.norm.caixa.items : [];
  if (!caixaAll.length) return;
  const valid = s.items.filter(n => n.cents != null && n.date);
  const bank = valid.map(n => ({ id: 'N' + n.id, line: n.file, date: n.date, day: U.isoToDay(n.date), desc: n.names.join(' ') + ' ' + (n.text || '').replace(/\s+/g, ' ').slice(0, 400), cents: n.cents, noteId: n.id, shown: N.noteName(n) }));
  const caixaReq = N.caixaItems();
  const cx = caixaReq.map(c => Object.assign({}, c, { signed: c.cents, cents: Math.abs(c.cents) }));
  const res = E.reconcile(bank, cx, { window: o.window, tolOk: o.tolOk, valueTol: o.valueTol, simMin: o.simMin, flagDesc: false, opening: 0, preferName: true });
  const brl = U.brl;
  const nTxt = b => '"' + b.line + '"' + (b.shown ? ' (' + b.shown + ')' : '');
  const issues = res.issues.map(i => {
    const b = i.bank, c = i.caixa; let action = i.action;
    if (i.type === 'only_bank') action = 'Nota ' + nTxt(b) + ' de ' + brl(b.cents) + ' em ' + U.iso2br(b.date) + ' não tem lançamento correspondente no caixa. Lance a movimentação ou confira data/valor da nota.';
    else if (i.type === 'only_caixa') action = 'Falta nota/recibo para o lançamento da linha ' + c.line + ' do caixa: ' + (c.desc || 'sem descrição') + ', ' + brl(c.signed) + ' em ' + U.iso2br(c.date) + '.';
    else if (i.type === 'value') action = 'Valor da nota ' + nTxt(b) + ' (' + brl(b.cents) + ') difere do caixa, linha ' + c.line + ' (' + brl(c.cents) + '): diferença de ' + brl(Math.abs(b.cents - c.cents)) + '.';
    else if (i.type === 'date') action = 'A nota ' + nTxt(b) + ' tem data ' + U.iso2br(b.date) + ' e o caixa (linha ' + c.line + ') ' + U.iso2br(c.date) + ' — ' + Math.abs(b.day - c.day) + ' dia(s) de diferença.';
    else if (i.type === 'dup') action = b ? 'Possível nota duplicada ' + nTxt(b) + ': há outra nota idêntica e o caixa não tem este valor repetido.' : 'Possível lançamento duplicado na linha ' + c.line + ' do caixa: há outro igual e só uma nota.';
    return Object.assign({}, i, { action });
  });
  s.items.filter(n => n.cents == null || !n.date).forEach(n => {
    issues.push({ key: 'unread|' + n.id, type: 'unread', bank: { line: n.file, date: n.date || '', cents: n.cents == null ? 0 : n.cents, desc: n.names.join(' '), shown: N.noteName(n), noteId: n.id }, caixa: null, diff: 0, action: 'Não foi possível identificar ' + [n.cents == null ? 'o valor' : '', !n.date ? 'a data' : ''].filter(Boolean).join(' e ') + ' da nota "' + n.file + '". Informe manualmente na tabela "Notas lidas".' });
  });
  const matched = res.matched.map(m => Object.assign({}, m, { action: m.group || m.groupBank ? m.action : 'Nota localizada' }));
  const cover = matched.length + res.issues.filter(i => i.bank && i.caixa).length;
  s.result = {
    issues, matched, counts: Object.assign({ unread: 0 }, res.counts, { unread: issues.filter(i => i.type === 'unread').length }),
    caixaRequired: cx.length, caixaIgnored: caixaAll.length - cx.length, notes: s.items.length, noteValid: valid.length,
    withNote: matched.length, withNoteDiv: res.issues.filter(i => (i.type === 'value' || i.type === 'date')).length,
    semNota: res.issues.filter(i => i.type === 'only_caixa' || (i.type === 'dup' && i.caixa && !i.bank)),
    notaSemCaixa: res.issues.filter(i => i.type === 'only_bank' || (i.type === 'dup' && i.bank && !i.caixa)),
    pct: cx.length ? cover / cx.length : 0,
  };
  s.result.valSemNota = s.result.semNota.reduce((a, i) => a + Math.abs(i.caixa.cents), 0);
  s.result.valNotaSemCaixa = s.result.notaSemCaixa.reduce((a, i) => a + Math.abs(i.bank.cents), 0);
};

/* ---------------- tela ---------------- */
const nSide = (x, isNote) => {
  if (!x) return '<span class="muted">— não consta —</span>';
  if (isNote) return `<div class="ln">Arquivo</div><div class="dsc">${esc(x.line)}</div><div class="meta">${esc(x.shown || '') ? esc(x.shown) + '<br>' : ''}${x.date ? U.iso2br(x.date) : '<i>sem data</i>'} · <b>${x.cents ? U.brl(x.cents) : '<i>sem valor</i>'}</b></div>`;
  return `<div class="ln">Linha ${x.line}</div><div class="dsc">${esc(x.desc) || '<i>sem descrição</i>'}</div><div class="meta">${U.iso2br(x.date)} · <b class="${(x.signed != null ? x.signed : x.cents) < 0 ? 'neg' : 'pos'}">${U.brl(x.signed != null ? x.signed : x.cents)}</b></div>`;
};

N.list = () => {
  const r = N.s.result, f = N.s.filt;
  let l = f.show === 'pending' ? r.issues : f.show === 'ok' ? r.matched : r.issues.concat(r.matched);
  if (f.types.size) l = l.filter(i => f.types.has(i.type));
  if (f.q) {
    const q = U.norm(f.q);
    l = l.filter(i => U.norm([i.bank && i.bank.line, i.bank && i.bank.desc, i.caixa && i.caixa.desc, i.bank && U.brl(i.bank.cents), i.caixa && U.brl(i.caixa.cents), i.action].join(' ')).includes(q));
  }
  return l;
};

N.view = () => {
  const s = N.s, o = s.opts, r = s.result, f = s.filt;
  const hasCaixa = !!(S.norm.caixa && S.norm.caixa.items.length);
  const chk = (k, lab) => `<label class="chk"><input type="checkbox" data-nopt="${k}" ${o[k] ? 'checked' : ''}> ${lab}</label>`;
  const num = (k, lab, min = 0, max = 365) => `<label>${lab}<input type="number" min="${min}" max="${max}" data-nopt="${k}" value="${o[k]}"></label>`;
  const upload = `
  <div class="card"><div class="card-h"><h3>Notas e recibos digitalizados</h3>
    <span class="row"><label class="btn small">Selecionar pasta<input type="file" data-nfiles webkitdirectory multiple hidden></label>
    <label class="btn small">Selecionar arquivos<input type="file" data-nfiles multiple hidden accept=".png,.jpg,.jpeg,.webp,.bmp,.gif,.tif,.tiff,.pdf,.txt,.md,.rtf,.json,.csv,.tsv,.xlsx,.xls,.ods,.xml,.html,.htm,.docx"></label></span></div>
    <label class="drop" data-ndrop><div class="drop-ic">⬆</div><strong>Arraste aqui os arquivos ou uma pasta de notas</strong>
      <span>Imagem (JPG, PNG…), PDF (texto ou digitalizado), TXT, XML de NF-e, HTML, Word, Excel/CSV</span></label>
    ${hasCaixa ? '' : '<p class="note">Envie também a planilha de caixa em <b>Arquivos</b> para que as notas sejam conferidas.</p>'}
    <details ${s.files.length ? '' : 'open'}><summary>Parâmetros da conferência</summary>
    <div class="map-grid">
      ${num('window', 'Janela de busca de data (± dias)', 0, 365)}${num('tolOk', 'Aceitar como conciliado até (dias)', 0, 365)}
      <label>Tolerância de valor (R$)<input type="number" min="0" step="0.01" data-nopt="valueTol" value="${o.valueTol / 100 || 0}"></label>
      <label>Similaridade mínima do nome (%)<input type="number" min="10" max="100" data-nopt="simMin" value="${Math.round(o.simMin * 100)}"></label>
      <label>Ignorar lançamentos do caixa que contenham<input type="text" data-nopt="ignore" value="${esc(o.ignore)}" placeholder="separe por vírgula"></label>
      ${chk('saidas', 'Exigir nota nas saídas')}${chk('entradas', 'Exigir nota nas entradas')}${chk('splitPages', 'PDF com várias páginas = várias notas')}
    </div><p class="muted small">Notas costumam ser emitidas antes do pagamento; por isso a data aceita uma diferença maior que a do extrato. Edite nome, data e valor na tabela “Notas lidas” se a leitura precisar de ajuste.</p></details>
  </div>`;
  if (!s.items.length && !s.files.length) return upload;
  if (!r) return upload + notesTable() + (hasCaixa ? '' : '');
  const types = Object.keys(N.TYPES).filter(k => r.counts[k] > 0);
  const kpi = (l, v, sub, cls) => `<div class="kpi ${cls || ''}"><div class="kl">${l}</div><div class="kv">${v}</div><div class="ks">${sub}</div></div>`;
  const list = N.list();
  const tabs = [['pending', 'Pendentes', r.issues.length], ['ok', 'Com nota', r.matched.length], ['all', 'Todos', r.issues.length + r.matched.length]];
  return upload + `
  <div class="kpis">
    ${kpi('Notas lidas', r.notes, r.noteValid + ' interpretadas' + (r.counts.unread ? ' · <span class="neg">' + r.counts.unread + ' a revisar</span>' : ''), 'accent-blue')}
    ${kpi('Cobertura do caixa', U.pct(r.pct), r.withNote + r.withNoteDiv + ' de ' + r.caixaRequired + ' lançamentos têm nota', 'accent-green')}
    ${kpi('Caixa sem nota', r.semNota.length, 'Valor ' + U.brl(r.valSemNota), r.semNota.length ? 'accent-amber' : 'accent-green')}
    ${kpi('Notas sem lançamento', r.notaSemCaixa.length, 'Valor ' + U.brl(r.valNotaSemCaixa), r.notaSemCaixa.length ? 'accent-amber' : 'accent-green')}
    ${kpi('Valor/data divergentes', r.withNoteDiv, 'nota localizada com diferença', r.withNoteDiv ? 'accent-amber' : 'accent-green')}
  </div>
  ${r.caixaIgnored ? `<p class="muted small">${r.caixaIgnored} lançamento(s) do caixa foram desconsiderados pelos filtros (transferências ou entradas/saídas desmarcadas).</p>` : ''}
  <div class="card">
    <div class="tabs">${tabs.map(t => `<button class="${f.show === t[0] ? 'active' : ''}" data-naction="show" data-show="${t[0]}">${t[1]} <b>${t[2]}</b></button>`).join('')}</div>
    <div class="toolbar">
      <div class="chips">${types.map(k => `<button class="chip-btn ${f.types.has(k) ? 'on' : ''}" data-naction="type" data-type="${k}"><span class="dot" style="background:${N.TYPES[k].color}"></span>${N.TYPES[k].label} <b>${r.counts[k]}</b></button>`).join('')}</div>
      <input type="search" class="search" placeholder="Buscar nome, valor ou data…" data-nsearch value="${esc(f.q)}">
      <button class="btn small" data-naction="csv">Exportar CSV</button>
    </div>
    ${list.length ? `<div class="tablewrap"><table class="tbl"><thead><tr><th>Tipo</th><th>Nota / recibo</th><th>Caixa</th><th class="r">Diferença</th><th>O que fazer</th></tr></thead><tbody>
      ${list.slice(0, f.limit).map(i => `<tr><td><span class="badge" style="--c:${N.TYPES[i.type].color}">${N.TYPES[i.type].label}</span></td><td>${nSide(i.bank, true)}</td><td>${nSide(i.caixa, false)}</td><td class="r ${i.diff ? 'neg' : ''}">${i.diff && i.bank && i.caixa ? U.brl(i.diff) : '—'}</td><td class="act">${esc(i.action)}</td></tr>`).join('')}
    </tbody></table></div>${list.length > f.limit ? `<div class="center"><button class="btn" data-naction="more">Mostrar mais (${list.length - f.limit} restantes)</button></div>` : ''}`
      : `<div class="empty-sm">${f.show === 'pending' && !f.types.size && !f.q ? '🎉 Todas as movimentações do caixa têm nota e todas as notas têm movimentação.' : 'Nenhum item para este filtro.'}</div>`}
  </div>` + notesTable();
};

function notesTable() {
  const s = N.s;
  if (!s.items.length && !s.files.some(f => f.status === 'erro')) return '';
  const errs = s.files.filter(f => f.status === 'erro');
  return `<div class="card"><div class="card-h"><h3>Notas lidas (${s.items.length})</h3><span class="muted small">Corrija nome, data ou valor se a leitura estiver errada — a conferência é refeita na hora.</span></div>
  <div class="tablewrap"><table class="tbl compact"><thead><tr><th>Arquivo</th><th>Leitura</th><th>Nome</th><th>Data</th><th class="r">Valor (R$)</th><th></th></tr></thead><tbody>
  ${s.items.map(n => `<tr><td>${esc(n.file)}</td><td><span class="chip">${esc(n.ocr ? 'OCR' : n.via)}</span>${n.edited ? ' <span class="tag pers">EDITADA</span>' : ''}</td>
    <td><input class="cell" data-nedit="${n.id}:name" value="${esc(n.names.join(' / '))}"></td>
    <td><input class="cell" size="10" data-nedit="${n.id}:date" value="${n.date ? U.iso2br(n.date) : ''}" placeholder="dd/mm/aaaa"></td>
    <td class="r"><input class="cell r" size="11" data-nedit="${n.id}:cents" value="${n.cents == null ? '' : (n.cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}" placeholder="0,00"></td>
    <td><button class="btn small danger" data-naction="rm" data-id="${n.id}">Remover</button></td></tr>`).join('')}
  ${errs.map(e => `<tr><td>${esc(e.name)}</td><td colspan="4" class="neg">Não foi possível ler: ${esc(e.msg)}</td><td></td></tr>`).join('')}
  </tbody></table></div></div>`;
}

N.exportCsv = () => {
  const r = N.s.result; if (!r) return;
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [['Tipo', 'Nota (arquivo)', 'Nota nome', 'Nota data', 'Nota valor', 'Caixa linha', 'Caixa descrição', 'Caixa data', 'Caixa valor', 'Ação'].map(q).join(';')];
  r.issues.forEach(i => lines.push([N.TYPES[i.type].label, i.bank ? i.bank.line : '', i.bank ? i.bank.shown : '', i.bank && i.bank.date ? U.iso2br(i.bank.date) : '', i.bank && i.bank.cents ? (i.bank.cents / 100).toFixed(2).replace('.', ',') : '', i.caixa ? i.caixa.line : '', i.caixa ? i.caixa.desc : '', i.caixa ? U.iso2br(i.caixa.date) : '', i.caixa ? (i.caixa.signed / 100).toFixed(2).replace('.', ',') : '', i.action].map(q).join(';')));
  U.download('divergencias_notas.csv', new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
};

/* ---------------- eventos ---------------- */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-naction]'); if (!t) return;
  const a = t.dataset.naction, f = N.s.filt;
  if (a === 'show') { f.show = t.dataset.show; f.limit = 150; renderAll(); }
  else if (a === 'type') { const ty = t.dataset.type; if (f.types.has(ty)) f.types.delete(ty); else f.types.add(ty); f.limit = 150; renderAll(); }
  else if (a === 'more') { f.limit += 300; renderAll(); }
  else if (a === 'csv') N.exportCsv();
  else if (a === 'rm') { const id = +t.dataset.id; N.s.items = N.s.items.filter(n => n.id !== id); renderAll(); }
});
document.addEventListener('change', e => {
  const t = e.target, s = N.s;
  if (t.matches('[data-nfiles]')) { if (t.files.length) N.addFiles(t.files); t.value = ''; return; }
  if (t.dataset.nopt) {
    const k = t.dataset.nopt, o = s.opts;
    if (['saidas', 'entradas', 'splitPages'].includes(k)) o[k] = t.checked;
    else if (k === 'ignore') o[k] = t.value;
    else if (k === 'valueTol') o[k] = Math.max(0, Math.round((parseFloat(t.value) || 0) * 100));
    else if (k === 'simMin') o[k] = Math.min(1, Math.max(0.1, (parseFloat(t.value) || 50) / 100));
    else o[k] = Math.max(0, parseInt(t.value, 10) || 0);
    renderAll(); return;
  }
  if (t.dataset.nedit) {
    const [id, key] = t.dataset.nedit.split(':'), n = s.items.find(x => x.id === +id); if (!n) return;
    if (key === 'name') n.names = t.value.split('/').map(x => x.trim()).filter(Boolean);
    else if (key === 'date') n.date = U.parseDate(t.value, new Date().getFullYear());
    else if (key === 'cents') { const c = U.parseAmount(t.value); n.cents = c == null ? null : Math.abs(c); }
    n.edited = true; renderAll();
  }
});
document.addEventListener('input', e => {
  if (e.target.matches('[data-nsearch]')) {
    N.s.filt.q = e.target.value; N.s.filt.limit = 150;
    const pos = e.target.selectionStart; renderAll();
    const el = document.querySelector('[data-nsearch]'); if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  }
});
['dragover', 'dragleave', 'drop'].forEach(ev => document.addEventListener(ev, async e => {
  const z = e.target.closest && e.target.closest('[data-ndrop]'); if (!z) return;
  e.preventDefault();
  z.classList.toggle('over', ev === 'dragover');
  if (ev === 'drop') { const files = await N.collectDrop(e.dataTransfer); if (files.length) N.addFiles(files); }
}));
