# =============================================================================
# lab-menu.ps1 — TUI unificada do laboratório offline (Acesso Escolar NFC)
# ---------------------------------------------------------------------------
# Tela única (24 linhas, cabe na janela padrão) com:
#   - luzes ao vivo: Docker, Banco, Painel, Placa ESP32 e Hotspot (medidas por
#     um processo de fundo; a TUI só lê um arquivo, então o teclado nunca espera)
#   - menu completo: ligar/desligar, checar, abrir painel, endereços, hotspot,
#     firewall, backup, recomeçar do zero e configurar
#
# Ações diretas (para atalhos/scripts):
#   lab-menu.ps1 -Acao ligar|desligar|checar|enderecos|hotspot|backup|zerar
#
# Desempenho: polling de 25 ms (latência imperceptível); luzes a cada 0,8 s com
# cache (só redesenha quando mudam); estado em processo separado, com Docker
# por named pipe e Banco/Painel por TCP. Compatível com Windows PowerShell 5.1.
# =============================================================================
param([string]$Acao = '', [switch]$SemPausa)

try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }
try { [Console]::CursorVisible = $false } catch { }

$script:Projeto = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $script:Projeto

# =============================================================================
# Utilidades de infraestrutura (usadas pelas ações)
# =============================================================================

function Npm {
  param([string]$Comando)
  & cmd /c ("npm run " + $Comando)
}

function Testar-Docker {
  & cmd /c "docker info >nul 2>nul"
  return ($LASTEXITCODE -eq 0)
}

function Testar-Supabase {
  try {
    $resposta = Invoke-WebRequest -Uri 'http://localhost:54321/auth/v1/health' -TimeoutSec 4 -UseBasicParsing
    return ($resposta.StatusCode -eq 200)
  } catch { return $false }
}

function Testar-Painel {
  try {
    $resposta = Invoke-WebRequest -Uri 'http://localhost:5500/' -Method Head -TimeoutSec 4 -UseBasicParsing
    return ($resposta.StatusCode -eq 200)
  } catch { return $false }
}

function Pegar-IP {
  $padraoVirtual = 'Tailscale|ZeroTier|WSL|Hyper|Docker|vEthernet|Loopback|Bluetooth|Virtual|VMware|TAP|TUN|VPN|WireGuard'
  $padraoIgnorado = '^(127\.|169\.254\.|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)'
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch $padraoIgnorado -and $_.InterfaceAlias -notmatch $padraoVirtual } |
    Sort-Object @{ Expression = {
      if ($_.IPAddress -eq '192.168.137.1') { 0 }
      elseif ($_.InterfaceAlias -match 'Wi-?Fi|WLAN|Ethernet') { 1 }
      else { 2 }
    } } |
    Select-Object -First 1 -ExpandProperty IPAddress
  return $ip
}

function Ler-EnvLocal {
  $valores = @{}
  $caminho = Join-Path $script:Projeto '.env.local'
  if (-not (Test-Path $caminho)) { return $valores }
  foreach ($linha in (Get-Content $caminho -ErrorAction SilentlyContinue)) {
    if ($linha -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $valor = $Matches[2].Trim()
      if (($valor.StartsWith('"') -and $valor.EndsWith('"')) -or ($valor.StartsWith("'") -and $valor.EndsWith("'"))) {
        $valor = $valor.Substring(1, $valor.Length - 2)
      }
      $valores[$Matches[1]] = $valor
    }
  }
  return $valores
}

function Pegar-ModoHotspot {
  $modo = (Ler-EnvLocal)['LAB_HOTSPOT_MODO']
  if ($modo -notin @('auto', 'sempre', 'nunca')) { return 'auto' }
  return $modo
}

function Hotspot-Ligado {
  return [bool](Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -eq '192.168.137.1' } | Select-Object -First 1)
}

function Iniciar-Hotspot {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:Projeto 'lab-hotspot.ps1') -Acao ligar
  Start-Sleep -Seconds 1
  return (Hotspot-Ligado)
}

function Parar-Hotspot {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $script:Projeto 'lab-hotspot.ps1') -Acao desligar
  Start-Sleep -Seconds 1
  return -not (Hotspot-Ligado)
}

function Iniciar-Painel {
  if (Testar-Painel) { return $true }
  Start-Process -FilePath 'cmd.exe' -ArgumentList ("/k cd /d `"$script:Projeto`" && title Painel NFC (nao fechar) && npm run lab:dev")
  for ($espera = 1; $espera -le 15; $espera++) {
    Start-Sleep -Seconds 1
    if (Testar-Painel) { return $true }
    Write-Host ("    subindo o painel... ({0})" -f $espera) -ForegroundColor DarkGray
  }
  return $false
}

function Parar-Painel {
  $null = & cmd /c 'taskkill /FI "WINDOWTITLE eq Painel NFC*" /T /F >nul 2>&1'
  # Garante o encerramento do node que segura a porta 5500, mesmo que a janela
  # do cmd tenha ficado sem título ou o filho tenha sido reparentado.
  try {
    $conexoes = Get-NetTCPConnection -LocalPort 5500 -State Listen -ErrorAction SilentlyContinue
    foreach ($conexao in $conexoes) {
      Stop-Process -Id $conexao.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  } catch { }

  for ($tentativa = 1; $tentativa -le 10; $tentativa++) {
    Start-Sleep -Milliseconds 200
    if (-not (Testar-Painel)) { return $true }
  }
  return $false
}

function Reiniciar-Painel {
  if (-not (Testar-Painel)) { return $false }
  $null = Parar-Painel
  Start-Sleep -Milliseconds 300
  return (Iniciar-Painel)
}

function Escrever-Positivo { param([string]$Texto) Write-Host ("  [OK]  " + $Texto) -ForegroundColor Green }
function Escrever-Negativo { param([string]$Texto) Write-Host ("  [XX]  " + $Texto) -ForegroundColor Red }

# =============================================================================
# Estado ao vivo (processo de fundo → arquivo JSON → leitura barata)
# =============================================================================

$script:CaminhoEstado = Join-Path $env:TEMP ("lab-nfc-estado-{0}.json" -f $PID)
$script:EstadoProc = $null
$script:EstadoAtual = $null
$script:UltimoEstadoTexto = ''

function Iniciar-Estado {
  Remove-Item $script:CaminhoEstado -ErrorAction SilentlyContinue
  $script:UltimoEstadoTexto = ''
  $script:EstadoAtual = $null
  $script:UltimasLuzes = ''
  $argumentos = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Projeto "{1}" -Caminho "{2}" -PidPai {3}' -f `
    (Join-Path $script:Projeto 'lab-estado.ps1'), $script:Projeto, $script:CaminhoEstado, $PID
  $script:EstadoProc = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList $argumentos
}

function Parar-Estado {
  if ($script:EstadoProc -and -not $script:EstadoProc.HasExited) {
    try { Stop-Process -Id $script:EstadoProc.Id -Force -ErrorAction SilentlyContinue } catch { }
  }
  $script:EstadoProc = $null
  $script:UltimoEstadoTexto = ''
  $script:EstadoAtual = $null
  $script:UltimasLuzes = ''
  Remove-Item $script:CaminhoEstado -ErrorAction SilentlyContinue
}

function Ler-Estado {
  try {
    $texto = [System.IO.File]::ReadAllText($script:CaminhoEstado, [System.Text.Encoding]::UTF8)
    if ($texto -eq $script:UltimoEstadoTexto) { return $script:EstadoAtual }
    $script:UltimoEstadoTexto = $texto
    $script:EstadoAtual = $texto | ConvertFrom-Json
    return $script:EstadoAtual
  } catch { return $null }
}

# =============================================================================
# Ações
# =============================================================================

function Iniciar-Laboratorio {
  Write-Host ''
  Write-Host '  1) Docker Desktop' -ForegroundColor White
  if (-not (Esperar-Docker)) { return }

  Write-Host '  2) Rede local (hotspot NFC-Lab / Wi-Fi)' -ForegroundColor White
  $modo = Pegar-ModoHotspot
  Write-Host ("  modo do hotspot: {0}" -f $modo) -ForegroundColor DarkGray
  $ip = Pegar-IP
  $hotspotAtivo = Hotspot-Ligado

  if ($hotspotAtivo) {
    Escrever-Positivo 'hotspot NFC-Lab já está ligado.'
    $ip = Pegar-IP
  } elseif ($modo -eq 'sempre' -or ($modo -eq 'auto' -and -not $ip)) {
    Write-Host '  Criando o hotspot NFC-Lab (sem internet)...' -ForegroundColor Yellow
    try {
      if (Iniciar-Hotspot) { Escrever-Positivo 'hotspot ligado.' }
      else { Escrever-Negativo 'o hotspot não subiu; confira o Wi-Fi do notebook.' }
    } catch {
      Escrever-Negativo ('não foi possível criar o hotspot: ' + $_.Exception.Message)
    }
    $ip = Pegar-IP
  } elseif ($ip) {
    Escrever-Positivo ('Wi-Fi/cabo encontrado: {0}' -f $ip)
  } else {
    Escrever-Negativo 'nenhuma rede encontrada. Use LAB_HOTSPOT_MODO=sempre ou lab-hotspot.cmd.'
  }

  if ($ip) {
    if ($ip -eq '192.168.137.1') { Escrever-Positivo ('IP do hotspot: {0}' -f $ip) }
    else { Escrever-Positivo ('IP da rede: {0}' -f $ip) }
  }

  Write-Host '  3) Banco de dados (Supabase local, dentro do Docker)' -ForegroundColor White
  if (Testar-Supabase) {
    Escrever-Positivo 'o banco já está no ar.'
  } else {
    Write-Host '  Subindo o banco (demora 1-2 min; na primeira vez baixa as peças)...' -ForegroundColor Yellow
    Write-Host '  Um trecho JSON com "Error" no meio é só a espera do container: ignore se o [OK] vier depois.' -ForegroundColor DarkGray
    Npm 'lab:start'
    $ligou = $false
    for ($espera = 1; $espera -le 6; $espera++) {
      if (Testar-Supabase) { $ligou = $true; break }
      Start-Sleep -Seconds 5
    }
    if ($ligou) { Escrever-Positivo 'banco ligado.' }
    else { Escrever-Negativo 'o banco não respondeu. Use a opção Checar para ver o detalhe.' }
  }

  if ($ip -eq '192.168.137.1' -and -not (Hotspot-Ligado)) {
    Write-Host '  O hotspot desligou durante a subida; religando...' -ForegroundColor Yellow
    if (Iniciar-Hotspot) { $ip = Pegar-IP }
  }

  if ($ip) {
    Write-Host '  Atualizando o .env.local com o IP atual...' -ForegroundColor DarkGray
    & node (Join-Path $script:Projeto 'scripts\lab-setup.mjs')
  } else {
    Write-Host '  Aviso: sem IP de rede; o .env.local não foi atualizado.' -ForegroundColor Yellow
  }

  Write-Host '  4) Painel (site do laboratório)' -ForegroundColor White
  if (Testar-Painel) {
    Escrever-Positivo 'o painel já está no ar (janela "Painel NFC").'
  } else {
    Write-Host '  Abrindo a janela "Painel NFC"...' -ForegroundColor DarkGray
    if (Iniciar-Painel) { Escrever-Positivo 'painel ligado. NÃO feche a janela "Painel NFC".' }
    else { Escrever-Negativo 'o painel demorou; olhe a janela "Painel NFC" para ver o que aconteceu.' }
  }

  Write-Host ''
  if ($ip) { Write-Host ("  PRONTO. No tablet: http://{0}:5500   (no computador: http://localhost:5500)" -f $ip) -ForegroundColor Green }
  else { Write-Host '  PRONTO. Sem IP de rede visível: confira o Wi-Fi/cabo ou rode lab-hotspot.cmd.' -ForegroundColor Yellow }
}

function Parar-Laboratorio {
  Write-Host ''
  Write-Host '  1) Fechando a janela do painel...' -ForegroundColor White
  if (Parar-Painel) { Escrever-Positivo 'painel fora do ar.' }
  else { Write-Host '  ainda há um painel no ar de outra janela: feche-a com Ctrl+C.' -ForegroundColor Yellow }

  Write-Host '  2) Guardando o banco de dados...' -ForegroundColor White
  if (-not (Testar-Supabase)) { Write-Host '  o banco já estava parado.' -ForegroundColor DarkGray }
  else { Npm 'lab:stop'; Escrever-Positivo 'banco guardado nos caixotes do Docker. Nada foi apagado.' }

  Write-Host '  3) Hotspot do laboratório...' -ForegroundColor White
  if (-not (Hotspot-Ligado)) {
    Write-Host '  o hotspot já estava desligado.' -ForegroundColor DarkGray
  } else {
    if (Parar-Hotspot) { Escrever-Positivo 'hotspot desligado; o Wi-Fi normal continua como estava.' }
    else { Escrever-Negativo 'não foi possível desligar o hotspot.' }
  }

  # Se o hotspot saiu e existe outra rede, volta o .env.local para o IP dela.
  $padraoVirtual = 'Tailscale|ZeroTier|WSL|Hyper|Docker|vEthernet|Loopback|Bluetooth|Virtual|VMware|TAP|TUN|VPN|WireGuard'
  $outraRede = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -ne '192.168.137.1' -and
      $_.IPAddress -notmatch '^(127\.|169\.254\.|100\.)' -and
      $_.InterfaceAlias -notmatch $padraoVirtual
    } | Select-Object -First 1
  if ($outraRede) {
    & node (Join-Path $script:Projeto 'scripts\lab-setup.mjs') | Out-Null
    Write-Host '  .env.local voltou para o IP do Wi-Fi/cabo.' -ForegroundColor DarkGray
  }
}

function Alternar-Hotspot {
  Write-Host ''
  if (Hotspot-Ligado) {
    $padraoVirtual = 'Tailscale|ZeroTier|WSL|Hyper|Docker|vEthernet|Loopback|Bluetooth|Virtual|VMware|TAP|TUN|VPN|WireGuard'
    $outraRede = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -ne '192.168.137.1' -and
        $_.IPAddress -notmatch '^(127\.|169\.254\.|100\.)' -and
        $_.InterfaceAlias -notmatch $padraoVirtual
      } | Select-Object -First 1

    if (-not $outraRede) {
      Write-Host '  ATENÇÃO: não há Wi-Fi/cabo conectado. Desligar o hotspot deixará o laboratório sem rede.' -ForegroundColor Yellow
    }
    $resposta = Read-Host '  Desligar o hotspot NFC-Lab? O tablet perde a rede. (S/N)'
    if ($resposta -notmatch '^[sS]') { Write-Host '  Cancelado. Nada mudou.' -ForegroundColor Yellow; return }

    Write-Host '  Desligando o hotspot...' -ForegroundColor Yellow
    if (-not (Parar-Hotspot)) { Escrever-Negativo 'não foi possível desligar o hotspot.'; return }
    Escrever-Positivo 'hotspot desligado.'

    Write-Host '  Atualizando o .env.local para o IP do Wi-Fi/cabo...' -ForegroundColor DarkGray
    if ($outraRede) { & node (Join-Path $script:Projeto 'scripts\lab-setup.mjs') }
    else { Write-Host '  Sem outra rede: o .env.local ficou como estava.' -ForegroundColor Yellow }

    if (Testar-Painel) {
      Write-Host '  Reiniciando o painel para usar o novo IP...' -ForegroundColor DarkGray
      if (Reiniciar-Painel) { Escrever-Positivo 'painel reiniciado.' }
      else { Escrever-Negativo 'reinicie o painel manualmente (feche a janela e use Ligar tudo).' }
    }
    return
  }

  Write-Host '  Ligando o hotspot NFC-Lab...' -ForegroundColor Yellow
  if (-not (Iniciar-Hotspot)) { Escrever-Negativo 'o hotspot não subiu; confira o Wi-Fi do notebook.'; return }
  Escrever-Positivo 'hotspot ligado.'

  Write-Host '  Atualizando o .env.local para 192.168.137.1...' -ForegroundColor DarkGray
  & node (Join-Path $script:Projeto 'scripts\lab-setup.mjs')

  if (Testar-Painel) {
    Write-Host '  Reiniciando o painel para usar o hotspot...' -ForegroundColor DarkGray
    if (Reiniciar-Painel) { Escrever-Positivo 'painel reiniciado; no tablet use http://192.168.137.1:5500.' }
    else { Escrever-Negativo 'reinicie o painel manualmente (feche a janela e use Ligar tudo).' }
  } else {
    Write-Host '  O painel não está aberto. Use "Ligar tudo" para subir com o hotspot.' -ForegroundColor DarkGray
  }
}

function Checar-Laboratorio {
  Npm 'lab:check'
}

function Abrir-PainelNoNavegador {
  if (-not (Testar-Painel)) {
    Write-Host '  O painel não está no ar. Use "Ligar tudo" primeiro.' -ForegroundColor Yellow
    return
  }
  $ip = Pegar-IP
  $endereco = if ($ip) { "http://$ip`:5500" } else { 'http://localhost:5500' }
  Start-Process $endereco
  Write-Host ("  Abrindo o navegador no painel (" + $endereco + ")...") -ForegroundColor Green
}

function Ver-Enderecos {
  Npm 'lab:ip'
}

function Configurar-Laboratorio {
  param([switch]$Perguntar)
  Write-Host ''
  if ($Perguntar -and -not (Testar-Supabase)) {
    $resposta = Read-Host '  A pilha está desligada. Subir agora para buscar as chaves? (S/N)'
    if ($resposta -match '^[sS]') { Npm 'lab:start' }
    else { Write-Host '  Vou ajustar só o IP; as chaves ficam para depois.' -ForegroundColor Yellow }
  }
  & node (Join-Path $script:Projeto 'scripts\lab-setup.mjs')
}

function Liberar-Firewall {
  Write-Host ''
  Write-Host '  Vai abrir uma janela pedindo permissão de administrador: clique em "Sim".' -ForegroundColor Yellow
  Start-Process -FilePath 'cmd.exe' -ArgumentList ("/c `"$script:Projeto\lab-firewall-liberar.cmd`"")
  Write-Host '  Libera 80/5500/54321/54323 só para a sub-rede do notebook,' -ForegroundColor DarkGray
  Write-Host '  mesmo que o Windows classifique o Wi-Fi ou o hotspot como "Pública".' -ForegroundColor DarkGray
}

function Fazer-Backup {
  Npm 'lab:backup'
  Write-Host ''
  Write-Host '  O arquivo ficou em supabase\backup.sql (dentro da pasta do projeto).' -ForegroundColor Green
  Write-Host '  Lembrando: o backup NÃO inclui usuários do login nem fotos; eles se recriam' -ForegroundColor DarkGray
  Write-Host '  com a opção de admin e novo envio de fotos pelo painel.' -ForegroundColor DarkGray
}

function Zerar-Laboratorio {
  Write-Host ''
  Write-Host '  ATENÇÃO: isto APAGA tudo o que foi cadastrado (alunos, fotos, histórico)' -ForegroundColor Red
  Write-Host '  e volta os dados de demonstração (6 alunos). A placa não é tocada.' -ForegroundColor Red
  $resposta = Read-Host '  Digite ZERAR para continuar (qualquer outra coisa cancela)'
  if ($resposta -ne 'ZERAR') { Write-Host '  Cancelado. Nada mudou.' -ForegroundColor Yellow; return }
  Npm 'lab:reset'
  Npm 'lab:admin'
  Escrever-Positivo 'banco recriado com os dados de exemplo e administrador garantido.'
  Write-Host '  No navegador, aperte F5 no painel e entre com o admin de novo.' -ForegroundColor Yellow
}

function Esperar-Docker {
  if (Testar-Docker) { Escrever-Positivo 'Docker Desktop já está ligado.'; return $true }
  $caminhoDocker = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
  if (Test-Path $caminhoDocker) {
    Write-Host '  Abrindo o Docker Desktop e esperando o motor ligar...' -ForegroundColor Yellow
    Start-Process -FilePath $caminhoDocker | Out-Null
    for ($tentativa = 1; $tentativa -le 45; $tentativa++) {
      Start-Sleep -Seconds 2
      if (Testar-Docker) { Escrever-Positivo 'Docker Desktop ligou.'; return $true }
      Write-Host ("    ainda abrindo o Docker... ({0})" -f $tentativa) -ForegroundColor DarkGray
    }
  }
  Escrever-Negativo 'Docker Desktop ficou lento. Abra-o pelo menu Iniciar e espere o status do motor mudar.'
  return $false
}

# =============================================================================
# Desenho (API direta do console: rápido e sem rolagem)
# =============================================================================

$script:Opcoes = @(
  @{ Texto = 'Ligar tudo (dia na escola)';            Valor = 'ligar' }
  @{ Texto = 'Desligar tudo (fim do dia)';            Valor = 'desligar' }
  @{ Texto = 'Checar a saúde do laboratório';         Valor = 'checar' }
  @{ Texto = 'Abrir o painel no navegador';           Valor = 'abrir' }
  @{ Texto = 'Ver os endereços para o tablet';        Valor = 'enderecos' }
  @{ Texto = 'Hotspot NFC-Lab: ligar/desligar';       Valor = 'hotspot' }
  @{ Texto = 'Liberar o firewall da rede da escola';  Valor = 'firewall' }
  @{ Texto = 'Fazer backup dos dados';                Valor = 'backup' }
  @{ Texto = 'Recomeçar do zero (APAGA cadastros!)';  Valor = 'zerar' }
  @{ Texto = 'Configurar este notebook (IP + chaves)'; Valor = 'configurar' }
  @{ Texto = 'Sair (deixa tudo como está)';           Valor = 'sair' }
)

$script:Mensagens = New-Object System.Collections.Generic.List[string]
$script:Largura = 70
$script:LinhaLuzes = 3
$script:LinhaMenu = 5
$script:LinhaLog = 18
$script:LogMax = 5
$script:UltimasLuzes = ''

function Pintar {
  param(
    [int]$X, [int]$Y, [string]$Texto,
    [ConsoleColor]$Cor = [ConsoleColor]::Gray,
    [ConsoleColor]$Fundo = [ConsoleColor]::Black
  )
  try { [Console]::SetCursorPosition($X, $Y) } catch { return }
  $corAntiga = [Console]::ForegroundColor
  $fundoAntigo = [Console]::BackgroundColor
  try {
    [Console]::ForegroundColor = $Cor
    [Console]::BackgroundColor = $Fundo
    [Console]::Write($Texto)
  } finally {
    [Console]::ForegroundColor = $corAntiga
    [Console]::BackgroundColor = $fundoAntigo
  }
}

function Desenhar-Luzes {
  $estado = Ler-Estado
  $celulas = @()
  if ($null -eq $estado) {
    $celulas += , @('Docker: ...', [ConsoleColor]::DarkGray)
    $celulas += , @('Banco: ...', [ConsoleColor]::DarkGray)
    $celulas += , @('Painel: ...', [ConsoleColor]::DarkGray)
    $celulas += , @('Placa: ...', [ConsoleColor]::DarkGray)
    $celulas += , @('Hotspot: ...', [ConsoleColor]::DarkGray)
  } else {
    if ($estado.docker) { $celulas += , @('Docker: ok', [ConsoleColor]::Green) } else { $celulas += , @('Docker: off', [ConsoleColor]::Red) }
    if ($estado.banco)  { $celulas += , @('Banco: ok',  [ConsoleColor]::Green) } else { $celulas += , @('Banco: off',  [ConsoleColor]::Red) }
    if ($estado.painel) { $celulas += , @('Painel: ok', [ConsoleColor]::Green) } else { $celulas += , @('Painel: off', [ConsoleColor]::Red) }
    if ($estado.placa -eq 2)     { $celulas += , @('Placa: ok',    [ConsoleColor]::Green) }
    elseif ($estado.placa -eq 1) { $celulas += , @('Placa: leitor', [ConsoleColor]::Yellow) }
    else                         { $celulas += , @('Placa: off',   [ConsoleColor]::Red) }
    if ($estado.hotspot) { $celulas += , @('Hotspot: ok', [ConsoleColor]::Green) }
    else                 { $celulas += , @('Hotspot: off', [ConsoleColor]::DarkGray) }
  }

  # Só redesenha quando o texto das luzes muda (evita writes desnecessários).
  $assinatura = (($celulas | ForEach-Object { $_[0] }) -join '|')
  if ($assinatura -eq $script:UltimasLuzes) { return }
  $script:UltimasLuzes = $assinatura

  $x = 3
  foreach ($celula in $celulas) {
    Pintar $x $script:LinhaLuzes ($celula[0].PadRight(13)) $celula[1]
    $x += 13
  }
}

function Desenhar-MenuItem {
  param([int]$Indice, [bool]$Selecionado)
  $rotulo = $script:Opcoes[$Indice].Texto
  if ($script:Opcoes[$Indice].Valor -ne 'sair') {
    $rotulo = ('{0}) {1}' -f ($Indice + 1), $rotulo)
  }
  $texto = $rotulo.PadRight($script:Largura)
  $linha = $script:LinhaMenu + $Indice
  if ($Selecionado) {
    Pintar 3 $linha ('> ' + $texto) ([ConsoleColor]::Black) ([ConsoleColor]::Cyan)
  } else {
    Pintar 3 $linha ('  ' + $texto) ([ConsoleColor]::White)
  }
}

function Repintar-Mensagens {
  for ($i = 0; $i -lt $script:LogMax; $i++) {
    $texto = ''
    if ($i -lt $script:Mensagens.Count) { $texto = $script:Mensagens[$i] }
    if ($texto.Length -gt $script:Largura) { $texto = $texto.Substring(0, $script:Largura) }
    Pintar 4 ($script:LinhaLog + $i) $texto.PadRight($script:Largura) ([ConsoleColor]::Gray)
  }
}

function Mensagem {
  param([string]$Texto)
  while ($script:Mensagens.Count -ge $script:LogMax) { $script:Mensagens.RemoveAt(0) }
  $script:Mensagens.Add($Texto)
  Repintar-Mensagens
}

function Desenhar-Quadro {
  try { [Console]::Clear() } catch { }
  $fina = '-' * $script:Largura
  Pintar 2 0 ('=' * $script:Largura) ([ConsoleColor]::Cyan)
  Pintar 5 1 'ACESSO ESCOLAR NFC - LABORATORIO OFFLINE (sem internet)' ([ConsoleColor]::White)
  Pintar 2 2 $fina ([ConsoleColor]::Cyan)
  Pintar 2 4 $fina ([ConsoleColor]::Cyan)
  Pintar 2 16 $fina ([ConsoleColor]::Cyan)
  Pintar 4 17 'MENSAGENS:' ([ConsoleColor]::DarkCyan)
  Pintar 2 23 $fina ([ConsoleColor]::Cyan)
  Pintar 4 24 'Setas + Enter · números 1-9 · 0 sai · luzes ao vivo' ([ConsoleColor]::DarkGray)
  for ($i = 0; $i -lt $script:Opcoes.Count; $i++) { Desenhar-MenuItem -Indice $i -Selecionado $false }
  $script:UltimasLuzes = ''
  Desenhar-Luzes
  Repintar-Mensagens
  Desenhar-MenuItem -Indice 0 -Selecionado $true
}

# =============================================================================
# Teclado
# =============================================================================

function Ler-Opcao {
  param([int]$Selecionado)
  $tecla = [Console]::ReadKey($true)
  $total = $script:Opcoes.Count
  switch ($tecla.Key) {
    'UpArrow'    { return @{ Indice = (($Selecionado - 1 + $total) % $total); Escolheu = $false } }
    'DownArrow'  { return @{ Indice = (($Selecionado + 1) % $total); Escolheu = $false } }
    'Home'       { return @{ Indice = 0; Escolheu = $false } }
    'End'        { return @{ Indice = $total - 1; Escolheu = $false } }
    'Enter'      { return @{ Indice = $Selecionado; Escolheu = $true } }
    'Spacebar'   { return @{ Indice = $Selecionado; Escolheu = $true } }
    'Escape'     { return @{ Indice = $total - 1; Escolheu = $true } }
    'NumPad1'    { return @{ Indice = 0; Escolheu = $true } }
    'D1'         { return @{ Indice = 0; Escolheu = $true } }
    'NumPad2'    { return @{ Indice = 1; Escolheu = $true } }
    'D2'         { return @{ Indice = 1; Escolheu = $true } }
    'NumPad3'    { return @{ Indice = 2; Escolheu = $true } }
    'D3'         { return @{ Indice = 2; Escolheu = $true } }
    'NumPad4'    { return @{ Indice = 3; Escolheu = $true } }
    'D4'         { return @{ Indice = 3; Escolheu = $true } }
    'NumPad5'    { return @{ Indice = 4; Escolheu = $true } }
    'D5'         { return @{ Indice = 4; Escolheu = $true } }
    'NumPad6'    { return @{ Indice = 5; Escolheu = $true } }
    'D6'         { return @{ Indice = 5; Escolheu = $true } }
    'NumPad7'    { return @{ Indice = 6; Escolheu = $true } }
    'D7'         { return @{ Indice = 6; Escolheu = $true } }
    'NumPad8'    { return @{ Indice = 7; Escolheu = $true } }
    'D8'         { return @{ Indice = 7; Escolheu = $true } }
    'NumPad9'    { return @{ Indice = 8; Escolheu = $true } }
    'D9'         { return @{ Indice = 8; Escolheu = $true } }
    'NumPad0'    { return @{ Indice = $total - 1; Escolheu = $true } }
    'D0'         { return @{ Indice = $total - 1; Escolheu = $true } }
  }
  return @{ Indice = $Selecionado; Escolheu = $false }
}

# =============================================================================
# Laço principal
# =============================================================================

function Rodar-TUI {
  $selecionado = 0
  Desenhar-Quadro
  Mensagem 'Bem-vindo! Verde = no ar. Setas/Enter, 1-9; 0 ou ESC sai.'
  try { Iniciar-Estado } catch { }
  $relogioLuzes = [System.Diagnostics.Stopwatch]::StartNew()

  while ($true) {
    if ([Console]::KeyAvailable) {
      $resposta = Ler-Opcao -Selecionado $selecionado
      $novo = $resposta.Indice
      if ($novo -ne $selecionado) {
        Desenhar-MenuItem -Indice $selecionado -Selecionado $false
        Desenhar-MenuItem -Indice $novo -Selecionado $true
        $selecionado = $novo
      }
      if ($resposta.Escolheu) {
        $escolhido = $script:Opcoes[$selecionado].Valor
        if ($escolhido -eq 'sair') {
          Parar-Estado
          try { [Console]::Clear() } catch { }
          try { [Console]::CursorVisible = $true } catch { }
          return
        }
        try { [Console]::CursorVisible = $true } catch { }
        try { [Console]::Clear() } catch { }
        switch ($escolhido) {
          'ligar'     { Iniciar-Laboratorio;      Mensagem 'Ligar: subida concluída (veja [OK]/[XX] acima).' }
          'desligar'  { Parar-Laboratorio;        Mensagem 'Desligar: painel fechado, banco guardado e hotspot desligado.' }
          'checar'    { Checar-Laboratorio;       Mensagem 'Checar: diagnóstico concluído; [OK] verde significa tudo bem.' }
          'abrir'     { Abrir-PainelNoNavegador;  Mensagem 'Abrir: navegador enviado ao painel.' }
          'enderecos' { Ver-Enderecos;            Mensagem 'Endereços: mostrados acima (digite no tablet).' }
          'hotspot'   { Alternar-Hotspot;         Mensagem 'Hotspot: ação concluída (veja o resumo acima).' }
          'configurar' { Configurar-Laboratorio -Perguntar; Mensagem 'Configurar: IP e chaves atualizados no .env.local (veja o resumo acima).' }
          'firewall'  { Liberar-Firewall;         Mensagem 'Firewall: confirme com "Sim" na janela do Windows.' }
          'backup'    { Fazer-Backup;             Mensagem 'Backup: salvo em supabase\backup.sql.' }
          'zerar'     { Zerar-Laboratorio;        Mensagem 'Zerar: banco refeito com os 6 alunos de demonstração.' }
        }
        Write-Host ''
        $null = Read-Host 'Aperte Enter para voltar'
        try { [Console]::CursorVisible = $false } catch { }
        Desenhar-Quadro
        $selecionado = 0
        $relogioLuzes.Restart()
      }
    } else {
      Start-Sleep -Milliseconds 25
      if ($relogioLuzes.ElapsedMilliseconds -ge 800) {
        Desenhar-Luzes
        $relogioLuzes.Restart()
      }
    }
  }
}

# =============================================================================
# Entrada
# =============================================================================

try {
  if ($Acao -ne '') {
    switch ($Acao.ToLower()) {
      'ligar'     { Iniciar-Laboratorio }
      'desligar'  { Parar-Laboratorio }
      'checar'    { Checar-Laboratorio }
      'enderecos' { Ver-Enderecos }
      'hotspot'   { Alternar-Hotspot }
      'configurar' { Configurar-Laboratorio }
      'backup'    { Fazer-Backup }
      'zerar'     { Zerar-Laboratorio }
      default     { Write-Host ("Ação desconhecida: " + $Acao) -ForegroundColor Red }
    }
    Write-Host ''
    $global:LASTEXITCODE = 0
    if (-not $SemPausa) { $null = Read-Host 'Aperte Enter para fechar esta janela' }
    exit 0
  } else {
    Rodar-TUI
  }
} catch {
  Write-Host ''
  Write-Host ('  Deu problema: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host '  Feche esta janela e tente de novo. Se persistir, rode no terminal: npm run lab:check' -ForegroundColor Yellow
  if (-not $SemPausa) { $null = Read-Host 'Aperte Enter para fechar esta janela' }
} finally {
  try { [Console]::CursorVisible = $true } catch { }
  try { Parar-Estado } catch { }
}
