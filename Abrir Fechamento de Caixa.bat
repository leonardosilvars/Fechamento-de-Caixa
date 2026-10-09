@echo off
cd /d "%~dp0"
echo Iniciando Fechamento de Caixa em http://localhost:5178 ...
echo (mantenha esta janela aberta enquanto usar o app; feche-a para encerrar)
start "" "http://localhost:5178"
powershell -NoProfile -ExecutionPolicy Bypass -File ".claude\serve.ps1"
