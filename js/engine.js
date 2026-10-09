'use strict';
/* Motor de conciliação: compara extrato x caixa. Não altera nenhum dado de entrada. */
const E = {};

E.TYPES = {
  ok: { label: 'Conciliado', color: '#16a34a' },
  only_bank: { label: 'Só no extrato', color: '#2563eb' },
  only_caixa: { label: 'Só no caixa', color: '#0891b2' },
  value: { label: 'Valor divergente', color: '#d97706' },
  date: { label: 'Data divergente', color: '#7c3aed' },
  sign: { label: 'Sinal invertido', color: '#dc2626' },
  dup: { label: 'Possível duplicidade', color: '#be185d' },
  desc: { label: 'Descrição divergente', color: '#64748b' },
};

E.sum = items => {
  let inn = 0, out = 0, max_in = 0, max_out = 0;
  items.forEach(i => { if (i.cents >= 0) { inn += i.cents; max_in = Math.max(max_in, i.cents); } else { out += -i.cents; max_out = Math.max(max_out, -i.cents); } });
  return { count: items.length, in: inn, out, net: inn - out, maxIn: max_in, maxOut: max_out };
};

E.reconcile = (bank, caixa, o) => {
  const usedB = new Set(), usedC = new Set(), pairs = [];
  const pair = (b, c, kind) => { usedB.add(b.id); usedC.add(c.id); pairs.push({ b, c, kind }); };
  const dd = (b, c) => Math.abs(b.day - c.day);
  const index = (arr, fn) => { const m = new Map(); arr.forEach(x => { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }); return m; };

  // 1) data + valor idênticos
  const byKey = index(bank, b => b.day + '|' + b.cents);
  caixa.forEach(c => {
    const l = (byKey.get(c.day + '|' + c.cents) || []).filter(b => !usedB.has(b.id));
    if (!l.length) return;
    let best = l[0], bs = -1;
    l.forEach(b => { const s = U.sim(b.desc, c.desc); if (s > bs) { bs = s; best = b; } });
    pair(best, c, 'ok');
  });

  // 2) mesmo valor, data diferente dentro da janela
  const byCents = index(bank.filter(b => !usedB.has(b.id)), b => b.cents);
  caixa.forEach(c => {
    if (usedC.has(c.id)) return;
    const l = (byCents.get(c.cents) || []).filter(b => !usedB.has(b.id) && dd(b, c) <= o.window);
    if (!l.length) return;
    l.sort((a, b) => dd(a, c) - dd(b, c) || U.sim(b.desc, c.desc) - U.sim(a.desc, c.desc));
    pair(l[0], c, dd(l[0], c) <= o.tolOk ? 'ok' : 'date');
  });

  // 3) mesmo valor absoluto com sinal oposto
  const byNeg = index(bank.filter(b => !usedB.has(b.id)), b => b.cents);
  caixa.forEach(c => {
    if (usedC.has(c.id) || c.cents === 0) return;
    const l = (byNeg.get(-c.cents) || []).filter(b => !usedB.has(b.id) && dd(b, c) <= o.window);
    if (!l.length) return;
    l.sort((a, b) => dd(a, c) - dd(b, c));
    pair(l[0], c, 'sign');
  });

  // 4) descrição semelhante com valor diferente
  const rest = bank.filter(b => !usedB.has(b.id));
  caixa.forEach(c => {
    if (usedC.has(c.id)) return;
    let best = null, bs = 0;
    rest.forEach(b => {
      if (usedB.has(b.id) || dd(b, c) > o.window || Math.sign(b.cents) !== Math.sign(c.cents)) return;
      const s = U.sim(b.desc, c.desc);
      if (s < o.simMin) return;
      const sc = s - dd(b, c) * 0.01;
      if (sc > bs) { bs = sc; best = b; }
    });
    if (!best) return;
    const vOk = Math.abs(best.cents - c.cents) <= o.valueTol, dOk = dd(best, c) <= o.tolOk;
    pair(best, c, vOk && dOk ? 'ok' : vOk ? 'date' : 'value');
  });

  // ---------- monta resultado ----------
  const bMin = bank.length ? Math.min(...bank.map(x => x.day)) : 0, bMax = bank.length ? Math.max(...bank.map(x => x.day)) : 0;
  const twin = arr => { const m = new Map(); arr.forEach(x => { const k = x.day + '|' + x.cents; m.set(k, (m.get(k) || 0) + 1); }); return m; };
  const twinB = twin(bank), twinC = twin(caixa);
  const seen = new Map();
  const issues = [], matched = [];
  const add = (type, b, c, action, extra) => {
    const nd = x => (x ? x.date + '|' + x.cents + '|' + U.norm(x.desc) : '-');
    let key = type + '|' + nd(b) + '|' + nd(c);
    const n = (seen.get(key) || 0) + 1; seen.set(key, n); if (n > 1) key += '#' + n;
    const it = Object.assign({ key, type, bank: b || null, caixa: c || null, diff: (b ? b.cents : 0) - (c ? c.cents : 0), action }, extra);
    issues.push(it);
  };
  const L = (x, nome) => 'linha ' + x.line + ' do ' + nome;

  pairs.forEach(({ b, c, kind }) => {
    const days = b.day - c.day;
    if (kind === 'ok') {
      const s = U.sim(b.desc, c.desc);
      if (o.flagDesc && b.desc && c.desc && s < 0.15) add('desc', b, c, 'Descrições muito diferentes (' + L(c, 'caixa') + ' x ' + L(b, 'extrato') + '). Confirme se é o mesmo lançamento.');
      else matched.push({ type: 'ok', bank: b, caixa: c, diff: b.cents - c.cents, dayDiff: days, action: 'Sem ação' });
    } else if (kind === 'date') {
      add('date', b, c, 'Ajustar a data na ' + L(c, 'caixa') + ': caixa ' + U.iso2br(c.date) + ', extrato ' + U.iso2br(b.date) + ' (' + Math.abs(days) + ' dia(s) de diferença).', { dayDiff: days });
    } else if (kind === 'sign') {
      add('sign', b, c, 'Sinal invertido na ' + L(c, 'caixa') + ': caixa lançou como ' + (c.cents < 0 ? 'saída' : 'entrada') + ', extrato como ' + (b.cents < 0 ? 'saída' : 'entrada') + '.', { dayDiff: days });
    } else {
      const dtxt = days ? ' A data também difere (caixa ' + U.iso2br(c.date) + ', extrato ' + U.iso2br(b.date) + ').' : '';
      add('value', b, c, 'Ajustar o valor na ' + L(c, 'caixa') + ': caixa ' + U.brl(c.cents) + ', extrato ' + U.brl(b.cents) + ' (diferença ' + U.brl(b.cents - c.cents) + ').' + dtxt, { dayDiff: days });
    }
  });

  bank.filter(b => !usedB.has(b.id)).forEach(b => {
    if ((twinB.get(b.day + '|' + b.cents) || 0) > 1) add('dup', b, null, 'Existe outro lançamento idêntico no extrato (' + L(b, 'extrato') + ') sem correspondente no caixa: possível duplicidade no banco ou lançamento faltando.');
    else add('only_bank', b, null, 'Lançar no caixa: "' + b.desc + '" de ' + U.brl(b.cents) + ' em ' + U.iso2br(b.date) + ' (' + L(b, 'extrato') + ').');
  });
  caixa.filter(c => !usedC.has(c.id)).forEach(c => {
    const out = c.day < bMin || c.day > bMax;
    if ((twinC.get(c.day + '|' + c.cents) || 0) > 1) add('dup', null, c, 'Possível duplicidade na ' + L(c, 'caixa') + ': existe outro lançamento idêntico e o extrato não tem este valor repetido. Remova o excedente.');
    else add('only_caixa', null, c, 'Conferir a ' + L(c, 'caixa') + ': não consta no extrato.' + (out ? ' A data está fora do período do extrato (' + U.iso2br(U.dayToIso(bMin)) + ' a ' + U.iso2br(U.dayToIso(bMax)) + '): verifique data digitada ou lançamento futuro.' : ' Pode ser lançamento indevido, valor/data incorretos ou não compensado.'), { outside: out });
  });

  const order = Object.keys(E.TYPES);
  const dayOf = i => (i.bank || i.caixa).day;
  issues.sort((a, b) => dayOf(a) - dayOf(b) || order.indexOf(a.type) - order.indexOf(b.type));
  matched.sort((a, b) => a.bank.day - b.bank.day);

  const counts = {}; order.forEach(k => (counts[k] = 0));
  counts.ok = matched.length; issues.forEach(i => counts[i.type]++);
  const pendValue = issues.reduce((a, i) => a + Math.abs(i.diff), 0);
  const okVol = matched.reduce((a, m) => a + Math.abs(m.bank.cents), 0);
  const issVol = issues.reduce((a, i) => a + Math.max(Math.abs(i.bank ? i.bank.cents : 0), Math.abs(i.caixa ? i.caixa.cents : 0)), 0);
  const universe = matched.length + issues.length;

  const tb = E.sum(bank), tc = E.sum(caixa);
  const dayMap = new Map();
  const dayRow = d => { if (!dayMap.has(d)) dayMap.set(d, { b: 0, c: 0 }); return dayMap.get(d); };
  bank.forEach(x => (dayRow(x.day).b += x.cents));
  caixa.forEach(x => (dayRow(x.day).c += x.cents));
  const days = [...dayMap.keys()].sort((a, b) => a - b);
  let cb = o.opening || 0, cc = o.opening || 0;
  const series = days.map(d => { const r = dayMap.get(d); cb += r.b; cc += r.c; return { day: d, label: U.iso2short(U.dayToIso(d)), bank: cb, caixa: cc, bankDay: r.b, caixaDay: r.c }; });

  const cats = new Map();
  caixa.forEach(x => { if (x.cat && x.cents < 0) cats.set(x.cat, (cats.get(x.cat) || 0) - x.cents); });
  const topCats = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  const all = bank.concat(caixa);
  return {
    matched, issues, counts, totals: { bank: tb, caixa: tc },
    pendValue, universe,
    pctQtd: universe ? matched.length / universe : 0,
    pctVal: okVol + issVol ? okVol / (okVol + issVol) : 0,
    diffNet: tb.net - tc.net,
    opening: o.opening || 0, closingBank: (o.opening || 0) + tb.net, closingCaixa: (o.opening || 0) + tc.net,
    period: all.length ? { from: U.dayToIso(Math.min(...all.map(x => x.day))), to: U.dayToIso(Math.max(...all.map(x => x.day))) } : null,
    bankPeriod: bank.length ? { from: U.dayToIso(bMin), to: U.dayToIso(bMax) } : null,
    series, topCats, ticketMedio: bank.length ? Math.round(bank.reduce((a, x) => a + Math.abs(x.cents), 0) / bank.length) : 0,
  };
};
