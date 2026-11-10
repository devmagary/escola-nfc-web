<#
=============================================================================
 lab-hotspot.ps1 — cria a rede Wi-Fi do laboratório sem internet
-----------------------------------------------------------------------------
 O Windows exige uma conexão de origem para ligar o Hotspot pela tela.
 Este script contorna isso usando a API de tethering diretamente: usa um
 adaptador virtual (WSL/Hyper-V/ZeroTier/Tailscale) como "origem" e o Wi-Fi
 como ponto de acesso. Resultado: uma rede local pura, sem depender de
 internet ou de outro Wi-Fi.

 Uso:
   powershell -ExecutionPolicy Bypass -File lab-hotspot.ps1 ligar
   powershell -ExecutionPolicy Bypass -File lab-hotspot.ps1 desligar
   powershell -ExecutionPolicy Bypass -File lab-hotspot.ps1 status

 Também é chamado por lab-hotspot.cmd (duplo clique = ligar) e pela TUI
 (lab-menu.ps1 -> item "Hotspot NFC-Lab").

 Configuração no .env.local (opcional):
   HOTSPOT_SSID=NFC-Lab
   HOTSPOT_PASSWORD=nfc-lab-2026
=============================================================================
#>
param(
  [ValidateSet('ligar', 'desligar', 'status')]
  [string]$Acao = 'ligar',
  [string]$Ssid = '',
  [string]$Senha = ''
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$Projeto = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Projeto

function Ler-EnvLocal {
  $valores = @{}
  $caminho = Join-Path $Projeto '.env.local'
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

$envLocal = Ler-EnvLocal
if (-not $Ssid) { $Ssid = if ($envLocal['HOTSPOT_SSID']) { $envLocal['HOTSPOT_SSID'] } else { 'NFC-Lab' } }
if (-not $Senha) { $Senha = if ($envLocal['HOTSPOT_PASSWORD']) { $envLocal['HOTSPOT_PASSWORD'] } else { 'nfc-lab-2026' } }

if ($Ssid.Length -lt 1 -or $Ssid.Length -gt 32) {
  throw 'O nome da rede (HOTSPOT_SSID) precisa ter de 1 a 32 caracteres.'
}
if ($Senha.Length -lt 8 -or $Senha.Length -gt 63) {
  throw 'A senha do hotspot (HOTSPOT_PASSWORD) precisa ter de 8 a 63 caracteres.'
}

# ── WinRT (tethering) ────────────────────────────────────────────────────────
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

function AwaitAction($WinRtAction) {
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethod
  })[0]
  $netTask = $asTask.Invoke($null, @($WinRtAction))
  $netTask.Wait(-1) | Out-Null
}

$ni = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
$tm = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType = WindowsRuntime]

function Obter-Gerenciador {
  $perfis = $ni::GetConnectionProfiles()
  $perfilWifi = $perfis | Where-Object { $_.IsWlanConnectionProfile } | Select-Object -First 1
  if (-not $perfilWifi) { throw 'Nenhum adaptador Wi-Fi foi encontrado neste notebook.' }
  $adaptadorWifi = $perfilWifi.NetworkAdapter

  # A "origem" precisa ser outra interface. Preferimos as virtuais que o
  # laboratório já usa (Hyper-V/WSL) e depois ZeroTier/Tailscale.
  $preferencia = @('Default Switch', 'WSL', 'ZeroTier', 'Tailscale')
  $publicos = @($perfis | Where-Object { -not $_.IsWlanConnectionProfile -and $_.NetworkAdapter })
  $publico = $null
  foreach ($termo in $preferencia) {
    $publico = $publicos | Where-Object { $_.ProfileName -like "*$termo*" } | Select-Object -First 1
    if ($publico) { break }
  }
  if (-not $publico) { $publico = $publicos | Select-Object -First 1 }

  if ($publico) {
    try {
      return @{
        Gerenciador = $tm::CreateFromConnectionProfile($publico, $adaptadorWifi)
        Origem      = $publico.ProfileName
      }
    } catch {
      # Alguns drivers recusam a interface privada explícita; tenta o modo padrão.
      return @{
        Gerenciador = $tm::CreateFromConnectionProfile($publico)
        Origem      = $publico.ProfileName
      }
    }
  }

  # Sem interface virtual: usa o próprio Wi-Fi (funciona quando há internet).
  return @{
    Gerenciador = $tm::CreateFromConnectionProfile($perfilWifi)
    Origem      = $perfilWifi.ProfileName
  }
}

function Obter-IpHotspot {
  $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -eq '192.168.137.1' } |
    Select-Object -First 1
  if ($ip) { return $ip.IPAddress }

  $alternativo = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.InterfaceAlias -match 'Conexão Local|Local Area Connection' -and
      $_.IPAddress -notmatch '^169\.254\.'
    } |
    Select-Object -First 1
  if ($alternativo) { return $alternativo.IPAddress }
  return ''
}

function Estado-Hotspot($gerenciador) {
  return [string]$gerenciador.TetheringOperationalState
}

$info = Obter-Gerenciador
$gerenciador = $info.Gerenciador
$estado = Estado-Hotspot $gerenciador

if ($Acao -eq 'status') {
  Write-Host ''
  Write-Host '  Hotspot do laboratório' -ForegroundColor Cyan
  Write-Host ('  Estado : {0}' -f $(if ($estado -eq 'On') { 'ligado' } else { 'desligado' }))
  Write-Host ('  Origem : {0}' -f $info.Origem)
  try {
    $config = $gerenciador.GetCurrentAccessPointConfiguration()
    if ($config) { Write-Host ('  Rede   : {0}' -f $config.Ssid) }
  } catch { }
  $ip = Obter-IpHotspot
  if ($ip) { Write-Host ('  IP     : {0}' -f $ip) }
  Write-Host ''
  return
}

if ($Acao -eq 'desligar') {
  if ($estado -ne 'On') {
    Write-Host '  O hotspot já está desligado.' -ForegroundColor Yellow
    return
  }
  Write-Host '  Desligando o hotspot...' -ForegroundColor Yellow
  $resultado = Await ($gerenciador.StopTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  if ([string]$resultado.Status -eq 'Success') {
    Write-Host '  Hotspot desligado. O Wi-Fi normal continua como estava.' -ForegroundColor Green
  } else {
    Write-Host ('  Não foi possível desligar: {0} {1}' -f $resultado.Status, $resultado.AdditionalErrorMessage) -ForegroundColor Red
  }
  return
}

# ── Ligar ────────────────────────────────────────────────────────────────────
if ($estado -eq 'On') {
  try {
    $atual = $gerenciador.GetCurrentAccessPointConfiguration()
    if ($atual -and $atual.Ssid) { $Ssid = $atual.Ssid }
  } catch { }
  Write-Host '  O hotspot já está ligado.' -ForegroundColor Green
} else {
  Write-Host ('  Criando a rede "{0}" (sem precisar de internet)...' -f $Ssid) -ForegroundColor Yellow
  try {
    $config = $gerenciador.GetCurrentAccessPointConfiguration()
    $config.Ssid = $Ssid
    $config.Passphrase = $Senha
    try { $config.Band = [Windows.Networking.NetworkOperators.TetheringWiFiBand]::TwoPointFourGigahertz } catch { }
    AwaitAction ($gerenciador.ConfigureAccessPointAsync($config))
  } catch {
    Write-Host ('  Aviso ao configurar nome/senha: {0}' -f $_.Exception.Message) -ForegroundColor DarkYellow
  }

  $resultado = Await ($gerenciador.StartTetheringAsync()) ([Windows.Networking.NetworkOperators.NetworkOperatorTetheringOperationResult])
  $status = [string]$resultado.Status
  if ($status -ne 'Success' -and $status -ne 'AlreadyOn') {
    throw ('O Windows recusou o hotspot: {0} {1}' -f $status, $resultado.AdditionalErrorMessage)
  }

  # Em algumas builds do Windows este método não existe; nesse caso o hotspot
  # desliga após 5 minutos sem nenhum cliente. Conecte o tablet nesse período.
  try { AwaitAction ($gerenciador.DisableNoConnectionsTimeoutAsync()) } catch { }
  Start-Sleep -Seconds 2
}

$ip = Obter-IpHotspot
Write-Host ''
Write-Host '  Hotspot do laboratório no ar.' -ForegroundColor Green
Write-Host ('  Rede  : {0}' -f $Ssid)
Write-Host ('  Senha : {0}' -f $Senha)
if ($ip) { Write-Host ('  IP do notebook : {0}' -f $ip) -ForegroundColor Cyan }
Write-Host ''
if ($ip) {
  Write-Host ('  No tablet: conecte nessa rede e abra http://{0}:5500' -f $ip) -ForegroundColor White
} else {
  Write-Host '  No tablet: conecte nessa rede e use o IP mostrado por npm run lab:ip.' -ForegroundColor White
}
Write-Host '  Dica: o Windows desliga o hotspot após 5 min sem nenhum aparelho conectado.' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Próximos passos (neste notebook):' -ForegroundColor White
Write-Host '    npm run lab:setup    (grava o IP do hotspot no .env.local)'
Write-Host '    npm run lab:dev      (painel em http://IP:5500)'
Write-Host ''
