'use strict';
/* Dados de exemplo para demonstrar o fluxo (extrato, caixa com erros, caixa corrigida) */
const D = {};

const BASE = [
  ['01', 'Recebimento PIX Loja Centro', 425000, 'Vendas'],
  ['01', 'Pagamento aluguel', -380000, 'Aluguel'],
  ['02', 'Recebimento cartao Visa', 318450, 'Vendas'],
  ['02', 'Material escritorio Papelaria Rio', -42790, 'Despesas administrativas'],
  ['03', 'Pagamento Alfa Embalagens', -185000, 'Fornecedores'],
  ['03', 'Recebimento Mercado Bom Preco', 270000, 'Vendas'],
  ['04', 'Tarifa bancaria manutencao conta', -8990, 'Tarifas'],
  ['05', 'Energia eletrica CEMIG', -64210, 'Utilidades'],
  ['05', 'Recebimento cartao Master', 287310, 'Vendas'],
  ['08', 'Folha de pagamento salarios', -1250000, 'Folha'],
  ['08', 'Recebimento Padaria Sol', 96000, 'Vendas'],
  ['09', 'Internet Vivo Empresas', -29900, 'Utilidades'],
  ['10', 'Recebimento cartao Visa', 354200, 'Vendas'],
  ['10', 'Pagamento Beta Distribuidora', -412500, 'Fornecedores'],
  ['11', 'Recebimento Restaurante Bom Sabor', 183700, 'Vendas'],
  ['12', 'Imposto DAS Simples Nacional', -276400, 'Impostos'],
  ['12', 'Combustivel Posto Ipiranga', -35000, 'Despesas operacionais'],
  ['15', 'Recebimento cartao Master', 301580, 'Vendas'],
  ['15', 'Honorarios contador', -90000, 'Servicos'],
  ['16', 'Recebimento Casa Verde', 124500, 'Vendas'],
  ['17', 'Pagamento Gama Plasticos', -157300, 'Fornecedores'],
  ['18', 'Recebimento cartao Visa', 276900, 'Vendas'],
  ['19', 'Manutencao equipamentos Tecnica Sul', -68000, 'Manutencao'],
  ['22', 'Recebimento Hotel Panorama', 459000, 'Vendas'],
  ['22', 'Seguro empresarial', -52300, 'Seguros'],
  ['23', 'Recebimento cartao Master', 262410, 'Vendas'],
  ['24', 'Pagamento Alfa Embalagens', -203500, 'Fornecedores'],
  ['25', 'Marketing anuncios Google', -45000, 'Marketing'],
  ['26', 'Recebimento Escola Futuro', 138000, 'Vendas'],
  ['29', 'Recebimento cartao Visa', 331250, 'Vendas'],
  ['30', 'Pro-labore socios', -600000, 'Folha'],
  ['30', 'Tarifa DOC/TED', -2450, 'Tarifas'],
];

const br = c => (Math.abs(c) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d, m) => d + '/' + (m || '09') + '/2026';

D.bank = () => {
  const rows = [['Data', 'Histórico', 'Valor'], ...BASE.map(b => [dt(b[0]), b[1].toUpperCase(), (b[2] < 0 ? '-' : '') + br(b[2])])];
  return { name: 'extrato_setembro_exemplo.csv', kind: 'csv', sheets: [{ name: 'CSV', rows }], sheet: 0 };
};

/* v1 = caixa com erros; v2 = corrigida (restam 1 pendência antiga e 1 nova) */
D.caixa = v => {
  let L = BASE.map(b => ({ d: dt(b[0]), h: b[1], c: b[2], k: b[3] }));
  const f = h => L.find(x => x.h === h);
  L = L.filter(x => x.h !== 'Tarifa DOC/TED');
  if (v === 1) L = L.filter(x => x.h !== 'Tarifa bancaria manutencao conta');
  f('Energia eletrica CEMIG').c = -64120;                       // valor trocado (persiste na v2)
  if (v === 1) {
    f('Pagamento Beta Distribuidora').d = dt('12');              // data divergente
    f('Combustivel Posto Ipiranga').c = 35000;                   // sinal invertido
    L.push({ d: dt('09'), h: 'Internet Vivo Empresas', c: -29900, k: 'Utilidades' }); // duplicado
    L.push({ d: dt('12'), h: 'Almoco reuniao clientes', c: -18500, k: 'Despesas operacionais' }); // indevido
    L.push({ d: dt('02', '10'), h: 'Adiantamento fornecedor', c: -150000, k: 'Fornecedores' });   // fora do período
  } else {
    f('Marketing anuncios Google').c = -54000;                   // novo erro
  }
  L.sort((a, b) => a.d.split('/').reverse().join('').localeCompare(b.d.split('/').reverse().join('')));
  const rows = [['Data', 'Histórico', 'Entrada', 'Saída', 'Categoria'], ...L.map(x => [x.d, x.h, x.c > 0 ? x.c / 100 : '', x.c < 0 ? -x.c / 100 : '', x.k])];
  return { name: v === 1 ? 'caixa_setembro_v1.xlsx' : 'caixa_setembro_v2_corrigida.xlsx', kind: 'xlsx', sheets: [{ name: 'Caixa', rows }], sheet: 0 };
};
