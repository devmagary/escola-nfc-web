# =============================================================================
# lab-atalhos.ps1 — atalhos "Servidor NFC" e "Hotspot NFC" na área de trabalho
# ---------------------------------------------------------------------------
# Cria (ou recria) os atalhos de duplo clique do laboratório. "Servidor NFC"
# abre a TUI unificada; "Hotspot NFC" cria a rede Wi-Fi NFC-Lab sem internet.
# Remove os atalhos antigos individuais se ainda existirem. Pode rodar mais de
# uma vez.
# =============================================================================
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

$script:Projeto = Split-Path -Parent $MyInvocation.MyCommand.Path
$areaDeTrabalho = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

# 1) Remove os atalhos individuais antigos (nomes exatos que este script criou).
foreach ($antigo in @('Servidor NFC - Menu', 'Servidor NFC - LIGAR', 'Servidor NFC - DESLIGAR', 'Servidor NFC - CHECAR')) {
  $caminhoAntigo = Join-Path $areaDeTrabalho ($antigo + '.lnk')
  if (Test-Path $caminhoAntigo) {
    Remove-Item $caminhoAntigo -Force
    Write-Host ("  Atalho antigo removido: " + $antigo) -ForegroundColor DarkGray
  }
}

# 2) Cria o atalho único da TUI unificada.
$caminhoDoAtalho = Join-Path $areaDeTrabalho 'Servidor NFC.lnk'
$link = $shell.CreateShortcut($caminhoDoAtalho)
$link.TargetPath = Join-Path $script:Projeto 'lab.cmd'
$link.WorkingDirectory = $script:Projeto
$link.Description = 'Acesso Escolar NFC - laboratorio offline (Docker, sem internet)'
$link.Save()
Write-Host '  Atalho criado na area de trabalho: Servidor NFC' -ForegroundColor Green

# 3) Atalho do hotspot (rede NFC-Lab sem internet).
$caminhoHotspot = Join-Path $areaDeTrabalho 'Hotspot NFC.lnk'
$linkHotspot = $shell.CreateShortcut($caminhoHotspot)
$linkHotspot.TargetPath = Join-Path $script:Projeto 'lab-hotspot.cmd'
$linkHotspot.WorkingDirectory = $script:Projeto
$linkHotspot.Description = 'Acesso Escolar NFC - cria a rede NFC-Lab sem internet'
$linkHotspot.Save()
Write-Host '  Atalho criado na area de trabalho: Hotspot NFC' -ForegroundColor Green

Write-Host ''
Write-Host '  Duplo clique em "Servidor NFC" abre o painel de luzes com o menu' -ForegroundColor Yellow
Write-Host '  (ligar/desligar/checar/abrir painel/enderecos/hotspot/firewall/backup/zerar).' -ForegroundColor Yellow
Write-Host '  Duplo clique em "Hotspot NFC" cria a rede Wi-Fi do laboratorio.' -ForegroundColor Yellow
Write-Host '  ESC sai do menu.' -ForegroundColor Yellow
