@echo off
REM ============================================================
REM  Liberar o firewall para o laboratorio offline (Windows)
REM  Abre as portas do painel, do Supabase e do Studio SOMENTE
REM  para as redes locais (Wi-Fi, cabo e hotspot do notebook),
REM  em qualquer perfil (Privado/Publico). Nao abre para a internet.
REM  Se o Windows pedir confirmacao, clique em "Sim".
REM ============================================================
NET FILE 1>NUL 2>NUL || (
  echo Pedindo permissao de administrador... clique em "Sim" se aparecer uma janela.
  powershell -NoProfile -Command "Start-Process -FilePath \"%~f0\" -Verb RunAs"
  exit /b
)

REM Remove regras antigas com o mesmo nome (rodar duas vezes nao duplica nada).
netsh advfirewall firewall delete rule name="Supabase local (lab)" >NUL 2>NUL
netsh advfirewall firewall delete rule name="Painel portaria local (lab)" >NUL 2>NUL
netsh advfirewall firewall delete rule name="Supabase API (lab)" >NUL 2>NUL
netsh advfirewall firewall delete rule name="Painel NFC (lab)" >NUL 2>NUL
netsh advfirewall firewall delete rule name="Studio Supabase (lab)" >NUL 2>NUL

REM LocalSubnet = Wi-Fi, cabo e hotspot (192.168.137.0/24), sem expor a internet.
netsh advfirewall firewall add rule name="Supabase API (lab)" dir=in action=allow protocol=TCP localport=54321 profile=any remoteip=localsubnet
netsh advfirewall firewall add rule name="Painel NFC (lab)" dir=in action=allow protocol=TCP localport=80,5500 profile=any remoteip=localsubnet
netsh advfirewall firewall add rule name="Studio Supabase (lab)" dir=in action=allow protocol=TCP localport=54323 profile=any remoteip=localsubnet

echo.
echo Pronto: portas 80, 5500, 54321 e 54323 liberadas so para a rede local.
echo Vale tambem quando o hotspot NFC-Lab esta ligado (192.168.137.1).
echo Se algum dispositivo ainda nao acessar, verifique se ele esta na MESMA rede do notebook.
echo.
pause
