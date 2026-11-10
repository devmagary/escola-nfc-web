@echo off
REM Para o monitor iniciado por lab-monitor-esp.cmd / lab-monitor-esp.ps1.
setlocal
set "ARQUIVO=%~dp0logs\monitor.pid"
if not exist "%ARQUIVO%" (
  echo O monitor nao esta rodando ^(sem logs\monitor.pid^).
  pause
  exit /b
)
set /p PIDMONITOR=<"%ARQUIVO%"
taskkill /PID %PIDMONITOR% /F
del "%ARQUIVO%" >NUL 2>NUL
echo Monitor parado.
pause
