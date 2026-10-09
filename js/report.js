'use strict';
/* Relatório final em PDF (jsPDF + autoTable) */
const R = {};

R.img = (cfg, w, h) => {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cfg.options = Object.assign({}, cfg.options, { responsive: false, animation: false, devicePixelRatio: 1 });
  const ch = new Chart(cv, cfg);
  const url = cv.toDataURL('image/png');
  ch.destroy();
  return url;
};

const RGB = { navy: [15, 45, 82], blue: [29, 95, 184], green: [18, 163, 107], amber: [217, 119, 6], grey: [100, 116, 139], light: [244, 248, 252], line: [226, 232, 240] };

R.card = (doc, x, y, w, h, label, value, sub, color) => {
  doc.setFillColor(...RGB.light); doc.setDrawColor(...RGB.line);
  doc.roundedRect(x, y, w, h, 2, 2, 'FD');
  doc.setFillColor(...color); doc.rect(x, y + 2, 1.2, h - 4, 'F');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...RGB.grey);
  doc.text(label, x + 4, y + 6);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...RGB.navy);
  doc.text(value, x + 4, y + 13);
  if (sub) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...RGB.grey); doc.text(sub, x + 4, y + 18); }
};

R.make = (S) => {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const r = S.result, W = 210, M = 14, CW = W - 2 * M;
  const pend = r.issues.length, closed = pend === 0;
  const now = new Date();
  const per = r.period ? U.iso2br(r.period.from) + ' a ' + U.iso2br(r.period.to) : '-';

  // cabeçalho
  doc.setFillColor(...RGB.navy); doc.rect(0, 0, W, 34, 'F');
  doc.setFillColor(...RGB.green); doc.rect(0, 34, W, 1.5, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text('Relatório de Fechamento de Caixa', M, 16);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('Período analisado: ' + per, M, 24);
  doc.text('Emitido em ' + now.toLocaleDateString('pt-BR') + ' às ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' · Rodada ' + S.rounds[S.rounds.length - 1].n, M, 29.5);

  // status
  let y = 42;
  doc.setFillColor(...(closed ? RGB.green : RGB.amber));
  doc.roundedRect(M, y, CW, 11, 2, 2, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text(closed ? 'CAIXA FECHADO — extrato e planilha totalmente conciliados' : 'COM PENDÊNCIAS — ' + pend + ' divergência(s) a corrigir, impacto de ' + U.brl(r.pendValue), M + 4, y + 7);
  y += 16;
  doc.setTextColor(...RGB.grey); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  doc.text('Extrato: ' + S.files.bank.name + '   |   Caixa: ' + S.files.caixa.name, M, y);
  y += 5;

  // KPIs
  const t = r.totals, gw = (CW - 8) / 3;
  const kp = [
    ['Conciliação (quantidade)', U.pct(r.pctQtd), r.counts.ok + ' de ' + r.universe + ' lançamentos', RGB.green],
    ['Conciliação (valor)', U.pct(r.pctVal), 'Volume financeiro conciliado', RGB.green],
    ['Pendências', String(pend), 'Impacto: ' + U.brl(r.pendValue), pend ? RGB.amber : RGB.green],
    ['Entradas (extrato)', U.brl(t.bank.in), 'Caixa: ' + U.brl(t.caixa.in), RGB.blue],
    ['Saídas (extrato)', U.brl(t.bank.out), 'Caixa: ' + U.brl(t.caixa.out), RGB.blue],
    ['Fluxo líquido (extrato)', U.brl(t.bank.net), 'Caixa: ' + U.brl(t.caixa.net), RGB.blue],
    ['Diferença líquida', U.brl(r.diffNet), 'Extrato menos caixa', Math.abs(r.diffNet) ? RGB.amber : RGB.green],
    ['Saldo final (extrato)', U.brl(r.closingBank), 'Caixa: ' + U.brl(r.closingCaixa) + ' (saldo inicial ' + U.brl(r.opening) + ')', RGB.navy],
    ['Ticket médio (extrato)', U.brl(r.ticketMedio), 'Maior entrada ' + U.brl(t.bank.maxIn) + ' · maior saída ' + U.brl(t.bank.maxOut), RGB.navy],
  ];
  kp.forEach((k, i) => R.card(doc, M + (i % 3) * (gw + 4), y + Math.floor(i / 3) * 23, gw, 20, k[0], k[1], k[2], k[3]));
  y += 72;

  // gráficos
  doc.setTextColor(...RGB.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Visão do fechamento', M, y); y += 3;
  const half = (CW - 4) / 2;
  doc.addImage(R.img(C.donut(r), 700, 420), 'PNG', M, y, half, half * 0.6);
  doc.addImage(R.img(C.flow(r), 700, 420), 'PNG', M + half + 4, y, half, half * 0.6);
  y += half * 0.6 + 4;
  doc.addImage(R.img(C.cash(r), 1400, 420), 'PNG', M, y, CW, CW * 0.3);

  // página 2: detalhes
  doc.addPage(); y = 18;
  doc.setTextColor(...RGB.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text('Resumo por tipo de resultado', M, y); y += 3;
  const rowsT = Object.keys(E.TYPES).filter(k => r.counts[k] > 0).map(k => [E.TYPES[k].label, r.counts[k], r.universe ? U.pct(r.counts[k] / r.universe) : '-']);
  doc.autoTable({ startY: y, head: [['Resultado', 'Quantidade', '% do total']], body: rowsT, margin: { left: M, right: M }, theme: 'striped', headStyles: { fillColor: RGB.blue }, styles: { fontSize: 9 } });
  y = doc.lastAutoTable.finalY + 8;

  if (r.topCats.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...RGB.navy); doc.text('Maiores categorias de saída (caixa)', M, y); y += 3;
    doc.autoTable({ startY: y, head: [['Categoria', 'Total de saídas']], body: r.topCats.map(c => [c[0], U.brl(c[1])]), margin: { left: M, right: M }, theme: 'striped', headStyles: { fillColor: RGB.green }, styles: { fontSize: 9 }, columnStyles: { 1: { halign: 'right' } } });
    y = doc.lastAutoTable.finalY + 8;
  }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...RGB.navy);
  doc.text('Histórico de rodadas de conferência', M, y); y += 3;
  doc.autoTable({
    startY: y, head: [['Rodada', 'Horário', 'Arquivo do caixa', 'Pendências', 'Resolvidas', 'Novas']],
    body: S.rounds.map(x => [x.n, x.at.toLocaleString('pt-BR'), x.caixaName, x.pend, x.cmp ? x.cmp.resolved : '-', x.cmp ? x.cmp.fresh : '-']),
    margin: { left: M, right: M }, theme: 'striped', headStyles: { fillColor: RGB.blue }, styles: { fontSize: 8.5 },
  });
  y = doc.lastAutoTable.finalY + 8;

  // pendências
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...RGB.navy);
  if (y > 240) { doc.addPage(); y = 18; }
  doc.text(closed ? 'Pendências' : 'Pendências a corrigir (' + pend + ')', M, y); y += 3;
  const side = (x, nome) => (x ? 'L' + x.line + ' · ' + U.iso2short(x.date) + ' · ' + x.desc + ' · ' + U.brl(x.cents) : '— não consta —');
  if (closed) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...RGB.green);
    doc.text('Nenhuma pendência. Todos os lançamentos do extrato foram localizados na planilha de caixa.', M, y + 5);
  } else {
    const LIM = 400;
    doc.autoTable({
      startY: y, head: [['Tipo', 'Extrato', 'Caixa', 'Diferença', 'Ação sugerida']],
      body: r.issues.slice(0, LIM).map(i => [E.TYPES[i.type].label, side(i.bank), side(i.caixa), U.brl(i.diff), i.action]),
      margin: { left: M, right: M }, theme: 'grid', headStyles: { fillColor: RGB.navy }, styles: { fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 38 }, 2: { cellWidth: 38 }, 3: { cellWidth: 20, halign: 'right' } },
    });
    if (r.issues.length > LIM) { doc.setFontSize(8); doc.setTextColor(...RGB.grey); doc.text('… e mais ' + (r.issues.length - LIM) + ' pendências (exporte o CSV para a lista completa).', M, doc.lastAutoTable.finalY + 5); }
  }

  // rodapé
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFontSize(8); doc.setTextColor(...RGB.grey); doc.setFont('helvetica', 'normal');
    doc.setDrawColor(...RGB.line); doc.line(M, 285, W - M, 285);
    doc.text('Fechamento de Caixa · conferência somente leitura — os arquivos originais não foram alterados', M, 290);
    doc.text('Página ' + p + ' de ' + n, W - M, 290, { align: 'right' });
  }
  return doc;
};
