# =============================================================================
# lab-menu.ps1 — TUI unificada do laboratório offline (Acesso Escolar NFC)
# ---------------------------------------------------------------------------
# Tela única: luzes de estado ao vivo (Docker, Banco, Painel, Placa ESP32),
# menu com setas/números e todas as ações do dia a dia em um só lugar:
#
#   lab-menu.ps1                 → abre a TUI (setas + Enter, 1..9, ESC sai)
#   lab-menu.ps1 -Acao ligar     → liga Docker + banco + painel (janela dedicada)
#   lab-menu.ps1 -Acao desligar  → fecha o painel e guarda o banco
#   lab-menu.ps1 -Acao checar    → diagnóstico em português
#   lab-menu.ps1 -Acao enderecos → endereços para o tablet
#   lab-menu.ps1 -Acao backup    → dump de dados em supabase/backup.sql
#   lab-menu.ps1 -Acao zerar     → lab:reset + lab:admin (APAGA cadastros)
#
# Compatível com Windows PowerShell 5.1 (nada além do que o Windows já tem).
# =============================================================================
param([string]$Acao = '', [switch]$SemPausa)

try {
  # Força UTF-8 na saída do console (normaliza acentos na janela e ao redirecionar).
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }
try { [Console]::CursorVisible = $false } catch { }

$script:Projeto = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $script:Projeto

# =============================================================================
# Utilidades de infraestrutura (testes de saúde e chamadas npm)
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

function Testar-Placa {
  # 0 = placa inacessível; 1 = acessível mas leitor fora; 2 = pronta (leitor OK)
  $urlPlaca = 'http://192.168.0.73'
  try {
    $linhas = Get-Content (Join-Path $script:Projeto '.env.local') -ErrorAction SilentlyContinue |
      Where-Object { $_ -match '^ESP_URL\s*=' }
    if ($linhas) { $urlPlaca = (($linhas[0] -split '=', 2)[1]).Trim() }
  } catch { }
  try {
    $resposta = Invoke-WebRequest -Uri ($urlPlaca.TrimEnd('/') + '/api/ultimo') -TimeoutSec 4 -UseBasicParsing
    if ($resposta.Content -match '"nfc_ok"\s*:\s*true') { return 2 }
    return 1
  } catch { return 0 }
}

function Pegar-IP {
  $ip = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Where-Object { $_.InterfaceAlias -notmatch 'vEthernet|Hyper|WSL|Docker|Loopback' } |
    Select-Object -First 1 -ExpandProperty IPAddress
  return $ip
}

function Escrever-Positivo { param([string]$Texto) Write-Host ("  [OK]  " + $Texto) -ForegroundColor Green }
function Escrever-Negativo { param([string]$Texto) Write-Host ("  [XX]  " + $Texto) -ForegroundColor Red }

# --- Estado ao vivo em processo de fundo -------------------------------------
# As luzes ficam em UM job separado, escrevendo um JSON no %TEMP%: assim o
# teclado nunca espera rede e a TUI responde na hora (o bug das setas engolidas
# era o laço principal preso nos testes de rede).
$script:CaminhoEstado = Join-Path $env:TEMP ("lab-nfc-estado-{0}.json" -f $PID)
$script:JobEstado = $null
$script:Estado = $null

function Iniciar-Estado {
  $projeto = $script:Projeto
  $caminho = $script:CaminhoEstado
  $pidPai = $PID
  $script:JobEstado = Start-Job -ScriptBlock {
    param($projeto, $caminho, $pidPai)
    try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
    Set-Location $projeto
    while ($true) {
      if (-not (Get-Process -Id $pidPai -ErrorAction SilentlyContinue)) { break }
      $docker = $false
      & cmd /c "docker info >nul 2>nul"
      $docker = ($LASTEXITCODE -eq 0)
      $banco = $false
      try { $r = Invoke-WebRequest 'http://localhost:54321/auth/v1/health' -TimeoutSec 3 -UseBasicParsing; $banco = ($r.StatusCode -eq 200) } catch { }
      $painel = $false
      try { $r = Invoke-WebRequest 'http://localhost:5500/' -Method Head -TimeoutSec 3 -UseBasicParsing; $painel = ($r.StatusCode -eq 200) } catch { }
      $placa = 0
      $urlPlaca = 'http://192.168.0.73'
      try {
        $linha = Get-Content (Join-Path $projeto '.env.local') -ErrorAction SilentlyContinue |
          Where-Object { $_ -match '^ESP_URL\s*=' } | Select-Object -First 1
        if ($linha) { $urlPlaca = (($linha -split '=', 2)[1]).Trim() }
      } catch { }
      try {
        $r = Invoke-WebRequest ($urlPlaca.TrimEnd('/') + '/api/ultimo') -TimeoutSec 3 -UseBasicParsing
        if ($r.Content -match '"nfc_ok"\s*:\s*true') { $placa = 2 } else { $placa = 1 }
      } catch { $placa = 0 }
      @{ docker = $docker; banco = $banco; painel = $painel; placa = $placa; em = (Get-Date).ToString('o') } |
        ConvertTo-Json -Compress | Set-Content -Path $caminho -Encoding UTF8 -Force
      Start-Sleep -Seconds 2
    }
  } -ArgumentList $projeto, $caminho, $pidPai
}

function Parar-Estado {
  if ($script:JobEstado) {
    try { Stop-Job $script:JobEstado -ErrorAction SilentlyContinue | Out-Null } catch { }
    try { Remove-Job $script:JobEstado -Force -ErrorAction SilentlyContinue | Out-Null } catch { }
    $script:JobEstado = $null
  }
  Remove-Item $script:CaminhoEstado -ErrorAction SilentlyContinue
}

function Ler-Estado {
  try {
    $json = Get-Content $script:CaminhoEstado -ErrorAction Stop -Encoding UTF8
    return ($json | ConvertFrom-Json)
  } catch { return $null }
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
# Ações (cada uma roda em tela limpa, com saída visível, e volta ao quadro)
# =============================================================================

function Iniciar-Laboratorio {
  Write-Host ''
  Write-Host '  1) Docker Desktop' -ForegroundColor White
  if (-not (Esperar-Docker)) { return }

  Write-Host '  2) Banco de dados (Supabase local, dentro do Docker)' -ForegroundColor White
  if (Testar-Supabase) {
    Escrever-Positivo 'o banco já está no ar.'
  } else {
    Write-Host '  Subindo o banco (demora 1-2 min; na primeira vez baixa as peças)...' -ForegroundColor Yellow
    Write-Host '  Se aparecer um trecho JSON com "Error" no meio, é só a espera do container: ignore se o [OK] vier depois.' -ForegroundColor DarkGray
    Npm 'lab:start'
    $ligou = $false
    for ($espera = 1; $espera -le 6; $espera++) {
      if (Testar-Supabase) { $ligou = $true; break }
      Start-Sleep -Seconds 5
    }
    if ($ligou) { Escrever-Positivo 'banco ligado.' }
    else { Escrever-Negativo 'o banco não respondeu. Use a opção Checar para ver o detalhe.' }
  }

  Write-Host '  3) Painel (site do laboratório)' -ForegroundColor White
  if (Testar-Painel) {
    Escrever-Positivo 'o painel já está no ar (deve haver uma janela "Painel NFC" aberta).'
  } else {
    Start-Process -FilePath 'cmd.exe' -ArgumentList ("/k cd /d `"$script:Projeto`" && title Painel NFC (nao fechar) && npm run lab:dev")
    $ligou = $false
    for ($espera = 1; $espera -le 15; $espera++) {
      Start-Sleep -Seconds 2
      if (Testar-Painel) { $ligou = $true; break }
      Write-Host ("    subindo o painel... ({0})" -f $espera) -ForegroundColor DarkGray
    }
    if ($ligou) { Escrever-Positivo 'painel ligado. Abriu uma janela "Painel NFC": NÃO feche ela, é o site.' }
    else { Escrever-Negativo 'o painel demorou; olhe a janela "Painel NFC" para ver o que aconteceu.' }
  }

  $ip = Pegar-IP
  Write-Host ''
  if ($ip) { Write-Host ("  PRONTO. No tablet: http://{0}:5500   (no computador: http://localhost:5500)" -f $ip) -ForegroundColor Green }
  else { Write-Host '  PRONTO. Sem IP de rede visível: confira o Wi-Fi/cabo antes de usar o tablet.' -ForegroundColor Yellow }
}

function Parar-Laboratorio {
  Write-Host ''
  Write-Host '  1) Fechando a janela do painel...' -ForegroundColor White
  $null = & cmd /c 'taskkill /FI "WINDOWTITLE eq Painel NFC*" /T /F >nul 2>&1'
  if (Testar-Painel) { Write-Host '  ainda há um painel no ar de outra janela: feche-a com Ctrl+C.' -ForegroundColor Yellow }
  else { Escrever-Positivo 'painel fora do ar.' }

  Write-Host '  2) Guardando o banco de dados...' -ForegroundColor White
  if (-not (Testar-Supabase)) { Write-Host '  o banco já estava parado.' -ForegroundColor DarkGray }
  else { Npm 'lab:stop'; Escrever-Positivo 'banco guardado nos caixotes do Docker. Nada foi apagado.' }
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

function Liberar-Firewall {
  Write-Host ''
  Write-Host '  Vai abrir uma janela pedindo permissão de administrador: clique em "Sim".' -ForegroundColor Yellow
  Start-Process -FilePath 'cmd.exe' -ArgumentList ("/c `"$script:Projeto\lab-firewall-liberar.cmd`"")
  Write-Host '  (É o mesmo lab-firewall-liberar.cmd: libera o painel e o banco na rede da escola.)' -ForegroundColor DarkGray
}

function Fazer-Backup {
  Npm 'lab:backup'
  Write-Host ''
  Write-Host '  O arquivo ficou em supabase\backup.sql (dentro da pasta do projeto).' -ForegroundColor Green
  Write-Host '  Lembrando: o backup NÃO inclui usuários do login nem fotos; eles se recriam' -ForegroundColor DarkGray
  Write-Host '  com a opção de admin e novo envio de fotos pelo painel. O que vale sempre é o git.' -ForegroundColor DarkGray
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

# =============================================================================
# A TUI: quadro com luzes ao vivo + menu de setas + área de mensagens
# =============================================================================

$script:Opcoes = @(
  @{ Texto = 'Ligar tudo (dia na escola)';            Valor = 'ligar' }
  @{ Texto = 'Desligar tudo (fim do dia)';            Valor = 'desligar' }
  @{ Texto = 'Checar a saúde do laboratório';         Valor = 'checar' }
  @{ Texto = 'Abrir o painel no navegador';           Valor = 'abrir' }
  @{ Texto = 'Ver os endereços para o tablet';        Valor = 'enderecos' }
  @{ Texto = 'Liberar o firewall da rede da escola';  Valor = 'firewall' }
  @{ Texto = 'Fazer backup dos dados';                Valor = 'backup' }
  @{ Texto = 'Recomeçar do zero (APAGA cadastros!)';  Valor = 'zerar' }
  @{ Texto = 'Sair (deixa tudo como está)';           Valor = 'sair' }
)

$script:Mensagens = New-Object System.Collections.Generic.List[string]
$script:Largura = 78
$script:LinhaLuzes = 2
$script:LinhaMenu = 0
$script:LinhaLog = 0
$script:LogMax = 8
$script:Relogio = 0

function Mensagem {
  param([string]$Texto)
  while ($script:Mensagens.Count -ge $script:LogMax) { $script:Mensagens.RemoveAt(0) }
  $script:Mensagens.Add($Texto)
  Repintar-Mensagens
}

function Repintar-Mensagens {
  $linha = $script:LinhaLog
  foreach ($texto in $script:Mensagens) {
    try {
      [Console]::SetCursorPosition(4, $linha)
      $cortado = $texto
      $maximo = $script:Largura - 6
      if ($cortado.Length -gt $maximo) { $cortado = $cortado.Substring(0, $maximo) }
      Write-Host $cortado -NoNewline -ForegroundColor Gray
      Write-Host (' ' * ($maximo - $cortado.Length)) -NoNewline
    } catch { }
    $linha++
  }
}

function Escrever-Linha {
  param([string]$Texto, [string]$Cor = 'White')
  if ($Texto.Length -gt $script:Largura) { $Texto = $Texto.Substring(0, $script:Largura) }
  Write-Host $Texto -ForegroundColor $Cor
}

function Desenhar-Quadro {
  Clear-Host
  $fina = '-' * $script:Largura
  Write-Host ("  " + ('=' * $script:Largura)) -ForegroundColor Cyan
  Escrever-Linha ('   ACESSO ESCOLAR NFC - LABORATORIO OFFLINE (dois cliques e roda)') 'White'
  Write-Host ("  " + $fina) -ForegroundColor Cyan           # linha das luzes vem logo abaixo
  $script:LinhaLuzes = [Console]::CursorTop
  Write-Host ''                                          # reserva a linha das luzes
  Write-Host ("  " + $fina) -ForegroundColor Cyan
  Write-Host ''                                          # brecha entre luzes e menu
  $script:LinhaMenu = [Console]::CursorTop
  Write-Host ("  " + $fina) -ForegroundColor Cyan
  Write-Host ''
  Write-Host '   MENSAGENS:' -ForegroundColor DarkCyan
  $script:LinhaLog = [Console]::CursorTop
  for ($i = 0; $i -lt $script:LogMax; $i++) { Write-Host (' ' * $script:Largura) }
  Write-Host ("  " + $fina) -ForegroundColor Cyan
  Write-Host ''
  Escrever-Linha '   Setas + Enter (ou números 1-8). ESC sai. Luzes se atualizam sozinhas.' 'DarkGray'
  Desenhar-Luzes
  Repintar-Mensagens
}

function Desenhar-Luzes {
  $estado = Ler-Estado
  $luzes = @()
  if ($null -eq $estado) {
    $luzes += , @('Docker: ...',       'DarkGray')
    $luzes += , @('Banco: ...',        'DarkGray')
    $luzes += , @('Painel: ...',       'DarkGray')
    $luzes += , @('Placa: ...',        'DarkGray')
  } else {
    if ($estado.docker) { $luzes += , @('Docker: ligado',       'Green') } else { $luzes += , @('Docker: parado', 'Red') }
    if ($estado.banco)  { $luzes += , @('Banco: ligado',        'Green') } else { $luzes += , @('Banco: parado',  'Red') }
    if ($estado.painel) { $luzes += , @('Painel: ligado',       'Green') } else { $luzes += , @('Painel: parado', 'Red') }
    if ($estado.placa -eq 2)      { $luzes += , @('Placa: pronta',      'Green') }
    elseif ($estado.placa -eq 1)  { $luzes += , @('Placa: leitor fora', 'Yellow') }
    else                          { $luzes += , @('Placa: ausente',     'Red') }
  }
  try { [Console]::SetCursorPosition(4, $script:LinhaLuzes) } catch { }
  foreach ($luz in $luzes) {
    Write-Host ($luz[0].PadRight(22)) -NoNewline -ForegroundColor $luz[1]
  }
}

function Desenhar-MenuItem {
  param([int]$Indice, [bool]$Selecionado)
  $numero = "{0}) " -f ($Indice + 1)
  $texto = ($numero + $script:Opcoes[$Indice].Texto).PadRight(50)
  try { [Console]::SetCursorPosition(3, $script:LinhaMenu + $Indice) } catch { return }
  if ($Selecionado) {
    Write-Host ('> ' + $texto) -NoNewline -ForegroundColor Black -BackgroundColor Cyan
  } else {
    Write-Host ('  ' + $texto) -NoNewline -ForegroundColor White
  }
  Write-Host ''
}

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
  }
  return @{ Indice = $Selecionado; Escolheu = $false }
}

function Rodar-TUI {
  $selecionado = 0
  try { Iniciar-Estado } catch { }
  Desenhar-Quadro
  for ($i = 0; $i -lt $script:Opcoes.Count; $i++) { Desenhar-MenuItem -Indice $i -Selecionado ($i -eq $selecionado) }
  Mensagem 'Bem-vindo! A luz verde é o que está no ar. Use as setas + Enter.'
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
          Clear-Host
          try { [Console]::CursorVisible = $true } catch { }
          return
        }
        try { [Console]::CursorVisible = $true } catch { }
        Clear-Host
        switch ($escolhido) {
          'ligar'     { Iniciar-Laboratorio;   Mensagem 'Ligar: subida concluída (veja [OK]/[XX] acima).' }
          'desligar'  { Parar-Laboratorio;     Mensagem 'Desligar: painel fechado e banco guardado.' }
          'checar'    { Checar-Laboratorio;    Mensagem 'Checar: diagnóstico concluído; [OK] verde significa tudo bem.' }
          'abrir'     { Abrir-PainelNoNavegador; Mensagem 'Abrir: navegador enviado ao painel.' }
          'enderecos' { Ver-Enderecos;         Mensagem 'Endereços: mostrados acima (digite no tablet).' }
          'firewall'  { Liberar-Firewall;      Mensagem 'Firewall: confirme com "Sim" na janela do Windows.' }
          'backup'    { Fazer-Backup;          Mensagem 'Backup: salvo em supabase\backup.sql.' }
          'zerar'     { Zerar-Laboratorio;     Mensagem 'Zerar: banco refeito com os 6 alunos de demonstração.' }
        }
        Write-Host ''
        $null = Read-Host 'Aperte Enter para voltar'
        try { [Console]::CursorVisible = $false } catch { }
        Desenhar-Quadro
        $selecionado = 0
      }
    } else {
      Start-Sleep -Milliseconds 250
      $script:Relogio = $script:Relogio + 1
      if ($script:Relogio % 4 -eq 0) { Desenhar-Luzes }
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
      'backup'    { Fazer-Backup }
      'zerar'     { Zerar-Laboratorio }
      default     { Write-Host ("Ação desconhecida: " + $Acao) -ForegroundColor Red }
    }
    Write-Host ''
    if (-not $SemPausa) { $null = Read-Host 'Aperte Enter para fechar esta janela' }
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
