@echo off
REM Desliga com seguranca: fecha o painel, guarda o banco e desliga o hotspot.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-menu.ps1" -Acao desligar
