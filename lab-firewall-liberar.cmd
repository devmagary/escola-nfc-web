@echo off
REM ============================================================
REM  Liberar o firewall para o laboratorio offline (Windows)
REM  Abre as portas 54321 (Supabase) e 5500 (painel) na rede
REM  PRIVADA. Se o Windows pedir confirmacao, clique em "Sim".
REM ============================================================
NET FILE 1>NUL 2>NUL || (
  echo Pedindo permissao de administrador... clique em "Sim" se aparecer uma janela.
  powershell -NoProfile -Command "Start-Process -FilePath \"%~f0\" -Verb RunAs"
  exit /b
)

REM Remove regras antigas com o mesmo nome (rodar duas vezes nao duplica nada).
netsh advfirewall firewall delete rule name="Supabase local (lab)" >NUL 2>NUL
netsh advfirewall firewall delete rule name="Painel portaria local (lab)" >NUL 2>NUL
netsh advfirewall firewall add rule name="Supabase local (lab)" dir=in action=allow protocol=TCP localport=54321 profile=private
netsh advfirewall firewall add rule name="Painel portaria local (lab)" dir=in action=allow protocol=TCP localport=5500 profile=private

echo.
echo Pronto: portas 54321 e 5500 liberadas na rede privada.
echo Se algum dispositivo ainda nao acessar, verifique se ele esta na MESMA rede do notebook.
echo.
pause
