# =============================================================================
# lab-monitor-esp.ps1 - monitor continuo do ESP32-S3, NFC e biometria
# -----------------------------------------------------------------------------
# Le ao mesmo tempo:
#   - a porta serial (COM3) para pegar reboots, panics, WDT, brownout e logs;
#   - /api/status, /api/ultimo e /api/logs por HTTP.
#
# Grava:
#   logs\esp-monitor-<data>.jsonl       -> uma amostra JSON por ciclo
#   logs\esp-monitor-<data>.serial.log  -> linhas seriais
#   logs\esp-monitor-<data>.alertas.log -> somente alertas
#
# Uso:
#   powershell -ExecutionPolicy Bypass -File lab-monitor-esp.ps1
#   powershell -ExecutionPolicy Bypass -File lab-monitor-esp.ps1 -EspUrl http://192.168.137.2 -Porta COM3
#   powershell -ExecutionPolicy Bypass -File lab-monitor-esp.ps1 -DuracaoMinutos 30
#
# Para parar: feche a janela ou rode lab-monitor-esp-stop.cmd.
# =============================================================================
param(
  [string]$EspUrl = 'http://192.168.137.2',
  [string]$Porta = 'COM3',
  [int]$IntervaloSegundos = 2,
  [int]$DuracaoMinutos = 0,
  [string]$PastaLog = '',
  [string]$Usuario = 'admin',
  [string]$Senha = 'admin123',
  [switch]$SemSerial
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

# Garante uma unica instancia: duas copias do monitor disputam a COM3 e uma
# delas fica sem serial (o sintoma classico e "acesso a porta COM3 negado").
$Mutex = New-Object System.Threading.Mutex($false, 'Global\LabMonitorEsp')
$TemMutex = $false
try { $TemMutex = $Mutex.WaitOne(0) } catch { $TemMutex = $false }
if (-not $TemMutex) {
  Write-Host ''
  Write-Host '  Ja existe um monitor do ESP32 rodando.' -ForegroundColor Yellow
  Write-Host '  Pare o anterior com lab-monitor-esp-stop.cmd antes de abrir outro.' -ForegroundColor Yellow
  Write-Host ''
  exit 1
}

$Raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $PastaLog) { $PastaLog = Join-Path $Raiz 'logs' }
New-Item -ItemType Directory -Force -Path $PastaLog | Out-Null

$Carimbo = Get-Date -Format 'yyyyMMdd-HHmmss'
$ArquivoJsonl = Join-Path $PastaLog ("esp-monitor-{0}.jsonl" -f $Carimbo)
$ArquivoAlertas = Join-Path $PastaLog ("esp-monitor-{0}.alertas.log" -f $Carimbo)
$ArquivoSerial = Join-Path $PastaLog ("esp-monitor-{0}.serial.log" -f $Carimbo)
$ArquivoPid = Join-Path $PastaLog 'monitor.pid'
$PID | Set-Content -Path $ArquivoPid -Encoding ASCII

$script:UltimoAlerta = @{}
$script:AlertasCiclo = New-Object System.Collections.Generic.List[string]
$script:SerialLinhas = New-Object System.Collections.Generic.List[string]
$script:SerialBuffer = ''

function Alerta {
  param(
    [string]$Nivel,
    [string]$Texto,
    [int]$CooldownSeg = 30
  )
  $chave = "$Nivel|$Texto"
  $agora = Get-Date
  if ($script:UltimoAlerta.ContainsKey($chave)) {
    $decorrido = ($agora - $script:UltimoAlerta[$chave]).TotalSeconds
    if ($decorrido -lt $CooldownSeg) { return }
  }
  $script:UltimoAlerta[$chave] = $agora
  $linha = "[{0}] [{1}] {2}" -f $agora.ToString('HH:mm:ss'), $Nivel, $Texto
  switch ($Nivel) {
    'CRITICO' { Write-Host $linha -ForegroundColor Red }
    'ALERTA'  { Write-Host $linha -ForegroundColor Yellow }
    'WARN'    { Write-Host $linha -ForegroundColor DarkYellow }
    'INFO'    { Write-Host $linha -ForegroundColor Cyan }
    'OK'      { Write-Host $linha -ForegroundColor Green }
    default   { Write-Host $linha }
  }
  Add-Content -Path $ArquivoAlertas -Value $linha -Encoding UTF8
  $script:AlertasCiclo.Add($linha) | Out-Null
}

function Processar-LinhaSerial {
  param([string]$Linha)
  if ([string]::IsNullOrWhiteSpace($Linha)) { return }
  Add-Content -Path $ArquivoSerial -Value ("[{0}] {1}" -f (Get-Date).ToString('HH:mm:ss.fff'), $Linha) -Encoding UTF8
  $script:SerialLinhas.Add($Linha) | Out-Null
  while ($script:SerialLinhas.Count -gt 12) { $script:SerialLinhas.RemoveAt(0) }

  if ($Linha -match 'rst:0x|Guru Meditation|abort\(\)|assert failed|CORRUPT HEAP|Stack canary|panic|watchdog|WDT|Brownout|brownout') {
    Alerta 'CRITICO' ("Serial: " + $Linha) 5
  } elseif ($Linha -match '\[ALERTA') {
    Alerta 'ALERTA' ("Serial: " + $Linha) 15
  } elseif ($Linha -match '\[BIO\].*(falhou|ausente|erro)') {
    Alerta 'WARN' ("Serial: " + $Linha) 15
  } elseif ($Linha -match '\[WIFI\].*(nao encontrado|Modo AP)') {
    Alerta 'WARN' ("Serial: " + $Linha) 30
  } elseif ($Linha -match 'BIOMETRIA NAO RECONHECIDA') {
    Alerta 'INFO' ('Biometria desconhecida lida: ' + $Linha) 5
  } elseif ($Linha -match 'BIOMETRIA LIBERADA|BIOMETRIA NEGADA|ACESSO LIBERADO|ACESSO NEGADO') {
    Alerta 'INFO' ('Evento de acesso: ' + $Linha) 2
  } elseif ($Linha -match 'Sensor Biometrico|Biometria AS608|PN532 Detectado|PON532 OK|PN532 OK') {
    Alerta 'OK' ('Hardware: ' + $Linha) 30
  }
}

# -----------------------------------------------------------------------------
# Serial
# -----------------------------------------------------------------------------
$Serial = $null
if (-not $SemSerial) {
  try {
    $Serial = New-Object System.IO.Ports.SerialPort($Porta, 115200, [System.IO.Ports.Parity]::None, 8, [System.IO.Ports.StopBits]::One)
    $Serial.ReadTimeout = 200
    $Serial.DtrEnable = $false
    $Serial.RtsEnable = $false
    $Serial.Open()
    Alerta 'OK' ("Serial {0} aberto para monitoramento." -f $Porta) 0
  } catch {
    Alerta 'WARN' ("Serial {0} indisponivel: {1}" -f $Porta, $_.Exception.Message) 0
    $Serial = $null
  }
}

$Headers = @{
  Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(($Usuario + ':' + $Senha)))
}

$Inicio = Get-Date
$UltimoStatus = $null
$UltimoEvento = $null
$UltimoSeq = -1
$UltimoUptime = -1
$UltimoIp = ''
$UltimoEngasgos = 0
$UltimoNfcReinicios = 0
$UltimoNfcReconexoes = 0
$UltimoBioOk = $null
$UltimoNfcOk = $null
$FalhasHttp = 0
$HttpJaFalhou = $false
$UltimoLogs = [DateTime]::MinValue
$UltimoLogId = 0
$UltimoResumo = [DateTime]::MinValue

Write-Host ''
Write-Host '  Monitor do ESP32-S3 / NFC / biometria' -ForegroundColor Cyan
Write-Host ("  ESP     : {0}" -f $EspUrl)
Write-Host ("  Serial  : {0}" -f $(if ($Serial) { $Porta } else { 'desligado' }))
Write-Host ("  JSONL   : {0}" -f $ArquivoJsonl)
Write-Host ("  Alertas : {0}" -f $ArquivoAlertas)
Write-Host '  Pare com lab-monitor-esp-stop.cmd ou Ctrl+C.' -ForegroundColor DarkGray
Write-Host ''

try {
  while ($true) {
    $agora = Get-Date
    if ($DuracaoMinutos -gt 0 -and ($agora - $Inicio).TotalMinutes -ge $DuracaoMinutos) { break }
    $script:AlertasCiclo.Clear()

    # ---- Serial -------------------------------------------------------------
    if ($Serial -and $Serial.IsOpen) {
      try {
        $script:SerialBuffer += $Serial.ReadExisting()
        if ($script:SerialBuffer.Length -gt 0) {
          $partes = $script:SerialBuffer -split "`r?`n"
          if ($partes.Count -gt 1) {
            for ($i = 0; $i -lt ($partes.Count - 1); $i++) { Processar-LinhaSerial $partes[$i] }
            $script:SerialBuffer = $partes[-1]
          }
          if ($script:SerialBuffer.Length -gt 4096) {
            $script:SerialBuffer = $script:SerialBuffer.Substring($script:SerialBuffer.Length - 4096)
          }
        }
      } catch {
        Alerta 'WARN' ("Falha lendo serial: {0}" -f $_.Exception.Message) 30
      }
    }

    # ---- /api/status --------------------------------------------------------
    $status = $null
    $httpOk = $false
    $latenciaMs = -1
    $relogio = [System.Diagnostics.Stopwatch]::StartNew()
    try {
      $status = Invoke-RestMethod -Uri ($EspUrl + '/api/status') -TimeoutSec 6
      $httpOk = $true
      $FalhasHttp = 0
      if ($HttpJaFalhou) {
        Alerta 'OK' 'HTTP respondeu novamente.' 0
        $HttpJaFalhou = $false
      }
    } catch {
      $FalhasHttp++
      if ($FalhasHttp -ge 3) {
        Alerta 'CRITICO' ("HTTP sem resposta ha {0} tentativas: {1}" -f $FalhasHttp, $_.Exception.Message) 15
        $HttpJaFalhou = $true
      }
    }
    $latenciaMs = $relogio.ElapsedMilliseconds

    # ---- /api/ultimo --------------------------------------------------------
    $evento = $null
    try {
      $evento = Invoke-RestMethod -Uri ($EspUrl + '/api/ultimo') -TimeoutSec 5
    } catch { }

    # ---- /api/logs (a cada 5 s) --------------------------------------------
    if (($agora - $UltimoLogs).TotalSeconds -ge 5) {
      $UltimoLogs = $agora
      try {
        $logs = Invoke-RestMethod -Uri ($EspUrl + '/api/logs?desde=' + $UltimoLogId) -Headers $Headers -TimeoutSec 5
        if ($logs -and $logs.logs) {
          foreach ($item in $logs.logs) {
            if ($item.id -gt $UltimoLogId) { $UltimoLogId = $item.id }
            $texto = "[{0}] [{1}] {2}" -f $item.hora, $item.tipo, $item.msg
            if ($item.tipo -eq 'err' -or $item.msg -match 'ALERTA|falhou|ausente|panic|watchdog') {
              Alerta 'WARN' ('Log da placa: ' + $texto) 10
            }
          }
        }
      } catch {
        $codigo = $null
        try { $codigo = [int]$_.Exception.Response.StatusCode } catch { }
        if ($codigo -eq 401) { Alerta 'WARN' 'API /api/logs: login admin recusado.' 120 }
      }
    }

    # ---- Avaliacao ----------------------------------------------------------
    if ($status) {
      if ($status.nfc -ne $true) { Alerta 'CRITICO' 'PN532: nfc_ok=false. Verifique I2C GPIO 8/9 e alimentacao.' 20 }
      if ($status.bio_ok -ne $true) { Alerta 'CRITICO' 'Biometria: bio_ok=false. Verifique UART GPIO 18/17 e alimentacao.' 20 }
      if ($UltimoNfcOk -ne $null -and $status.nfc -ne $UltimoNfcOk) {
        Alerta 'ALERTA' ("Mudanca no PN532: nfc_ok={0}" -f $status.nfc) 0
      }
      if ($UltimoBioOk -ne $null -and $status.bio_ok -ne $UltimoBioOk) {
        Alerta 'ALERTA' ("Mudanca na biometria: bio_ok={0}" -f $status.bio_ok) 0
      }
      $UltimoNfcOk = $status.nfc
      $UltimoBioOk = $status.bio_ok

      if ($status.heap_livre -lt 100000) { Alerta 'ALERTA' ("Heap baixo: {0} bytes" -f $status.heap_livre) 20 }
      if ($status.heap_livre -lt 70000)  { Alerta 'CRITICO' ("Heap critico: {0} bytes" -f $status.heap_livre) 10 }
      if ($status.heap_min -lt 80000)   { Alerta 'ALERTA' ("Heap minimo: {0} bytes" -f $status.heap_min) 30 }
      if ($status.psram_livre -lt 1000000) { Alerta 'ALERTA' ("PSRAM livre baixa: {0} bytes" -f $status.psram_livre) 30 }
      if ($status.loop_max_ms -gt 1500) { Alerta 'ALERTA' ("Loop travou: {0} ms" -f $status.loop_max_ms) 20 }
      if ($status.http_max_ms -gt 1500) { Alerta 'ALERTA' ("HTTP travou: {0} ms" -f $status.http_max_ms) 20 }
      if ($status.nfc_max_ms -gt 1000)  { Alerta 'ALERTA' ("NFC lento: {0} ms" -f $status.nfc_max_ms) 20 }
      if ($status.fs_max_ms -gt 800)    { Alerta 'ALERTA' ("Flash lenta: {0} ms" -f $status.fs_max_ms) 30 }
      if ($status.engasgos -gt $UltimoEngasgos) {
        Alerta 'ALERTA' ("Engasgos subiram: {0} -> {1}" -f $UltimoEngasgos, $status.engasgos) 10
        $UltimoEngasgos = $status.engasgos
      }
      if ($status.nfc_reinicios -gt $UltimoNfcReinicios) {
        Alerta 'ALERTA' ("PN532 reiniciou: {0} -> {1}" -f $UltimoNfcReinicios, $status.nfc_reinicios) 10
        $UltimoNfcReinicios = $status.nfc_reinicios
      }
      if ($status.nfc_reconexoes -gt $UltimoNfcReconexoes) {
        Alerta 'ALERTA' ("PN532 reconectou: {0} -> {1}" -f $UltimoNfcReconexoes, $status.nfc_reconexoes) 10
        $UltimoNfcReconexoes = $status.nfc_reconexoes
      }
      if ($status.modo -eq 'STA' -and ($status.rssi -eq 0 -or $status.rssi -lt -80)) {
        Alerta 'WARN' ("Wi-Fi fraco ou caiu: RSSI {0} dBm" -f $status.rssi) 20
      }
      if ($UltimoUptime -ge 0 -and $status.uptime -lt $UltimoUptime) {
        Alerta 'CRITICO' ("Placa reiniciou: uptime {0}s -> {1}s" -f $UltimoUptime, $status.uptime) 0
      }
      $UltimoUptime = $status.uptime
      if ($UltimoIp -and $status.ip -ne $UltimoIp) {
        Alerta 'ALERTA' ("IP mudou: {0} -> {1}" -f $UltimoIp, $status.ip) 0
      }
      $UltimoIp = $status.ip
      $UltimoStatus = $status
    }

    # ---- Eventos ------------------------------------------------------------
    if ($evento -and $evento.seq -ne $UltimoSeq) {
      if ($UltimoSeq -ge 0) {
        $detalhe = "seq={0} metodo={1} uid={2} bio={3} desconhecida={4} cadastrado={5}" -f `
          $evento.seq, $evento.metodo, $evento.uid, $evento.bio_id, $evento.biometria_desconhecida, $evento.cadastrado
        $nivel = if ($evento.biometria_desconhecida) { 'INFO' } else { 'INFO' }
        Alerta $nivel ('Evento: ' + $detalhe) 0
      }
      $UltimoSeq = $evento.seq
      $UltimoEvento = $evento
    }

    # ---- Registro JSONL -----------------------------------------------------
    $registro = [ordered]@{
      ts              = $agora.ToString('o')
      http_ok         = $httpOk
      latencia_ms     = $latenciaMs
      status          = $UltimoStatus
      ultimo          = $UltimoEvento
      alertas         = @($script:AlertasCiclo)
      serial          = @($script:SerialLinhas)
    }
    try {
      Add-Content -Path $ArquivoJsonl -Value ($registro | ConvertTo-Json -Depth 6 -Compress) -Encoding UTF8
    } catch { }

    # ---- Resumo no console --------------------------------------------------
    if (($agora - $UltimoResumo).TotalSeconds -ge 10 -and $UltimoStatus) {
      $UltimoResumo = $agora
      $linha = "[{0}] HTTP={1}ms NFC={2} BIO={3} heap={4}KB min={5}KB PSRAM={6}MB loop={7}ms http={8}ms nfc={9}ms fs={10}ms eng={11} RSSI={12} seq={13} up={14}s" -f `
        $agora.ToString('HH:mm:ss'), $latenciaMs, $UltimoStatus.nfc, $UltimoStatus.bio_ok,
        [int]($UltimoStatus.heap_livre / 1024), [int]($UltimoStatus.heap_min / 1024),
        [math]::Round($UltimoStatus.psram_livre / 1MB, 1), $UltimoStatus.loop_max_ms,
        $UltimoStatus.http_max_ms, $UltimoStatus.nfc_max_ms, $UltimoStatus.fs_max_ms,
        $UltimoStatus.engasgos, $UltimoStatus.rssi, $UltimoSeq, $UltimoStatus.uptime
      Write-Host $linha -ForegroundColor Gray
    }

    Start-Sleep -Seconds ([Math]::Max(1, $IntervaloSegundos))
  }
} finally {
  if ($Serial -and $Serial.IsOpen) { try { $Serial.Close() } catch { } }
  if (Test-Path $ArquivoPid) {
    $pidNoArquivo = Get-Content $ArquivoPid -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pidNoArquivo -eq "$PID") { Remove-Item $ArquivoPid -Force -ErrorAction SilentlyContinue }
  }
  if ($TemMutex) { try { $Mutex.ReleaseMutex() } catch { } }
  try { $Mutex.Dispose() } catch { }
  Write-Host ''
  Write-Host '  Monitor encerrado.' -ForegroundColor Yellow
  Write-Host ("  JSONL   : {0}" -f $ArquivoJsonl)
  Write-Host ("  Alertas : {0}" -f $ArquivoAlertas)
  Write-Host ("  Serial  : {0}" -f $ArquivoSerial)
  Write-Host ''
}
