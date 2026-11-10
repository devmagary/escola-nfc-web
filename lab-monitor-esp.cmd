@echo off
REM Monitor continuo do ESP32-S3, NFC e biometria (serial + HTTP).
REM Gera logs em logs\esp-monitor-*.jsonl e *.alertas.log.
REM Para parar, feche esta janela ou rode lab-monitor-esp-stop.cmd.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-monitor-esp.ps1" %*
echo.
pause
