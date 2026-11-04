# =============================================================================
# lab-atalhos.ps1 — atalho único "Servidor NFC" na área de trabalho do Windows
# ---------------------------------------------------------------------------
# Cria (ou recria) o atalho do laboratório de duplo clique, que abre a TUI
# unificada (menu com luzes ao vivo). Remove os atalhos antigos individuais
# se ainda existirem. Pode rodar mais de uma vez.
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

Write-Host ''
Write-Host '  Duplo clique nele abre o painel de luzes com o menu (ligar/desligar/' -ForegroundColor Yellow
Write-Host '  checar/abrir painel/enderecos/firewall/backup/zerar). ESC sai.' -ForegroundColor Yellow
