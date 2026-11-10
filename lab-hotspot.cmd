@echo off
REM ============================================================
REM  Hotspot do laboratorio NFC (Windows)
REM  Cria uma rede Wi-Fi local mesmo sem internet/outro Wi-Fi.
REM  Duplo clique = ligar. Para desligar, use lab-hotspot-desligar.cmd
REM  Ou passe um argumento: lab-hotspot.cmd status|desligar
REM ============================================================
setlocal
set "ACAO=%~1"
if "%ACAO%"=="" set "ACAO=ligar"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-hotspot.ps1" -Acao "%ACAO%"

echo.
pause
