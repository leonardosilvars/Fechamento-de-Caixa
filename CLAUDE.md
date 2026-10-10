# Fechamento de Caixa

Aplicação web interativa (estilo Dashboard financeiro) que **confere** o extrato bancário contra a planilha de caixa da empresa, lista as divergências e gera um relatório final em PDF com indicadores (KPIs) do fluxo de caixa.

## Princípios

1. **Somente leitura**: o app NUNCA altera os arquivos enviados. Apenas compara e relata.
2. **Rastreabilidade**: toda diferença aponta onde está (arquivo, linha, data, valor, descrição) e qual é a pendência.
3. **Ciclo de correção**: o usuário corrige a planilha fora do app e reenvia; o app revalida e mostra o que ainda está pendente / o que foi resolvido.
4. **Privacidade**: processamento 100% local no navegador (nenhum dado financeiro sai da máquina) — *a confirmar*.

## Entradas

| Arquivo | Origem | Formatos previstos |
|---|---|---|
| Extrato bancário | Banco | OFX, CSV, XLSX (PDF em fase posterior) — *a confirmar* |
| Planilha de caixa | Empresa | XLSX, CSV — *a confirmar layout das colunas* |

## Regras de conferência (proposta inicial)

Cada lançamento é normalizado em: `data`, `descrição`, `valor`, `tipo (entrada/saída)`, `linha de origem`.

Classificação do resultado:

- **Conciliado**: mesma data, mesmo valor e mesmo tipo (descrição semelhante como reforço).
- **Só no extrato**: o banco tem, o caixa não (lançamento esquecido).
- **Só no caixa**: o caixa tem, o banco não (lançamento indevido, futuro ou não compensado).
- **Valor divergente**: mesma data/descrição, valor diferente.
- **Data divergente**: mesmo valor/descrição, data diferente (tolerância configurável, ex.: ±N dias).
- **Duplicado**: lançamento repetido em um dos lados.
- **Saldo**: saldo inicial/final do extrato vs. saldo calculado da planilha.

Parâmetros configuráveis: tolerância de dias, tolerância de valor (centavos), sensibilidade da descrição, período de análise.

## Telas / Funcionalidades

1. **Upload**: duas áreas de arrastar-e-soltar (extrato e caixa) com pré-visualização e mapeamento de colunas.
2. **Dashboard de conferência**: cards-resumo (total conciliado, pendências, diferença em R$), gráficos, status geral (Fechado / Com pendências).
3. **Lista de divergências**: tabela filtrável/ordenável (tipo, data, valor), mostrando origem (arquivo + linha) e a pendência sugerida.
4. **Reenvio / revalidação**: novo upload da planilha corrigida; comparação com a rodada anterior (resolvidas, novas, persistentes). Histórico de rodadas.
5. **Relatório final em PDF**: resultado do fechamento + KPIs.

## KPIs do relatório (proposta)

- Total de entradas e saídas (extrato vs. caixa)
- Saldo inicial, final e variação do período
- Fluxo de caixa líquido
- % de conciliação (qtd e valor)
- Nº e valor das pendências por tipo
- Maiores entradas/saídas
- Evolução diária/semanal do saldo
- Ticket médio, concentração por categoria (se a planilha tiver categoria)

## Visual

- Fundo **branco**; paleta em **tons de azul e verde** (azul = estrutura/informação, verde = conciliado/positivo; tons de alerta discretos para pendências).
- Aparência profissional de aplicação financeira: sidebar, cards de KPI, gráficos limpos, tipografia sóbria, números alinhados, formato pt-BR (R$ 1.234,56; dd/mm/aaaa).
- Responsivo.

## Stack (proposta — a confirmar)

HTML + JavaScript no navegador, sem backend: SheetJS (XLSX/CSV), parser OFX próprio, Chart.js (gráficos), jsPDF/pdf-lib (PDF). Execução local abrindo o `index.html`.

## Estrutura planejada

```
index.html
css/        estilos do dashboard
js/         parsers, motor de conciliação, gráficos, relatório PDF
docs/       exemplos de arquivos para teste
CLAUDE.md   este documento
```

## Decisões confirmadas

- Formatos: extrato em CSV/Excel/PDF (OFX também aceito); caixa em Excel (.xlsx) (CSV também aceito).
- Execução local no navegador, sem backend.
- Critério principal de conciliação: **data + valor** (descrição como reforço, tolerâncias configuráveis).

## Estado atual (implementado)

- `index.html` + `css/style.css` + `js/` (`utils`, `parsers`, `engine`, `charts`, `report`, `demo`, `app`). Bibliotecas locais em `js/vendor/` (SheetJS 0.18.5, Chart.js 4.4.1, jsPDF 2.5.1 + autotable 3.8.2, pdf.js 3.11.174 carregado sob demanda); funciona offline.
- Vários bancos: cada extrato ocupa um slot (bank0, bank1…), com nome editável; todos são unificados e conferidos contra um único caixa; resumo por banco no dashboard e no PDF.
- Telas: Visão geral, Arquivos (mapeamento de colunas + parâmetros), Divergências (filtros, busca, CSV), Histórico de rodadas, Relatório PDF.
- Reenvio do caixa cria nova rodada e marca divergências como resolvida / persistente / nova.
- Botão "Carregar exemplo" gera dados de demonstração (extrato + caixa com erros + caixa corrigida).
- Rodar localmente: abrir `index.html` ou `.claude/serve.ps1` (servidor estático em http://localhost:5178).

## Pendências / próximos passos

- Testar com arquivos reais (layouts do banco e da planilha) e ajustar auto-detecção de colunas.
- PDF de extrato depende do texto extraível (PDFs escaneados exigiriam OCR).
- Histórico de rodadas só vive na sessão (não persiste ao fechar a página).

## Leitura de PDF (formatos reconhecidos)

- **Extrato Cora (PDF com texto):** data, tipo, nome, documento e valor por lançamento. Validado pelos totais do cabeçalho (entradas, saídas, saldo final).
- **Relatório de Caixa Bancário (PDF "desenhado", sem texto):** lido por OCR local (Tesseract.js + idioma `por`, em `js/vendor/tesseract/`), com a página girada 90°. Colunas: Data, Pagante/Credor, Descrição, Caixa, Valor, Taxa, Líquido, Transferido, Saldo. Cada linha é conferida pelo saldo corrente e o rodapé (variação e saldo final) é validado.
- Recebimentos individuais de plataformas (ASAAS/PagSeguro) não entram no banco; só a linha "Transferência: X --> Banco Y". Por isso o caixa é filtrado pela conta bancária ("Caixa" contém "Banco Cora") e as transferências ganham sinal pela direção.
- Conciliação por soma: 1 lançamento do extrato = 2 a 4 do caixa (mesmo favorecido e data).
- OCR leva ~2-3 min para 28 páginas e só funciona via http(s) (atalho `.bat` ou Netlify), não com `index.html` aberto por `file://`.
