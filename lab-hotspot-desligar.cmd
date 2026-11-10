@echo off
REM Desliga o hotspot do laboratorio NFC (a rede Wi-Fi criada por lab-hotspot.cmd).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-hotspot.ps1" -Acao desligar
echo.
pause
