# Fechamento de Caixa

Confere o extrato bancário contra a planilha de caixa, lista as divergências e gera relatório final em PDF. Site estático (HTML + JS), sem backend: os arquivos são processados no navegador e nunca são enviados a nenhum servidor.

Detalhes do projeto: [CLAUDE.md](CLAUDE.md).

## Uso local
- Windows: duplo clique em `Abrir Fechamento de Caixa.bat` (abre http://localhost:5178), ou
- abrir `index.html` direto no navegador. Todas as bibliotecas ficam em `js/vendor/`, então funciona sem internet.

## Publicação (GitHub + Netlify)
1. Envie o repositório ao GitHub.
2. No Netlify: *Add new site → Import from Git*, escolha o repositório. Sem comando de build; diretório de publicação `.` (já definido em `netlify.toml`).
3. A cada `git push` o Netlify republica automaticamente.
4. Se o site for só da empresa, ative proteção por senha ou login em *Site configuration → Access & security* (planos pagos) ou deixe o endereço restrito.

## Dados de teste
`docs/extrato_outubro_2026.csv` e `docs/caixa_outubro_2026.csv` (fictícios, com 8 divergências propositais).
Para testar vários bancos: envie juntos `docs/extrato_banco_A_outubro.csv`, `..._B_...` e `..._C_...` (o mesmo extrato dividido em 3 bancos) com o mesmo caixa; o resultado é idêntico.
