@echo off
REM Menu do laboratorio offline: liga, desliga, checa, endereços e zerar.
REM Use as setas do teclado (ou 1..5) e Enter. ESC sai.
REM Para atalhos permanentes na area de trabalho, rode lab-criar-atalhos.cmd.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-menu.ps1"
