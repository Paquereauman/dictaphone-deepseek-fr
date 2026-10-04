# Post-install setup run by Dictaphone-Setup.exe (also usable on its own).
# Installs Python if needed, creates the virtual environment, installs the
# dependencies, downloads the Whisper model, enables silent auto-start and
# opens Chrome on the extension page.
[CmdletBinding()]
param([string]$Root = (Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Dictaphone FR - setup'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:PYTHONUTF8 = '1'
Set-Location $Root

function Step($n, $t) { Write-Host ""; Write-Host "[$n/5] $t" -ForegroundColor Cyan }
function Fail($m) { Write-Host ""; Write-Host "ERROR: $m" -ForegroundColor Red; Read-Host "Press Enter to close"; exit 1 }

function Find-Python {
    foreach ($c in @('py -3', 'python', 'python3')) {
        try {
            $parts = $c.Split(' ')
            $exe = Get-Command $parts[0] -ErrorAction Stop
            $args2 = @() + $parts[1..($parts.Length)] + @('-c', 'import sys; print(sys.executable if sys.version_info>=(3,10) else "")')
            $out = & $exe.Source @args2 2>$null
            if ($out -and (Test-Path $out.Trim())) { return $out.Trim() }
        } catch {}
    }
    foreach ($p in Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending) {
        return $p.FullName
    }
    return $null
}

Step 1 'Looking for Python 3.10+'
$py = Find-Python
if (-not $py) {
    Write-Host 'Python not found: installing Python 3.12 for your user account (no admin needed)...'
    $tmp = Join-Path $env:TEMP 'python-3.12.8-amd64.exe'
    try {
        Invoke-WebRequest 'https://www.python.org/ftp/python/3.12.8/python-3.12.8-amd64.exe' -OutFile $tmp -UseBasicParsing
        Start-Process $tmp -ArgumentList '/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_test=0' -Wait
    } catch { Fail "Could not install Python automatically. Install it from https://www.python.org/downloads/ and run this setup again." }
    $py = Find-Python
    if (-not $py) { Fail 'Python was installed but could not be found. Close this window and run the setup again.' }
}
Write-Host "Python: $py" -ForegroundColor Green

Step 2 'Creating the isolated environment (.venv)'
if (-not (Test-Path '.venv\Scripts\python.exe')) {
    & $py -m venv .venv
    if ($LASTEXITCODE -ne 0) { Fail 'Could not create the virtual environment.' }
}
$vpy = Join-Path $Root '.venv\Scripts\python.exe'

Step 3 'Installing speech recognition and CUDA libraries (about 1.5 GB, a few minutes)'
& $vpy -m pip install --upgrade pip setuptools wheel --quiet
& $vpy -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { Fail 'Installing the dependencies failed. Check your internet connection and run the setup again.' }

Step 4 'Downloading the Whisper model "small" (about 480 MB)'
& $vpy -c "import sys; sys.path.insert(0,'.'); from server.stt import SttEngine; e=SttEngine('small'); e.ensure('small', warmup=False); print('Model OK')"
if ($LASTEXITCODE -ne 0) { Write-Host 'The model will be downloaded on first start instead.' -ForegroundColor Yellow }

Step 5 'Enabling silent auto-start and launching the server'
try { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'outils\demarrage-auto.ps1') | Out-Null } catch {}
Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $Root 'demarrer-serveur-silencieux.vbs') + '"') -WindowStyle Hidden

Write-Host ""
Write-Host "Installation finished." -ForegroundColor Green
Write-Host ""
Write-Host "LAST STEP (Chrome requires you to do this once yourself):" -ForegroundColor Yellow
Write-Host "  1. In the page that opens, switch ON 'Developer mode' (top right)."
Write-Host "  2. Click 'Load unpacked' and pick the folder that Explorer just opened:"
Write-Host "     $Root\extension"
Write-Host ""
Set-Clipboard -Value (Join-Path $Root 'extension') -ErrorAction SilentlyContinue
Write-Host "  (the folder path was copied to your clipboard)" -ForegroundColor DarkGray

$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($chrome) { Start-Process $chrome 'chrome://extensions' }
Start-Process explorer.exe ('"' + (Join-Path $Root 'extension') + '"')
Read-Host "Press Enter to close this window"
