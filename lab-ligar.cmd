@echo off
REM Liga o laboratorio completo: Docker, hotspot quando necessario, banco
REM (Supabase local) e painel. Abre uma janela "Painel NFC" que NAO deve ser
REM fechada enquanto em uso.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-menu.ps1" -Acao ligar
