# =============================================================================
# lab-menu.ps1 — TUI do laboratório offline (Acesso Escolar NFC)
# ---------------------------------------------------------------------------
# Menu em texto com navegação por setas, e ações diretas:
#   lab-menu.ps1                 → abre o menu (setas + Enter, ou 1..5)
#   lab-menu.ps1 -Acao ligar     → liga Docker + banco + painel
#   lab-menu.ps1 -Acao desligar  → fecha o painel e guarda o banco
#   lab-menu.ps1 -Acao checar    → diagnóstico em português
#   lab-menu.ps1 -Acao enderecos → endereços para o tablet
#   lab-menu.ps1 -Acao zerar     → lab:reset + lab:admin (APAGA cadastros)
# Compatível com Windows PowerShell 5.1 (não exige nada além do que já existe).
# =============================================================================
param([string]$Acao = '', [switch]$SemPausa)

try {
  # Força UTF-8 na saída do console (normaliza acentos em janela e em redirecionamento).
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

$script:Projeto = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $script:Projeto

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
  $ip = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Where-Object { $_.InterfaceAlias -notmatch 'vEthernet|Hyper|WSL|Docker|Loopback' } |
    Select-Object -First 1 -ExpandProperty IPAddress
  return $ip
}

function Escrever-Positivo { param([string]$Texto) Write-Host ("  [OK]  " + $Texto) -ForegroundColor Green }
function Escrever-Negativo { param([string]$Texto) Write-Host ("  [XX]  " + $Texto) -ForegroundColor Red }

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

function Iniciar-Laboratorio {
  Write-Host ''
  Write-Host '  1) Docker Desktop' -ForegroundColor White
  if (-not (Esperar-Docker)) { return }

  Write-Host '  2) Banco de dados (Supabase local, dentro do Docker)' -ForegroundColor White
  if (Testar-Supabase) {
    Escrever-Positivo 'o banco já está no ar.'
  } else {
    Write-Host '  Subindo o banco (demora 1-2 min; na primeira vez baixa as peças)...' -ForegroundColor Yellow
    Write-Host '  Se aparecer um trecho JSON com "Error" no meio, é só a espera do container: pode ignorar se o [OK] vier depois.' -ForegroundColor DarkGray
    Npm 'lab:start'
    $ligou = $false
    for ($espera = 1; $espera -le 6; $espera++) {
      if (Testar-Supabase) { $ligou = $true; break }
      Start-Sleep -Seconds 5
    }
    if ($ligou) { Escrever-Positivo 'banco ligado.' }
    else { Escrever-Negativo 'o banco não respondeu. Use 3) checar para ver o detalhe.' }
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

$script:Opcoes = @(
  @{ Texto = 'Ligar tudo (dia na escola)';           Valor = 'ligar' }
  @{ Texto = 'Desligar tudo (fim do dia)';           Valor = 'desligar' }
  @{ Texto = 'Checar a saúde do laboratório';        Valor = 'checar' }
  @{ Texto = 'Ver os endereços para o tablet';       Valor = 'enderecos' }
  @{ Texto = 'Recomeçar do zero (APAGA cadastros!)'; Valor = 'zerar' }
  @{ Texto = 'Sair';                                 Valor = 'sair' }
)

function Estado-Dashboard {
  $partes = @()
  if (Testar-Docker)   { $partes += , @{ Texto = 'Docker: ligado'; Ok = $true } }  else { $partes += , @{ Texto = 'Docker: parado'; Ok = $false } }
  if (Testar-Supabase) { $partes += , @{ Texto = 'Banco: ligado';  Ok = $true } }  else { $partes += , @{ Texto = 'Banco: parado';  Ok = $false } }
  if (Testar-Painel)   { $partes += , @{ Texto = 'Painel: ligado'; Ok = $true } } else { $partes += , @{ Texto = 'Painel: parado'; Ok = $false } }
  return $partes
}

function Desenhar-Menu {
  param([int]$Selecionado)
  Clear-Host
  Write-Host '  ==================================================================' -ForegroundColor Cyan
  Write-Host '    ACESSO ESCOLAR NFC - LABORATORIO OFFLINE' -ForegroundColor White
  Write-Host '  ==================================================================' -ForegroundColor Cyan
  Write-Host '    ' -NoNewline
  $primeiro = $true
  foreach ($parte in (Estado-Dashboard)) {
    if (-not $primeiro) { Write-Host '   ' -NoNewline }
    Write-Host $parte.Texto -NoNewline -ForegroundColor $(if ($parte.Ok) { 'Green' } else { 'Red' })
    $primeiro = $false
  }
  Write-Host ''
  Write-Host '  ------------------------------------------------------------------' -ForegroundColor Cyan
  for ($i = 0; $i -lt $script:Opcoes.Count; $i++) {
    if ($i -eq $Selecionado) {
      Write-Host ('   > {0}' -f $script:Opcoes[$i].Texto) -ForegroundColor Black -BackgroundColor Cyan
    } else {
      Write-Host ('     {0}' -f $script:Opcoes[$i].Texto) -ForegroundColor White
    }
  }
  Write-Host '  ------------------------------------------------------------------' -ForegroundColor Cyan
  Write-Host '  Use as setas e Enter (ou 1, 2, 3...). ESC sai. Dica: 1 = ligar tudo.' -ForegroundColor DarkGray
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
  }
  return @{ Indice = $Selecionado; Escolheu = $false }
}

function Rodar-Menu {
  $selecionado = 0
  while ($true) {
    Desenhar-Menu -Selecionado $selecionado
    $resposta = Ler-Opcao -Selecionado $selecionado
    $selecionado = $resposta.Indice
    if (-not $resposta.Escolheu) { continue }
    $escolhido = $script:Opcoes[$selecionado].Valor
    if ($escolhido -eq 'sair') { Clear-Host; break }
    if ($escolhido -eq 'ligar')     { Iniciar-Laboratorio }
    if ($escolhido -eq 'desligar')  { Parar-Laboratorio }
    if ($escolhido -eq 'checar')    { Npm 'lab:check' }
    if ($escolhido -eq 'enderecos') { Npm 'lab:ip' }
    if ($escolhido -eq 'zerar')     { Zerar-Laboratorio }
    Write-Host ''
    $null = Read-Host '  Aperte Enter para voltar ao menu'
    $selecionado = 0
  }
}

try {
  if ($Acao -ne '') {
    switch ($Acao.ToLower()) {
      'ligar'     { Iniciar-Laboratorio }
      'desligar'  { Parar-Laboratorio }
      'checar'    { Npm 'lab:check' }
      'enderecos' { Npm 'lab:ip' }
      'zerar'     { Zerar-Laboratorio }
      default     { Write-Host ("Ação desconhecida: " + $Acao) -ForegroundColor Red }
    }
    Write-Host ''
    if (-not $SemPausa) { $null = Read-Host 'Aperte Enter para fechar esta janela' }
  } else {
    Rodar-Menu
  }
} catch {
  Write-Host ''
  Write-Host ('  Deu problema: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host '  Feche esta janela e tente de novo. Se persistir, rode no terminal: npm run lab:check' -ForegroundColor Yellow
  if (-not $SemPausa) { $null = Read-Host 'Aperte Enter para fechar esta janela' }
}
