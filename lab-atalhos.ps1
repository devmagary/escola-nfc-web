# =============================================================================
# lab-atalhos.ps1 — cria atalhos do laboratório na área de trabalho do Windows
# ---------------------------------------------------------------------------
# Cada atalho abre um dos utilitários da pasta do projeto (Menu/Ligar/Desligar/
# Checar) com o diretório de trabalho correto. Pode rodar mais de uma vez:
# apenas recria os mesmos atalhos.
# =============================================================================
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

$script:Projeto = Split-Path -Parent $MyInvocation.MyCommand.Path

$areaDeTrabalho = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

$atalhos = @(
  @{ Nome = 'Servidor NFC - Menu';      Arquivo = 'lab.cmd' }
  @{ Nome = 'Servidor NFC - LIGAR';     Arquivo = 'lab-ligar.cmd' }
  @{ Nome = 'Servidor NFC - DESLIGAR';  Arquivo = 'lab-desligar.cmd' }
  @{ Nome = 'Servidor NFC - CHECAR';    Arquivo = 'lab-checar.cmd' }
)

foreach ($atalho in $atalhos) {
  $caminhoDoAtalho = Join-Path $areaDeTrabalho ($atalho.Nome + '.lnk')
  $link = $shell.CreateShortcut($caminhoDoAtalho)
  $link.TargetPath = Join-Path $script:Projeto $atalho.Arquivo
  $link.WorkingDirectory = $script:Projeto
  $link.Description = 'Acesso Escolar NFC - laboratorio offline (Docker)'
  $link.Save()
  Write-Host ("  Atalho criado: " + $atalho.Nome) -ForegroundColor Green
}

Write-Host ''
Write-Host '  Pronto! Olhe a área de trabalho. Se algum atalho não aparecer,' -ForegroundColor Yellow
Write-Host '  clique com o botão direito na área de trabalho e escolha Atualizar.' -ForegroundColor Yellow
