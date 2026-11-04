# =============================================================================
# lab-menu.ps1 — TUI unificada do laboratório offline (Acesso Escolar NFC)
# ---------------------------------------------------------------------------
# Tela única (24 linhas, cabe na janela padrão) com:
#   - luzes ao vivo: Docker, Banco, Painel e Placa ESP32 (medidas por um
#     processo de fundo; a TUI só lê um arquivo, então o teclado nunca espera)
#   - menu completo: ligar, desligar, checar, abrir painel, endereços,
#     firewall, backup e recomeçar do zero
#
# Ações diretas (para atalhos/scripts):
#   lab-menu.ps1 -Acao ligar|desligar|checar|enderecos|backup|zerar
#
# Desempenho: desenho pela API do console ([Console]::Write), sem Write-Host no
# laço de teclado; polling de 10 ms (latência imperceptível); luzes a cada 0,7 s
# lendo JSON de ~1 KB. Compatível com Windows PowerShell 5.1.
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
  $ip = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Where-Object { $_.InterfaceAlias -notmatch 'vEthernet|Hyper|WSL|Docker|Loopback' } |
    Select-Object -First 1 -ExpandProperty IPAddress
  return $ip
}

function Escrever-Positivo { param([string]$Texto) Write-Host ("  [OK]  " + $Texto) -ForegroundColor Green }
function Escrever-Negativo { param([string]$Texto) Write-Host ("  [XX]  " + $Texto) -ForegroundColor Red }

# =============================================================================
# Estado ao vivo (processo de fundo → arquivo JSON → leitura barata)
# =============================================================================

$script:CaminhoEstado = Join-Path $env:TEMP ("lab-nfc-estado-{0}.json" -f $PID)
$script:EstadoProc = $null
$script:EstadoAtual = $null

function Iniciar-Estado {
  Remove-Item $script:CaminhoEstado -ErrorAction SilentlyContinue
  $argumentos = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Projeto "{1}" -Caminho "{2}" -PidPai {3}' -f `
    (Join-Path $script:Projeto 'lab-estado.ps1'), $script:Projeto, $script:CaminhoEstado, $PID
  $script:EstadoProc = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -ArgumentList $argumentos
}

function Parar-Estado {
  if ($script:EstadoProc -and -not $script:EstadoProc.HasExited) {
    try { Stop-Process -Id $script:EstadoProc.Id -Force -ErrorAction SilentlyContinue } catch { }
  }
  $script:EstadoProc = $null
  Remove-Item $script:CaminhoEstado -ErrorAction SilentlyContinue
}

function Ler-Estado {
  try {
    $texto = [System.IO.File]::ReadAllText($script:CaminhoEstado, [System.Text.Encoding]::UTF8)
    return ($texto | ConvertFrom-Json)
  } catch { return $null }
}

# =============================================================================
# Ações
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
  @{ Texto = 'Liberar o firewall da rede da escola';  Valor = 'firewall' }
  @{ Texto = 'Fazer backup dos dados';                Valor = 'backup' }
  @{ Texto = 'Recomeçar do zero (APAGA cadastros!)';  Valor = 'zerar' }
  @{ Texto = 'Sair (deixa tudo como está)';           Valor = 'sair' }
)

$script:Mensagens = New-Object System.Collections.Generic.List[string]
$script:Largura = 70
$script:LinhaLuzes = 3
$script:LinhaMenu = 5
$script:LinhaLog = 16
$script:LogMax = 6

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
  } else {
    if ($estado.docker) { $celulas += , @('Docker: ligado', [ConsoleColor]::Green) } else { $celulas += , @('Docker: parado', [ConsoleColor]::Red) }
    if ($estado.banco)  { $celulas += , @('Banco: ligado',  [ConsoleColor]::Green) } else { $celulas += , @('Banco: parado',  [ConsoleColor]::Red) }
    if ($estado.painel) { $celulas += , @('Painel: ligado', [ConsoleColor]::Green) } else { $celulas += , @('Painel: parado', [ConsoleColor]::Red) }
    if ($estado.placa -eq 2)     { $celulas += , @('Placa: pronta',      [ConsoleColor]::Green) }
    elseif ($estado.placa -eq 1) { $celulas += , @('Placa: leitor fora', [ConsoleColor]::Yellow) }
    else                         { $celulas += , @('Placa: ausente',     [ConsoleColor]::Red) }
  }
  $x = 4
  foreach ($celula in $celulas) {
    Pintar $x $script:LinhaLuzes ($celula[0].PadRight(18)) $celula[1]
    $x += 18
  }
}

function Desenhar-MenuItem {
  param([int]$Indice, [bool]$Selecionado)
  $texto = ('{0}) {1}' -f ($Indice + 1), $script:Opcoes[$Indice].Texto).PadRight($script:Largura)
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
  Pintar 2 14 $fina ([ConsoleColor]::Cyan)
  Pintar 4 15 'MENSAGENS:' ([ConsoleColor]::DarkCyan)
  Pintar 2 22 $fina ([ConsoleColor]::Cyan)
  Pintar 4 23 'Setas + Enter (ou números 1-9). ESC sai. Luzes atualizam sozinhas.' ([ConsoleColor]::DarkGray)
  for ($i = 0; $i -lt $script:Opcoes.Count; $i++) { Desenhar-MenuItem -Indice $i -Selecionado $false }
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
  }
  return @{ Indice = $Selecionado; Escolheu = $false }
}

# =============================================================================
# Laço principal
# =============================================================================

function Rodar-TUI {
  $selecionado = 0
  Desenhar-Quadro
  Mensagem 'Bem-vindo! Verde = no ar. Setas + Enter, ou número. ESC sai.'
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
          'desligar'  { Parar-Laboratorio;        Mensagem 'Desligar: painel fechado e banco guardado.' }
          'checar'    { Checar-Laboratorio;       Mensagem 'Checar: diagnóstico concluído; [OK] verde significa tudo bem.' }
          'abrir'     { Abrir-PainelNoNavegador;  Mensagem 'Abrir: navegador enviado ao painel.' }
          'enderecos' { Ver-Enderecos;            Mensagem 'Endereços: mostrados acima (digite no tablet).' }
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
      Start-Sleep -Milliseconds 10
      if ($relogioLuzes.ElapsedMilliseconds -ge 700) {
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
