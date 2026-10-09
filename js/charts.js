'use strict';
/* Configurações de gráficos (Chart.js) reaproveitadas no dashboard e no PDF */
const C = {};
const BLUE = '#1d5fb8', GREEN = '#12a36b', NAVY = '#0f2d52', GRID = '#e6edf5';
const reais = c => c / 100;
const compact = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const money = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

C.donut = r => {
  const keys = Object.keys(E.TYPES).filter(k => r.counts[k] > 0);
  return {
    type: 'doughnut',
    data: { labels: keys.map(k => E.TYPES[k].label), datasets: [{ data: keys.map(k => r.counts[k]), backgroundColor: keys.map(k => E.TYPES[k].color), borderWidth: 2, borderColor: '#fff' }] },
    options: { cutout: '66%', maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, usePointStyle: true } } } },
  };
};

C.flow = r => ({
  type: 'bar',
  data: {
    labels: ['Entradas', 'Saídas'],
    datasets: [
      { label: 'Extrato', data: [reais(r.totals.bank.in), reais(r.totals.bank.out)], backgroundColor: BLUE, borderRadius: 6 },
      { label: 'Caixa', data: [reais(r.totals.caixa.in), reais(r.totals.caixa.out)], backgroundColor: GREEN, borderRadius: 6 },
    ],
  },
  options: {
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + money(c.parsed.y) } } },
    scales: { y: { grid: { color: GRID }, ticks: { callback: compact } }, x: { grid: { display: false } } },
  },
});

C.cash = r => ({
  type: 'line',
  data: {
    labels: r.series.map(s => s.label),
    datasets: [
      { label: 'Saldo acumulado – Extrato', data: r.series.map(s => reais(s.bank)), borderColor: BLUE, backgroundColor: 'rgba(29,95,184,.10)', fill: true, tension: 0.3, pointRadius: 2 },
      { label: 'Saldo acumulado – Caixa', data: r.series.map(s => reais(s.caixa)), borderColor: GREEN, borderDash: [5, 4], tension: 0.3, pointRadius: 2 },
    ],
  },
  options: {
    maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } }, tooltip: { callbacks: { label: c => c.dataset.label + ': ' + money(c.parsed.y) } } },
    scales: { y: { grid: { color: GRID }, ticks: { callback: compact } }, x: { grid: { display: false } } },
  },
});

C.rounds = rounds => ({
  type: 'line',
  data: {
    labels: rounds.map(x => 'Rodada ' + x.n),
    datasets: [{ label: 'Pendências', data: rounds.map(x => x.pend), borderColor: '#d97706', backgroundColor: 'rgba(217,119,6,.12)', fill: true, tension: 0.25, pointRadius: 4 }],
  },
  options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: GRID }, ticks: { precision: 0 } }, x: { grid: { display: false } } } },
});

C.cats = r => ({
  type: 'bar',
  data: { labels: r.topCats.map(c => c[0]), datasets: [{ label: 'Saídas (caixa)', data: r.topCats.map(c => reais(c[1])), backgroundColor: BLUE, borderRadius: 6 }] },
  options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => money(c.parsed.x) } } }, scales: { x: { grid: { color: GRID }, ticks: { callback: compact } }, y: { grid: { display: false } } } },
});

if (window.Chart) {
  Chart.defaults.font.family = "'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";
  Chart.defaults.color = '#475569';
}
