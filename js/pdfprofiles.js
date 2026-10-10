'use strict';
/* Leitores específicos de PDF:
   - Extrato Cora (PDF com texto): data, tipo, nome, documento e valor, validado pelos totais do cabeçalho.
   - Relatório de Caixa Bancário (PDF "desenhado", sem texto): lido por OCR (Tesseract, local), validado pelo saldo corrente. */
const X = {};

const brNum = c => (c < 0 ? '-' : '') + (Math.abs(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const moneyIn = s => { const m = String(s || '').match(/([+-])?\s*(?:R\$)?\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/); if (!m) return null; const c = U.parseAmount(m[2]); return m[1] === '-' ? -c : c; };
const groupRows = (items, tol = 3) => {
  const rows = []; let cur = [], y = null;
  items.slice().sort((a, b) => b.y - a.y || a.x - b.x).forEach(i => {
    if (y !== null && Math.abs(i.y - y) > tol) { rows.push(cur.sort((a, b) => a.x - b.x)); cur = []; }
    if (!cur.length) y = i.y; cur.push(i);
  });
  if (cur.length) rows.push(cur.sort((a, b) => a.x - b.x));
  return rows;
};

/* ---------------- Extrato Cora ---------------- */
X.isCora = pages => { const t = pages.slice(0, 2).flat().map(i => i.s).join(' '); return /Extrato do per[ií]odo/.test(t) && /Saldo do dia/.test(t); };

X.parseCora = pages => {
  const rows = [['Data', 'Descrição', 'Valor', 'Tipo', 'Nome', 'Documento']];
  const head = pages[0].map(i => i.s).join(' ');
  const get = re => { const m = head.match(re); return m ? U.parseAmount(m[1]) : null; };
  const decl = {
    opening: get(/Saldo inicial dispon[ií]vel\s*R\$\s*([\d.,]+)/), inn: get(/Total de entradas\s*\+\s*R\$\s*([\d.,]+)/),
    out: get(/Total de sa[ií]das\s*-\s*R\$\s*([\d.,]+)/), closing: get(/Saldo final dispon[ií]vel\s*R\$\s*([\d.,]+)/),
  };
  const acct = (head.match(/Ag[êe]ncia:\s*[\d-]+\s*-\s*Conta:\s*[\d-]+/) || [''])[0];
  const per = (head.match(/\d{2}\/\d{2}\/\d{4}\s+a\s+\d{2}\/\d{2}\/\d{4}/) || [''])[0];
  let date = null, inn = 0, out = 0;
  pages.forEach(pg => groupRows(pg).forEach(r => {
    const f = r[0], txt = r.map(i => i.s).join(' ');
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(f.s) && r.some(i => i.s === 'Saldo do dia')) { date = f.s; return; }
    if (f.x > 100 || !date) return;
    const vm = txt.match(/([+-])\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/);
    if (!vm) return;
    const c = U.parseAmount(vm[2]) * (vm[1] === '-' ? -1 : 1);
    if (c > 0) inn += c; else out += -c;
    const name = r.filter(i => i.x > 150 && i.x < 340 && i.s !== '…').map(i => i.s).join(' ').trim();
    const doc = r.filter(i => i.x >= 340 && i.x < 430 && /[\d.\/-]{8,}/.test(i.s)).map(i => i.s).join(' ');
    rows.push([date, f.s + ' · ' + name, (c < 0 ? '-' : '+') + brNum(Math.abs(c)), f.s, name, doc]);
  }));
  const chk = (label, exp, got) => ({ label, expected: exp, got, ok: exp != null && Math.abs(exp - got) <= 1 });
  const checks = [chk('Total de entradas', decl.inn, inn), chk('Total de saídas', decl.out, out)];
  if (decl.opening != null && decl.closing != null) checks.push(chk('Saldo final = inicial + entradas - saídas', decl.closing, decl.opening + inn - out));
  return { rows, meta: { profile: 'Extrato Cora', info: [acct, per].filter(Boolean).join(' · '), checks, opening: decl.opening, closing: decl.closing, count: rows.length - 1 } };
};

/* ---------------- Relatório de Caixa Bancário (OCR) ---------------- */
/* Colunas calibradas em frações da largura da página girada:
   Data | Pagante/Credor | Descrição | Caixa | Valor | Taxa | Líquido | Transferido | Saldo */
const COLS = [['data', 0.08], ['pagante', 0.248], ['desc', 0.499], ['caixa', 0.594], ['valor', 0.674], ['taxa', 0.756], ['liq', 0.817], ['transf', 0.893], ['saldo', 9]];
const colOf = (x0, W) => { const f = x0 / W; return COLS.find(c => f < c[1])[0]; };
const wy = w => (w.bbox.y0 + w.bbox.y1) / 2;
const DATE_RE = /\d{2}\/\d{2}\/\d{4}/;

X.pageRecords = (words, W) => {
  // o rodapé (totais do relatório) não faz parte das linhas da tabela
  const foot = words.filter(w => /^(ENTRADAS|SA[ÍI]DAS|VARIA[ÇC][ÃA]O):?$/.test(w.text.trim())).map(wy);
  const footY = foot.length ? Math.min(...foot) - 14 : Infinity;
  const ws = words.filter(w => w.text && wy(w) < footY && !/^[|—–_\-.]$/.test(w.text.trim()));
  const anchors = ws.filter(w => DATE_RE.test(w.text) && colOf(w.bbox.x0, W) === 'data').sort((a, b) => wy(a) - wy(b));
  return anchors.map((a, i) => {
    const y0 = wy(a) - 10, y1 = i + 1 < anchors.length ? wy(anchors[i + 1]) - 10 : Infinity;
    const cell = { data: (a.text.match(DATE_RE) || [''])[0], pagante: [], desc: [], caixa: [], valor: [], taxa: [], liq: [], transf: [], saldo: [], descW: [] };
    ws.filter(w => w !== a && wy(w) >= y0 && wy(w) < y1)
      .sort((p, q) => Math.round(wy(p) / 10) - Math.round(wy(q) / 10) || p.bbox.x0 - q.bbox.x0)
      .forEach(w => { const k = colOf(w.bbox.x0, W); if (k === 'desc') cell.descW.push(w); if (k !== 'data') cell[k].push(w.text); });
    // transferências ficam numa linha só: ordena pela posição horizontal (o OCR pode trocar a ordem por diferenças de 1-2 px)
    if (/^Transfer/i.test(cell.desc[0] || '')) cell.desc = cell.descW.slice().sort((p, q) => p.bbox.x0 - q.bbox.x0).map(w => w.text);
    return cell;
  });
};

const cellMoney = arr => { const t = arr.join(' '); return /\d/.test(t) ? moneyIn(t) : null; };

X.buildCaixaRows = (recs, opening) => {
  const H = ['Data', 'Pagante/Credor', 'Descrição', 'Caixa', 'Valor', 'Taxa', 'Líquido', 'Transferido', 'Saldo', 'Efetivo', 'Nome'];
  // conta bancária = caixa mais frequente que comece com "Banco"
  const freq = {};
  recs.forEach(r => { const c = r.caixa.join(' ').trim(); if (/^Banco\b/i.test(c)) freq[c] = (freq[c] || 0) + 1; });
  const bankAcc = Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0] || '';
  const rows = [H], warn = [];
  let prev = opening, transfers = 0;
  recs.forEach((r, i) => {
    const desc = r.desc.join(' ').trim();
    const tm = desc.match(/Transfer[êe]ncia:?\s*(.+?)\s*-{1,3}\s*>\s*(.+)/i);
    let valor = cellMoney(r.valor), taxa = cellMoney(r.taxa), liq = cellMoney(r.liq), saldo = cellMoney(r.saldo);
    let caixa = r.caixa.join(' ').trim(), eff, expectedDelta;
    if (tm) {                                       // transferência entre caixas: entra/sai da conta bancária
      transfers++;
      const src = tm[1].trim(), dst = tm[2].trim();
      const key = U.norm(bankAcc).replace(/^banco\s+/, '');
      const isBank = s => !!key && U.norm(s).includes(key);
      const mag = Math.abs(valor == null ? (liq == null ? 0 : liq) : valor);
      const sign = isBank(dst) && !isBank(src) ? 1 : isBank(src) && !isBank(dst) ? -1 : 0;
      valor = sign * mag; eff = sign ? valor : 0; expectedDelta = 0;
      caixa = src + ' --> ' + dst;
    } else { eff = liq != null ? liq : valor; expectedDelta = eff; }
    if (saldo != null && prev != null) {
      const delta = saldo - prev;
      if (expectedDelta == null || Math.abs(delta - expectedDelta) > 1) {
        warn.push({ row: i + 1, text: r.data + ' ' + (r.pagante.join(' ') || desc).slice(0, 50) + ' — saldo indica ' + brNum(delta) + ', lido ' + (expectedDelta == null ? '—' : brNum(expectedDelta)), value: delta });
        if (!tm && (eff == null || Math.abs(delta - eff) > 1)) eff = delta;     // o saldo corrente é mais confiável
      }
    }
    if (saldo != null) prev = saldo; else if (expectedDelta != null && prev != null) prev += expectedDelta;
    const nome = r.pagante.join(' ').trim() || desc;
    rows.push([r.data, r.pagante.join(' '), desc, caixa, valor == null ? '' : brNum(valor), taxa == null ? '' : brNum(taxa), liq == null ? '' : brNum(liq), (r.transf.join(' ').match(DATE_RE) || [''])[0], saldo == null ? '' : brNum(saldo), eff == null ? '' : brNum(eff), nome]);
  });
  return { rows, warn, closing: prev, bankAcc, transfers };
};

X.ocrCaixa = async (buf, progress) => {
  if (location.protocol === 'file:') throw new Error('A leitura por OCR precisa do app aberto pelo atalho "Abrir Fechamento de Caixa.bat" ou pelo site publicado (não funciona com o arquivo aberto direto).');
  await P.loadPdfjs();
  if (!window.Tesseract) await U.loadScript('js/vendor/tesseract/tesseract.min.js');
  const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  const rafOrig = window.requestAnimationFrame;
  window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 0);   // não pausar com a aba oculta
  const n = pdf.numPages, nW = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
  const sched = Tesseract.createScheduler();
  const base = 'js/vendor/tesseract/';
  const pageWords = new Array(n), pageText = new Array(n), pageW = new Array(n);
  let done = 0;
  try {
    for (let i = 0; i < nW; i++) {
      sched.addWorker(await Tesseract.createWorker('por', 1, { workerPath: base + 'worker.min.js', corePath: base, langPath: base, gzip: false, workerBlobURL: false }));
    }
    const job = async p => {
      const pg = await pdf.getPage(p);
      const vp = pg.getViewport({ scale: 2.2 });
      const a = document.createElement('canvas'); a.width = vp.width; a.height = vp.height;
      const ctx = a.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, a.width, a.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      // a tabela vem impressa girada em 90 graus
      const b = document.createElement('canvas'); b.width = a.height; b.height = a.width;
      const c = b.getContext('2d'); c.translate(b.width, 0); c.rotate(Math.PI / 2); c.drawImage(a, 0, 0);
      const res = await sched.addJob('recognize', b, {}, { blocks: true, text: true });
      pageWords[p - 1] = res.data.words || []; pageText[p - 1] = res.data.text || ''; pageW[p - 1] = b.width;
      done++; progress && progress(done / n, 'Lendo página ' + done + ' de ' + n + ' (OCR)…');
    };
    await Promise.all(Array.from({ length: n }, (_, i) => i + 1).map(p => job(p)));
  } finally { window.requestAnimationFrame = rafOrig; await sched.terminate(); }

  X.last = { pageWords, pageText, pageW };   // mantido para diagnóstico
  return X.fromOcr(X.last);
};

X.fromOcr = ({ pageWords, pageText, pageW }) => {
  const n = pageWords.length;
  const all = pageText.join('\n');
  if (!/Relat[óo]rio de Caixa/i.test(all) && !/Saldo inicial/i.test(all)) return { rows: null, text: all };
  const om = all.match(/Saldo inicial\s*R\$\s*([\d.]+,\d{2})/i);
  const opening = om ? U.parseAmount(om[1]) : null;
  const recs = [];
  for (let p = 0; p < n; p++) recs.push(...X.pageRecords(pageWords[p], pageW[p]));
  const { rows, warn, closing, bankAcc, transfers } = X.buildCaixaRows(recs, opening);
  const filtros = all.match(/Data inicial:\s*([\d/]+)\s*-\s*Data final:\s*([\d/]+)/i) || [];
  const cx_ = (all.match(/Caixa\(s\):\s*([^\n]+?)(?:\s+\d{2}\/\d{2}\/\d{4}|\n|$)/i) || [])[1] || '';
  const checks = [];
  if (opening != null) checks.push({ label: 'Saldo inicial lido', expected: opening, got: opening, ok: true });
  // totais declarados no rodapé do relatório
  const tm = all.match(/TOTAL DE ENTRADAS:[\s\S]{0,60}?R\$\s*([\d.]+,\d{2})\s*R\$\s*([\d.]+,\d{2})\s*R\$\s*([\d.]+,\d{2})\s*R\$\s*([\d.]+,\d{2})/i);
  if (tm && closing != null && opening != null) {
    const varDecl = U.parseAmount(tm[3]);
    checks.push({ label: 'Variação no saldo (rodapé do relatório)', expected: varDecl, got: closing - opening, ok: Math.abs(varDecl - (closing - opening)) <= 1 });
  }
  const sm = all.match(/SALDO ASAAS:\s*SALDO BANCO [A-ZÀ-Ú ]+:\s*SALDO [A-Z]+:\s*R\$\s*([\d.]+,\d{2})\s*R\$\s*([\d.]+,\d{2})\s*R\$\s*([\d.]+,\d{2})/i);
  if (sm && closing != null) {
    const decl = U.parseAmount(sm[2]);
    checks.push({ label: 'Saldo final da conta bancária (rodapé)', expected: decl, got: closing, ok: Math.abs(decl - closing) <= 1 });
  }
  checks.push({ label: 'Linhas conferidas pelo saldo corrente', expected: rows.length - 1, got: rows.length - 1 - warn.length, ok: warn.length === 0, count: true });
  return { rows, meta: { profile: 'Relatório de Caixa Bancário (OCR)', info: [filtros[1] && filtros[1] + ' a ' + filtros[2], cx_ && 'Caixas: ' + cx_.trim(), bankAcc && 'Conta bancária: ' + bankAcc, transfers && transfers + ' transferência(s) entre caixas'].filter(Boolean).join(' · '), checks, warn, opening, closing, count: rows.length - 1, bankAcc } };
};
