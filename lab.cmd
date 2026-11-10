@echo off
REM Menu do laboratorio offline: ligar/desligar, checar, enderecos, hotspot,
REM firewall, backup, zerar e configurar. Setas/Enter, 1-9; 0 ou ESC sai.
REM Para atalhos permanentes na area de trabalho, rode lab-criar-atalhos.cmd.
title Servidor NFC - Laboratorio offline
mode con: cols=80 lines=30 >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-menu.ps1"
