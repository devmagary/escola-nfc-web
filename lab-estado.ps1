# =============================================================================
# lab-estado.ps1 — processo de fundo que mede a saúde do laboratório
# ---------------------------------------------------------------------------
# Chamado pela TUI (lab-menu.ps1). Escreve um JSON pequeno a cada 2 segundos.
# Encerra sozinho quando o processo pai (a janela da TUI) desaparece.
#
# Otimizações:
#   - Docker: testa o named pipe (sem iniciar `docker info` a cada ciclo);
#   - Banco/Painel: conexão TCP rápida (sem criar requisição HTTP);
#   - Placa: HTTP a cada 10 s (não a cada 2 s);
#   - Hotspot: consulta o IP a cada 5 s.
#
# Uso interno:
#   powershell -File lab-estado.ps1 -Projeto <pasta> -Caminho <json> -PidPai <pid>
# =============================================================================
param(
  [Parameter(Mandatory = $true)][string]$Projeto,
  [Parameter(Mandatory = $true)][string]$Caminho,
  [Parameter(Mandatory = $true)][int]$PidPai
)

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Set-Location $Projeto

$urlPlaca = 'http://192.168.0.73'
try {
  $linha = Get-Content (Join-Path $Projeto '.env.local') -ErrorAction SilentlyContinue |
    Where-Object { $_ -match '^ESP_URL\s*=' } | Select-Object -First 1
  if ($linha) { $urlPlaca = (($linha -split '=', 2)[1]).Trim() }
} catch { }

function Testar-Tcp {
  param([int]$Porta, [int]$TimeoutMs = 250)
  $cliente = New-Object System.Net.Sockets.TcpClient
  try {
    $conexao = $cliente.BeginConnect('127.0.0.1', $Porta, $null, $null)
    if ($conexao.AsyncWaitHandle.WaitOne($TimeoutMs)) {
      $cliente.EndConnect($conexao)
      return $true
    }
    return $false
  } catch { return $false } finally {
    try { $cliente.Close() } catch { }
  }
}

function Testar-DockerRapido {
  # O pipe do Docker Desktop existe enquanto o motor está rodando; é muito mais
  # barato que executar `docker info` a cada 2 segundos.
  try { if (Test-Path '\\.\pipe\docker_engine') { return $true } } catch { }
  return [bool](Get-Process -Name 'com.docker.backend' -ErrorAction SilentlyContinue)
}

function Testar-Placa {
  try {
    $uri = [Uri]$urlPlaca
    if ($uri.Host -match '\.local$') {
      $dns = Resolve-DnsName -Name $uri.Host -Type A -QuickTimeout -ErrorAction SilentlyContinue
      if (-not $dns) { return 0 }
    }
    $resposta = Invoke-WebRequest ($urlPlaca.TrimEnd('/') + '/api/ultimo') -TimeoutSec 1 -UseBasicParsing
    if ($resposta.Content -match '"nfc_ok"\s*:\s*true') { return 2 }
    return 1
  } catch { return 0 }
}

function Testar-Hotspot {
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -eq '192.168.137.1' } | Select-Object -First 1
  return [bool]$ip
}

function Gravar-Estado {
  param([bool]$Docker, [bool]$Banco, [bool]$Painel, [int]$Placa, [bool]$Hotspot)
  $json = @{
    docker  = $Docker
    banco   = $Banco
    painel  = $Painel
    placa   = $Placa
    hotspot = $Hotspot
    em      = (Get-Date).ToString('o')
  } | ConvertTo-Json -Compress
  [System.IO.File]::WriteAllText($Caminho, $json, [System.Text.Encoding]::UTF8)
}

$docker = $false
$placa = 0
$hotspot = $false
$ultimoDocker = [DateTime]::MinValue
$ultimaPlaca = [DateTime]::MinValue
$ultimoHotspot = [DateTime]::MinValue

while ($true) {
  if (-not (Get-Process -Id $PidPai -ErrorAction SilentlyContinue)) { break }

  try {
    $agora = [DateTime]::UtcNow
    if (($agora - $ultimoDocker).TotalSeconds -ge 5) {
      $docker = Testar-DockerRapido
      $ultimoDocker = $agora
    }
    if (($agora - $ultimoHotspot).TotalSeconds -ge 5) {
      $hotspot = Testar-Hotspot
      $ultimoHotspot = $agora
    }

    # Grava primeiro o que é rápido; a placa (HTTP) pode demorar e fica para
    # depois, sem atrasar as luzes de Docker/Banco/Painel/Hotspot.
    Gravar-Estado -Docker $docker -Banco (Testar-Tcp 54321) -Painel (Testar-Tcp 5500) `
      -Placa $placa -Hotspot $hotspot

    if (($agora - $ultimaPlaca).TotalSeconds -ge 10) {
      $placa = Testar-Placa
      $ultimaPlaca = $agora
    }
  } catch { }

  Start-Sleep -Seconds 2
}
