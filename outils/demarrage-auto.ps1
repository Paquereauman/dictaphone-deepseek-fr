# Active ou desactive le demarrage automatique du serveur de dictee
# a l'ouverture de session Windows.
#
#   .\demarrage-auto.ps1              -> active
#   .\demarrage-auto.ps1 -Desactiver  -> desactive
#   .\demarrage-auto.ps1 -Statut      -> affiche l'etat

[CmdletBinding()]
param(
    [switch]$Desactiver,
    [switch]$Statut
)

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot          # dossier dictaphone
$vbs     = Join-Path $root 'demarrer-serveur-silencieux.vbs'
$ico     = Join-Path $root 'outils\dictaphone.ico'
$startup = [Environment]::GetFolderPath('Startup')
$lnk     = Join-Path $startup 'Dictaphone FR (serveur).lnk'

function Show-Statut {
    if (Test-Path $lnk) {
        Write-Host "Demarrage automatique : ACTIF" -ForegroundColor Green
        Write-Host "  Raccourci : $lnk"
    } else {
        Write-Host "Demarrage automatique : INACTIF" -ForegroundColor Yellow
    }
    try {
        $h = Invoke-RestMethod 'http://127.0.0.1:8765/health' -TimeoutSec 2
        $etat = if ($h.model_loaded) { "modele charge ($($h.model) / $($h.device))" } else { "modele non charge (1re dictee ~2 s)" }
        Write-Host "Serveur              : EN MARCHE - $etat" -ForegroundColor Green
    } catch {
        Write-Host "Serveur              : ARRETE" -ForegroundColor Yellow
    }
}

if ($Statut) { Show-Statut; return }

if (-not (Test-Path $vbs)) { throw "Fichier introuvable : $vbs" }

if ($Desactiver) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force }
    Write-Host "Demarrage automatique desactive." -ForegroundColor Yellow
    Show-Statut
    return
}

if (-not (Test-Path (Join-Path $root '.venv\Scripts\pythonw.exe'))) {
    throw "Environnement Python absent. Lance install.bat d'abord."
}

$wsh = New-Object -ComObject WScript.Shell
$sc  = $wsh.CreateShortcut($lnk)
$sc.TargetPath       = Join-Path $env:SystemRoot 'System32\wscript.exe'
$sc.Arguments        = '"' + $vbs + '"'
$sc.WorkingDirectory = $root
$sc.Description      = 'Serveur de dictee vocale locale (Dictaphone FR)'
# Windows n'affiche pas les .png comme icone de raccourci : il faut un .ico.
if (Test-Path $ico) { $sc.IconLocation = $ico }
$sc.Save()

Write-Host "Demarrage automatique active." -ForegroundColor Green
Show-Statut
