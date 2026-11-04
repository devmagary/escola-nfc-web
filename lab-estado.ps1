# =============================================================================
# lab-estado.ps1 — processo de fundo que mede a saúde do laboratório
# ---------------------------------------------------------------------------
# Chamado pela TUI (lab-menu.ps1). Escreve um JSON pequeno a cada 2 segundos.
# Encerra sozinho quando o processo pai (a janela da TUI) desaparece.
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

while ($true) {
  if (-not (Get-Process -Id $PidPai -ErrorAction SilentlyContinue)) { break }

  & cmd /c "docker info >nul 2>nul" 2>$null | Out-Null
  $docker = ($LASTEXITCODE -eq 0)

  $banco = $false
  try {
    $r = Invoke-WebRequest 'http://localhost:54321/auth/v1/health' -TimeoutSec 3 -UseBasicParsing
    $banco = ($r.StatusCode -eq 200)
  } catch { }

  $painel = $false
  try {
    $r = Invoke-WebRequest 'http://localhost:5500/' -Method Head -TimeoutSec 3 -UseBasicParsing
    $painel = ($r.StatusCode -eq 200)
  } catch { }

  $placa = 0
  try {
    $r = Invoke-WebRequest ($urlPlaca.TrimEnd('/') + '/api/ultimo') -TimeoutSec 3 -UseBasicParsing
    if ($r.Content -match '"nfc_ok"\s*:\s*true') { $placa = 2 } else { $placa = 1 }
  } catch { $placa = 0 }

  $json = @{ docker = $docker; banco = $banco; painel = $painel; placa = $placa; em = (Get-Date).ToString('o') } |
    ConvertTo-Json -Compress
  try { [System.IO.File]::WriteAllText($Caminho, $json, [System.Text.Encoding]::UTF8) } catch { }

  Start-Sleep -Seconds 2
}
