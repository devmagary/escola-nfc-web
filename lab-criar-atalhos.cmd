@echo off
REM Cria, na area de trabalho do Windows, atalhos de duplo clique para o
REM laboratorio: Menu, Ligar, Desligar e Checar. Seguro para rodar outra vez.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-atalhos.ps1"
