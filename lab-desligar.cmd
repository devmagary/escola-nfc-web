@echo off
REM Desliga com seguranca: fecha o painel e guarda o banco (nada e apagado).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-menu.ps1" -Acao desligar
