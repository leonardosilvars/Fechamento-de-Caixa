'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = U.esc;

/* Cada arquivo ocupa um "slot": 'caixa' ou 'bank0', 'bank1'… (um por banco/conta) */
const S = {
  opts: { window: 5, tolOk: 0, valueTol: 0, simMin: 0.5, flagDesc: false, opening: 0 },
  result: null, cmp: null, rounds: [], view: 'overview',
  filt: { types: new Set(), q: '', show: 'pending', limit: 150 },
};
function resetFiles() { S.files = { caixa: null }; S.cfg = { caixa: null }; S.norm = { caixa: null }; S.banks = ['bank0']; S.labels = {}; S.nextBank = 1; }
resetFiles();
const TITLES = { overview: 'Visão geral', files: 'Arquivos e parâmetros', issues: 'Divergências', history: 'Histórico de rodadas', report: 'Relatório final' };
const loadedBanks = () => S.banks.filter(k => S.files[k]);
const bankNames = () => loadedBanks().map(k => S.files[k].name).join(' + ');
const bankLabel = k => S.labels[k] || (S.files[k] ? S.files[k].name.replace(/\.[^.]+$/, '') : '');
const sideTitle = k => (k === 'caixa' ? 'Planilha de caixa da empresa' : 'Extrato bancário' + (S.banks.length > 1 ? ' ' + (S.banks.indexOf(k) + 1) : ''));

/* ---------------- fluxo principal ---------------- */
function recompute(forceNew) {
  S.banks.concat('caixa').forEach(k => { S.norm[k] = S.files[k] ? P.normalize(S.files[k], S.cfg[k]) : null; });
  const lb = loadedBanks();
  if (!lb.length || !S.norm.caixa) { S.result = null; S.cmp = null; return; }
  const multi = lb.length > 1;
  const bankItems = lb.flatMap(k => S.norm[k].items.map(it => Object.assign({}, it, { bankName: multi ? bankLabel(k) : '' })));
  const res = E.reconcile(bankItems, S.norm.caixa.items, S.opts);
  const isNew = forceNew || !S.rounds.length;
  const prev = isNew ? S.rounds[S.rounds.length - 1] : S.rounds[S.rounds.length - 2];
  S.cmp = null;
  if (prev) {
    const pk = new Map(prev.issues.map(i => [i.key, i])), ck = new Set(res.issues.map(i => i.key));
    res.issues.forEach(i => { i.status = pk.has(i.key) ? 'persistent' : 'new'; });
    S.cmp = {
      prevN: prev.n,
      resolved: prev.issues.filter(i => !ck.has(i.key)).map(i => Object.assign({}, i, { status: 'resolved' })),
      persistent: res.issues.filter(i => i.status === 'persistent').length,
      fresh: res.issues.filter(i => i.status === 'new').length,
    };
  }
  S.result = res;
  const last = S.rounds[S.rounds.length - 1];
  const round = {
    n: isNew ? (last ? last.n + 1 : 1) : last.n, at: new Date(), bankName: bankNames(), caixaName: S.files.caixa.name,
    pend: res.issues.length, ok: res.counts.ok, pct: res.pctQtd, pendValue: res.pendValue, diffNet: res.diffNet, issues: res.issues,
    cmp: S.cmp && { resolved: S.cmp.resolved.length, persistent: S.cmp.persistent, fresh: S.cmp.fresh },
  };
  if (isNew) S.rounds.push(round); else S.rounds[S.rounds.length - 1] = round;
}

async function loadFile(side, file, quiet) {
  try {
    const f = file instanceof File ? await P.readFile(file) : file;
    f._side = side;
    S.files[side] = f; S.cfg[side] = P.makeCfg(f); delete S.labels[side];
    if (quiet) return;
    recompute(true);
    toast(sideTitle(side) + ' carregado: ' + f.name + (side === 'caixa' && S.rounds.length > 1 ? ' — nova rodada de conferência' : ''));
    if (S.result && S.view === 'files') setView('overview'); else renderAll();
  } catch (e) { console.error(e); toast('Erro ao ler o arquivo: ' + e.message, true); }
}

/* vários arquivos de uma vez: o primeiro vai ao slot indicado, os demais viram novos bancos */
async function loadMany(key, files) {
  if (key === 'caixa' || files.length < 2) return loadFile(key, files[0]);
  let k = key;
  for (let i = 0; i < files.length; i++) {
    if (i > 0) { k = 'bank' + S.nextBank++; S.banks.push(k); }
    await loadFile(k, files[i], true);
  }
  recompute(true);
  toast(files.length + ' extratos carregados.');
  if (S.result && S.view === 'files') setView('overview'); else renderAll();
}

function removeBank(k) {
  const had = !!S.files[k];
  delete S.files[k]; delete S.cfg[k]; delete S.norm[k]; delete S.labels[k];
  if (S.banks.length > 1) S.banks = S.banks.filter(x => x !== k);
  if (had) recompute(true);
  renderAll();
}

/* ---------------- renderização ---------------- */
function setView(v) { S.view = v; renderAll(); window.scrollTo(0, 0); }
function renderAll() {
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === S.view));
  $('#title').textContent = TITLES[S.view];
  const r = S.result, st = $('#status');
  if (!r) { st.className = 'pill grey'; st.textContent = 'Aguardando arquivos'; }
  else if (!r.issues.length) { st.className = 'pill green'; st.textContent = '✓ Caixa fechado — sem pendências'; }
  else { st.className = 'pill amber'; st.textContent = r.issues.length + ' pendência(s) · ' + U.brl(r.pendValue); }
  const nb = $('#nav-issues-count'); nb.textContent = r ? r.issues.length : ''; nb.style.display = r && r.issues.length ? '' : 'none';
  $('#btn-pdf').disabled = !r;
  $('#btn-clear').disabled = !(loadedBanks().length || S.files.caixa || S.rounds.length);
  Object.values(CH).forEach(c => c.destroy()); Object.keys(CH).forEach(k => delete CH[k]);
  const view = $('#view');
  view.innerHTML = { overview, files, issues, history, report }[S.view]();
  if (S.view === 'overview' && r) {
    mk('c-donut', C.donut(r)); mk('c-flow', C.flow(r)); mk('c-cash', C.cash(r)); if (r.topCats.length) mk('c-cats', C.cats(r));
  }
  if (S.view === 'history' && S.rounds.length) mk('c-rounds', C.rounds(S.rounds));
}
const CH = {};
function mk(id, cfg) { const el = document.getElementById(id); if (el) CH[id] = new Chart(el, cfg); }

function empty(msg) {
  return `<div class="empty card"><div class="empty-ic">📊</div><h2>${msg}</h2>
  <p>Envie o extrato de um ou mais bancos e a planilha de caixa para começar a conferência. Os arquivos são apenas lidos — nada é alterado e nada sai do seu computador.</p>
  <div class="row center"><button class="btn primary" data-action="goto" data-view="files">Enviar arquivos</button>
  <button class="btn" data-action="demo">Carregar exemplo</button></div></div>`;
}

function overview() {
  const r = S.result; if (!r) return empty('Nenhuma conferência realizada ainda');
  const t = r.totals, ok = !r.issues.length;
  const kpi = (label, val, sub, cls = '', extra = '') => `<div class="kpi ${cls}"><div class="kl">${label}</div><div class="kv">${val}</div><div class="ks">${sub}</div>${extra}</div>`;
  const types = Object.keys(E.TYPES).filter(k => k !== 'ok' && r.counts[k] > 0);
  return `
  <div class="banner ${ok ? 'good' : 'warn'}">
    <div class="b-ic">${ok ? '✓' : '!'}</div>
    <div><strong>${ok ? 'Fechamento concluído: extrato e caixa batem em todos os lançamentos.' : r.issues.length + ' pendência(s) encontrada(s) — impacto de ' + U.brl(r.pendValue) + '.'}</strong>
    <div class="muted">Rodada ${S.rounds[S.rounds.length - 1].n} · ${esc(bankNames())} × ${esc(S.files.caixa.name)} · período ${U.iso2br(r.period.from)} a ${U.iso2br(r.period.to)}
    ${S.cmp ? ` · desde a rodada ${S.cmp.prevN}: <b class="pos">${S.cmp.resolved.length} resolvida(s)</b>, ${S.cmp.persistent} persistente(s), <b class="${S.cmp.fresh ? 'neg' : ''}">${S.cmp.fresh} nova(s)</b>` : ''}</div></div>
    ${ok ? '' : '<button class="btn primary" data-action="goto" data-view="issues">Ver divergências</button>'}
  </div>
  ${warnIgnored()}
  <div class="kpis">
    ${kpi('Conciliação', U.pct(r.pctQtd), r.counts.ok + ' de ' + r.universe + ' lançamentos', 'accent-green', `<div class="bar"><i style="width:${(r.pctQtd * 100).toFixed(1)}%"></i></div>`)}
    ${kpi('Pendências', r.issues.length, 'Impacto financeiro ' + U.brl(r.pendValue), r.issues.length ? 'accent-amber' : 'accent-green')}
    ${kpi('Entradas', U.brl(t.bank.in), 'Caixa: ' + U.brl(t.caixa.in) + diffTag(t.bank.in - t.caixa.in), 'accent-blue')}
    ${kpi('Saídas', U.brl(t.bank.out), 'Caixa: ' + U.brl(t.caixa.out) + diffTag(t.caixa.out - t.bank.out), 'accent-blue')}
    ${kpi('Fluxo líquido (extrato)', U.brl(t.bank.net), 'Caixa: ' + U.brl(t.caixa.net) + ' · dif. ' + U.brl(r.diffNet), 'accent-blue')}
    ${kpi('Saldo final', U.brl(r.closingBank), 'Caixa: ' + U.brl(r.closingCaixa) + ' · inicial ' + U.brl(r.opening), 'accent-green')}
  </div>
  <div class="grid2">
    <div class="card"><h3>Resultado da conferência</h3><div class="chart h260"><canvas id="c-donut"></canvas></div></div>
    <div class="card"><h3>Entradas e saídas: extrato × caixa</h3><div class="chart h260"><canvas id="c-flow"></canvas></div></div>
  </div>
  ${r.byBank ? `<div class="card"><h3>Resultado por banco</h3><div class="tablewrap"><table class="tbl"><thead><tr><th>Banco / conta</th><th class="r">Lançamentos</th><th class="r">Entradas</th><th class="r">Saídas</th><th class="r">Fluxo líquido</th><th class="r">Conciliados</th><th class="r">Pendências</th></tr></thead><tbody>
    ${r.byBank.map(b => `<tr><td><b>${esc(b.name)}</b></td><td class="r">${b.count}</td><td class="r">${U.brl(b.in)}</td><td class="r">${U.brl(b.out)}</td><td class="r">${U.brl(b.net)}</td><td class="r pos">${b.ok}</td><td class="r ${b.pend ? 'neg' : 'pos'}">${b.pend}</td></tr>`).join('')}
    ${r.pendCaixaOnly ? `<tr><td><i>Somente no caixa (sem banco)</i></td><td class="r" colspan="5"></td><td class="r neg">${r.pendCaixaOnly}</td></tr>` : ''}
  </tbody></table></div></div>` : ''}
  <div class="card"><h3>Evolução do saldo acumulado</h3><div class="chart h300"><canvas id="c-cash"></canvas></div></div>
  <div class="grid2">
    <div class="card"><h3>Pendências por tipo</h3>
      ${types.length ? `<ul class="typelist">${types.map(k => `<li><button class="link" data-action="filter-type" data-type="${k}"><span class="dot" style="background:${E.TYPES[k].color}"></span>${E.TYPES[k].label}<b>${r.counts[k]}</b></button></li>`).join('')}</ul>` : '<p class="muted">Sem pendências. 🎉</p>'}
    </div>
    <div class="card"><h3>Indicadores adicionais</h3>
      <dl class="dl">
        <dt>Maior entrada (extrato)</dt><dd>${U.brl(t.bank.maxIn)}</dd>
        <dt>Maior saída (extrato)</dt><dd>${U.brl(t.bank.maxOut)}</dd>
        <dt>Ticket médio</dt><dd>${U.brl(r.ticketMedio)}</dd>
        <dt>Lançamentos (extrato / caixa)</dt><dd>${t.bank.count} / ${t.caixa.count}</dd>
        <dt>Conciliação por valor</dt><dd>${U.pct(r.pctVal)}</dd>
      </dl>
    </div>
  </div>
  ${r.topCats.length ? `<div class="card"><h3>Maiores categorias de saída (caixa)</h3><div class="chart h260"><canvas id="c-cats"></canvas></div></div>` : ''}`;
}
const diffTag = d => (d ? ` · <span class="neg">dif. ${U.brl(d)}</span>` : ' · <span class="pos">sem dif.</span>');

function warnIgnored() {
  const w = [loadedBanks().reduce((a, k) => a + S.norm[k].ignored.filter(i => i.kind === 'warn').length, 0), S.norm.caixa ? S.norm.caixa.ignored.filter(i => i.kind === 'warn').length : 0];
  if (!w[0] && !w[1]) return '';
  return `<div class="banner warn small"><div class="b-ic">!</div><div><strong>Linhas não interpretadas:</strong> ${w[0] ? w[0] + ' no extrato' : ''}${w[0] && w[1] ? ' e ' : ''}${w[1] ? w[1] + ' no caixa' : ''} (valor sem data ou data sem valor). Elas ficam fora da conferência — revise em <button class="link" data-action="goto" data-view="files">Arquivos</button>.</div></div>`;
}

/* ---------- arquivos ---------- */
function opt(list, sel, none) { return (none ? `<option value="-1" ${sel < 0 ? 'selected' : ''}>(nenhuma)</option>` : '') + list.map((l, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(l)}</option>`).join(''); }
function fileCard(side) {
  const f = S.files[side], title = sideTitle(side), isBank = side !== 'caixa';
  const input = `<input type="file" data-file="${side}" accept=".csv,.xlsx,.xls,.pdf,.ofx,.txt,.tsv" ${isBank ? 'multiple' : ''} hidden>`;
  const rm = isBank && (S.banks.length > 1 || f) ? `<button class="btn small danger" data-action="rm-bank" data-key="${side}">Remover</button>` : '';
  if (!f) return `<div class="card"><div class="card-h"><h3>${title}</h3>${rm}</div><label class="drop" data-drop="${side}">${input}<div class="drop-ic">⬆</div><strong>Arraste o arquivo${isBank ? ' (ou vários de uma vez)' : ''} aqui</strong><span>ou clique para selecionar · CSV, Excel, PDF ou OFX</span></label></div>`;
  const cfg = S.cfg[side], rows = f.sheets[f.sheet].rows, labels = P.labels(rows, cfg.headerRow), n = S.norm[side];
  const warn = n.ignored.filter(i => i.kind === 'warn');
  const d = `data-cfg`;
  const sel = (key, lab, none = true) => `<label>${lab}<select ${d}="${side}:${key}">${opt(labels, cfg[key], none)}</select></label>`;
  return `<div class="card"><div class="card-h"><h3>${title}</h3>
    <span class="row"><label class="btn small">${side === 'caixa' && S.result ? 'Reenviar planilha corrigida' : 'Substituir arquivo'}${input}</label>${rm}</span></div>
    <div class="fileinfo"><span class="chip">${f.kind.toUpperCase()}</span> <b>${esc(f.name)}</b> <span class="muted">· ${n.items.length} lançamentos lidos · ${n.ignored.length} linha(s) ignorada(s)${warn.length ? ` (<b class="neg">${warn.length} com problema</b>)` : ''}</span></div>
    ${f.kind === 'pdf' ? '<p class="note">PDF: dados extraídos do texto do documento. Confira a pré-visualização abaixo; para maior precisão prefira CSV/Excel/OFX.</p>' : ''}
    <div class="map-grid">
      ${isBank ? `<label>Nome do banco / conta<input type="text" data-label="${side}" value="${esc(bankLabel(side))}" placeholder="Ex.: Itaú CC 1234"></label>` : ''}
      ${f.sheets.length > 1 ? `<label>Aba<select ${d}="${side}:sheet">${f.sheets.map((s, i) => `<option value="${i}" ${i === f.sheet ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
      <label>Linha do cabeçalho (0 = sem)<input type="number" min="0" ${d}="${side}:headerRow" value="${cfg.headerRow}"></label>
      ${sel('date', 'Data', false)}${sel('desc', 'Descrição')}
      <label>Estrutura do valor<select ${d}="${side}:mode"><option value="single" ${cfg.mode === 'single' ? 'selected' : ''}>Coluna única (com sinal)</option><option value="split" ${cfg.mode === 'split' ? 'selected' : ''}>Crédito / Débito separados</option></select></label>
      ${cfg.mode === 'single' ? sel('value', 'Valor', false) + sel('type', 'Tipo D/C (opcional)') : sel('credit', 'Crédito / Entrada') + sel('debit', 'Débito / Saída')}
      ${sel('cat', 'Categoria (opcional)')}
      <label class="chk"><input type="checkbox" ${d}="${side}:invert" ${cfg.invert ? 'checked' : ''}> Inverter sinais</label>
    </div>
    <div class="tablewrap"><table class="tbl compact"><thead><tr><th>Linha</th><th>Data</th><th>Descrição</th><th class="r">Valor</th></tr></thead><tbody>
      ${n.items.slice(0, 6).map(i => `<tr><td>${i.line}</td><td>${U.iso2br(i.date)}</td><td>${esc(i.desc)}</td><td class="r ${i.cents < 0 ? 'neg' : 'pos'}">${U.brl(i.cents)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum lançamento interpretado — ajuste o mapeamento das colunas.</td></tr>'}
    </tbody></table></div>
    ${n.ignored.length ? `<details><summary>Linhas ignoradas (${n.ignored.length})</summary><ul class="ign">${n.ignored.slice(0, 60).map(i => `<li class="${i.kind}"><b>Linha ${i.line}</b> — ${i.reason}<br><span class="muted">${esc(i.raw.slice(0, 140))}</span></li>`).join('')}</ul></details>` : ''}
  </div>`;
}
function files() {
  const o = S.opts;
  return `<h2 class="sec">Extratos bancários <span class="muted small">— envie um por banco/conta; todos serão conferidos juntos contra a planilha de caixa</span></h2>
  <div class="grid2 top">${S.banks.map(fileCard).join('')}<button class="card addbank" data-action="add-bank">＋ Adicionar extrato de outro banco</button></div>
  <h2 class="sec">Planilha de caixa</h2>
  <div class="grid2 top">${fileCard('caixa')}</div>
  <div class="card"><div class="card-h"><h3>Parâmetros de conferência</h3><span class="row"><button class="btn small" data-action="demo">Carregar exemplo</button>${S.files.caixa && S.files.caixa.name === 'caixa_setembro_v1.xlsx' ? '<button class="btn small" data-action="demo2">Exemplo: reenviar caixa corrigida</button>' : ''}</span></div>
  <p class="muted">Critério principal: <b>data + valor</b>. A descrição serve como reforço para escolher o par correto e para detectar valores divergentes.</p>
  <div class="map-grid">
    <label>Janela de busca de data (± dias)<input type="number" min="0" max="31" data-opt="window" value="${o.window}"></label>
    <label>Aceitar como conciliado até (dias de diferença)<input type="number" min="0" max="31" data-opt="tolOk" value="${o.tolOk}"></label>
    <label>Tolerância de valor (R$)<input type="number" min="0" step="0.01" data-opt="valueTol" value="${o.valueTol / 100 || 0}"></label>
    <label>Similaridade mínima da descrição (%)<input type="number" min="10" max="100" data-opt="simMin" value="${Math.round(o.simMin * 100)}"></label>
    <label>Saldo inicial (R$, opcional)<input type="text" data-opt="opening" value="${o.opening ? (o.opening / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : ''}" placeholder="0,00"></label>
    <label class="chk"><input type="checkbox" data-opt="flagDesc" ${o.flagDesc ? 'checked' : ''}> Sinalizar descrições muito diferentes</label>
  </div></div>`;
}

/* ---------- divergências ---------- */
function sideCell(x) {
  if (!x) return '<span class="muted">— não consta —</span>';
  return `<div class="ln">${x.bankName ? esc(x.bankName) + ' · ' : ''}Linha ${x.line}</div><div class="dsc">${esc(x.desc) || '<i>sem descrição</i>'}</div><div class="meta">${U.iso2br(x.date)} · <b class="${x.cents < 0 ? 'neg' : 'pos'}">${U.brl(x.cents)}</b></div>`;
}
function currentList() {
  const r = S.result, f = S.filt;
  let l;
  if (f.show === 'pending') l = r.issues; else if (f.show === 'ok') l = r.matched;
  else if (f.show === 'resolved') l = S.cmp ? S.cmp.resolved : []; else l = r.issues.concat(r.matched);
  if (f.types.size) l = l.filter(i => f.types.has(i.type));
  if (f.q) { const q = U.norm(f.q); l = l.filter(i => U.norm([i.bank && i.bank.desc, i.caixa && i.caixa.desc, i.bank && U.brl(i.bank.cents), i.caixa && U.brl(i.caixa.cents), i.bank && U.iso2br(i.bank.date), i.caixa && U.iso2br(i.caixa.date), i.action].join(' ')).includes(q)); }
  return l;
}
function issues() {
  const r = S.result; if (!r) return empty('Sem dados para listar');
  const f = S.filt, list = currentList();
  const tabs = [['pending', 'Pendentes', r.issues.length], ['resolved', 'Resolvidas', S.cmp ? S.cmp.resolved.length : 0], ['ok', 'Conciliados', r.matched.length], ['all', 'Todos', r.issues.length + r.matched.length]];
  const tcount = k => r.counts[k];
  const tagS = s => (s === 'new' ? '<span class="tag new">NOVA</span>' : s === 'persistent' ? '<span class="tag pers">PERSISTE</span>' : s === 'resolved' ? '<span class="tag res">RESOLVIDA</span>' : '');
  return `
  <div class="card">
    <div class="tabs">${tabs.map(t => `<button class="${f.show === t[0] ? 'active' : ''}" data-action="show" data-show="${t[0]}">${t[1]} <b>${t[2]}</b></button>`).join('')}</div>
    <div class="toolbar">
      <div class="chips">${Object.keys(E.TYPES).filter(k => tcount(k) > 0).map(k => `<button class="chip-btn ${f.types.has(k) ? 'on' : ''}" data-action="filter-type" data-type="${k}"><span class="dot" style="background:${E.TYPES[k].color}"></span>${E.TYPES[k].label} <b>${tcount(k)}</b></button>`).join('')}</div>
      <input type="search" class="search" placeholder="Buscar descrição, valor ou data…" data-search value="${esc(f.q)}">
      <button class="btn small" data-action="csv">Exportar CSV</button>
    </div>
    ${S.cmp ? `<p class="muted small">Comparação com a rodada ${S.cmp.prevN}: ${S.cmp.resolved.length} resolvida(s) · ${S.cmp.persistent} persistente(s) · ${S.cmp.fresh} nova(s).</p>` : ''}
    ${list.length ? `<div class="tablewrap"><table class="tbl"><thead><tr><th>Tipo</th><th>Extrato</th><th>Caixa</th><th class="r">Diferença</th><th>O que fazer</th></tr></thead><tbody>
      ${list.slice(0, f.limit).map(i => `<tr><td><span class="badge" style="--c:${E.TYPES[i.type].color}">${E.TYPES[i.type].label}</span>${tagS(i.status)}</td><td>${sideCell(i.bank)}</td><td>${sideCell(i.caixa)}</td><td class="r ${i.diff ? 'neg' : ''}">${i.diff ? U.brl(i.diff) : '—'}</td><td class="act">${esc(i.action)}</td></tr>`).join('')}
    </tbody></table></div>${list.length > f.limit ? `<div class="center"><button class="btn" data-action="more">Mostrar mais (${list.length - f.limit} restantes)</button></div>` : ''}`
      : `<div class="empty-sm">${f.show === 'pending' && !f.types.size && !f.q ? '🎉 Nenhuma pendência. O caixa está conferido.' : 'Nenhum item para este filtro.'}</div>`}
  </div>`;
}

/* ---------- histórico ---------- */
function history() {
  if (!S.rounds.length) return empty('Nenhuma rodada ainda');
  return `<div class="card"><h3>Pendências por rodada</h3><div class="chart h260"><canvas id="c-rounds"></canvas></div></div>
  <div class="card"><div class="card-h"><h3>Rodadas de conferência</h3><span class="muted small">Histórico mantido apenas nesta sessão do navegador.</span></div>
  <div class="tablewrap"><table class="tbl"><thead><tr><th>Rodada</th><th>Horário</th><th>Planilha de caixa</th><th class="r">Pendências</th><th class="r">Resolvidas</th><th class="r">Persistentes</th><th class="r">Novas</th><th class="r">Conciliação</th></tr></thead><tbody>
  ${S.rounds.slice().reverse().map(x => `<tr><td><b>#${x.n}</b></td><td>${x.at.toLocaleString('pt-BR')}</td><td>${esc(x.caixaName)}</td><td class="r ${x.pend ? 'neg' : 'pos'}">${x.pend}</td><td class="r pos">${x.cmp ? x.cmp.resolved : '—'}</td><td class="r">${x.cmp ? x.cmp.persistent : '—'}</td><td class="r ${x.cmp && x.cmp.fresh ? 'neg' : ''}">${x.cmp ? x.cmp.fresh : '—'}</td><td class="r">${U.pct(x.pct)}</td></tr>`).join('')}
  </tbody></table></div></div>`;
}

/* ---------- relatório ---------- */
function report() {
  const r = S.result; if (!r) return empty('Gere uma conferência para emitir o relatório');
  return `<div class="card"><h3>Relatório final de fechamento</h3>
  <p>O PDF traz o status do fechamento, indicadores (conciliação, entradas, saídas, fluxo líquido, saldos, ticket médio), gráficos, resumo por tipo, histórico de rodadas e a lista completa de pendências com a ação sugerida.</p>
  ${r.issues.length ? `<div class="banner warn small"><div class="b-ic">!</div><div>Ainda há <b>${r.issues.length}</b> pendência(s). O relatório sairá marcado como <b>“Com pendências”</b>. Corrija a planilha e reenvie para fechar.</div></div>` : '<div class="banner good small"><div class="b-ic">✓</div><div>Sem pendências: o relatório sairá como <b>“Caixa fechado”</b>.</div></div>'}
  <div class="row"><button class="btn primary" data-action="pdf">Gerar relatório em PDF</button><button class="btn" data-action="csv">Exportar divergências (CSV)</button></div></div>`;
}

/* ---------------- ações ---------------- */
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), 4200);
}

function exportCsv() {
  const r = S.result; if (!r) return;
  const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const side = x => (x ? [x.line, U.iso2br(x.date), x.desc, (x.cents / 100).toFixed(2).replace('.', ',')] : ['', '', '', '']);
  const lines = [['Tipo', 'Situação', 'Extrato banco', 'Extrato linha', 'Extrato data', 'Extrato descrição', 'Extrato valor', 'Caixa linha', 'Caixa data', 'Caixa descrição', 'Caixa valor', 'Diferença', 'Ação'].map(q).join(';')];
  r.issues.forEach(i => lines.push([E.TYPES[i.type].label, i.status || '', i.bank ? i.bank.bankName || '' : '', ...side(i.bank), ...side(i.caixa), (i.diff / 100).toFixed(2).replace('.', ','), i.action].map(q).join(';')));
  U.download('divergencias_fechamento_caixa.csv', new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
}

function makePdf() {
  if (!S.result) return;
  if (!window.jspdf) return toast('Biblioteca de PDF não carregada (verifique a conexão com a internet).', true);
  try {
    const doc = R.make(S);
    doc.save('Fechamento_de_Caixa_' + new Date().toISOString().slice(0, 10) + '.pdf');
    toast('Relatório PDF gerado.');
  } catch (e) { console.error(e); toast('Erro ao gerar o PDF: ' + e.message, true); }
}


function clearAll() {
  if (!confirm('Apagar todos os dados?\n\nOs arquivos carregados, as divergências e o histórico de rodadas serão removidos e o app voltará ao início. Os arquivos originais no seu computador não são afetados.')) return;
  resetFiles();
  S.opts = { window: 5, tolOk: 0, valueTol: 0, simMin: 0.5, flagDesc: false, opening: 0 };
  S.result = null; S.cmp = null; S.rounds = [];
  S.filt = { types: new Set(), q: '', show: 'pending', limit: 150 };
  S.view = 'overview'; renderAll(); window.scrollTo(0, 0);
  toast('Dados apagados. Envie novos arquivos para começar.');
}
function demo() {
  resetFiles(); S.rounds = []; S.result = null; S.cmp = null;
  const b = D.bank(); b._side = 'bank0'; S.files.bank0 = b; S.cfg.bank0 = P.makeCfg(b);
  const c = D.caixa(1); c._side = 'caixa'; S.files.caixa = c; S.cfg.caixa = P.makeCfg(c);
  recompute(true); toast('Exemplo carregado: extrato + caixa com erros. Em “Arquivos”, reenvie a versão corrigida.'); setView('overview');
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-view],[data-action]'); if (!t) return;
  const a = t.dataset.action;
  if (!a) return setView(t.dataset.view);
  if (a === 'goto') setView(t.dataset.view);
  else if (a === 'demo') demo();
  else if (a === 'demo2') loadFile('caixa', D.caixa(2));
  else if (a === 'filter-type') { const ty = t.dataset.type; if (S.filt.types.has(ty)) S.filt.types.delete(ty); else S.filt.types.add(ty); if (S.view !== 'issues') { S.filt.show = 'pending'; S.view = 'issues'; } S.filt.limit = 150; renderAll(); }
  else if (a === 'show') { S.filt.show = t.dataset.show; S.filt.limit = 150; renderAll(); }
  else if (a === 'more') { S.filt.limit += 300; renderAll(); }
  else if (a === 'csv') exportCsv();
  else if (a === 'pdf') makePdf();
  else if (a === 'clear') clearAll();
  else if (a === 'add-bank') { const k = 'bank' + S.nextBank++; S.banks.push(k); renderAll(); }
  else if (a === 'rm-bank') removeBank(t.dataset.key);
});

document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.file) { if (t.files.length) loadMany(t.dataset.file, [...t.files]); t.value = ''; return; }
  if (t.dataset.label) { S.labels[t.dataset.label] = t.value.trim(); recompute(false); renderAll(); return; }
  if (t.dataset.opt) {
    const k = t.dataset.opt;
    if (k === 'flagDesc') S.opts.flagDesc = t.checked;
    else if (k === 'valueTol') S.opts.valueTol = Math.max(0, Math.round((parseFloat(t.value) || 0) * 100));
    else if (k === 'simMin') S.opts.simMin = Math.min(1, Math.max(0.1, (parseFloat(t.value) || 50) / 100));
    else if (k === 'opening') S.opts.opening = U.parseAmount(t.value) || 0;
    else S.opts[k] = Math.max(0, parseInt(t.value, 10) || 0);
    recompute(false); renderAll(); return;
  }
  if (t.dataset.cfg) {
    const [side, key] = t.dataset.cfg.split(':'), cfg = S.cfg[side], f = S.files[side];
    if (key === 'sheet') { f.sheet = +t.value; S.cfg[side] = P.makeCfg(f); }
    else if (key === 'invert') cfg.invert = t.checked;
    else if (key === 'mode') cfg.mode = t.value;
    else if (key === 'headerRow') { const hr = Math.max(0, parseInt(t.value, 10) || 0); Object.assign(cfg, P.autoMap(f.sheets[f.sheet].rows, hr), { headerRow: hr }); }
    else cfg[key] = +t.value;
    recompute(false); renderAll();
  }
});

document.addEventListener('input', e => {
  if (e.target.matches('[data-search]')) {
    S.filt.q = e.target.value; S.filt.limit = 150;
    const pos = e.target.selectionStart; renderAll();
    const s = $('[data-search]'); if (s) { s.focus(); s.setSelectionRange(pos, pos); }
  }
});

['dragover', 'dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => {
  const z = e.target.closest && e.target.closest('[data-drop]'); if (!z) return;
  e.preventDefault();
  z.classList.toggle('over', ev === 'dragover');
  if (ev === 'drop' && e.dataTransfer.files.length) loadMany(z.dataset.drop, [...e.dataTransfer.files]);
}));
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

renderAll();
