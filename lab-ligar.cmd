@echo off
REM Liga o laboratorio completo: Docker, banco (Supabase local) e painel.
REM Abre uma janela "Painel NFC" que NAO deve ser fechada enquanto em uso.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lab-menu.ps1" -Acao ligar
