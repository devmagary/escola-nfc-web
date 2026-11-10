@echo off
REM Cria, na area de trabalho do Windows, atalhos de duplo clique para o
REM laboratorio: Servidor NFC e Hotspot NFC. Seguro para rodar outra vez.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-atalhos.ps1"
