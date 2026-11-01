# Asistent engine on Windows: venv in %LOCALAPPDATA%\Asistent + Startup shortcut (hidden window).
# Run: powershell -ExecutionPolicy Bypass -File scripts\setup_win.ps1
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
$App = Join-Path $env:LOCALAPPDATA "Asistent"
New-Item -ItemType Directory -Force -Path (Join-Path $App "logs") | Out-Null

$py = $null
try { $py = (& py -3.12 -c "import sys; print(sys.executable)") } catch {}
if (-not $py) { Write-Host "Нужен е Python 3.12: winget install Python.Python.3.12"; exit 1 }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "Нужен е FFmpeg в PATH: winget install Gyan.FFmpeg (после рестартирай терминала)"; exit 1
}

$venvPy = Join-Path $App "venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) { & $py -m venv (Join-Path $App "venv") }
& $venvPy -m pip install -q --upgrade pip
& $venvPy -m pip install -q -r (Join-Path $Repo "requirements.txt")

$pyw = Join-Path $App "venv\Scripts\pythonw.exe"
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "Asistent engine.lnk"
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = $pyw
$s.Arguments = '"' + (Join-Path $Repo "engine\run_engine.py") + '"'
$s.WorkingDirectory = $App
$s.WindowStyle = 7
$s.Save()

Start-Process -FilePath $pyw -ArgumentList $s.Arguments -WorkingDirectory $App -WindowStyle Hidden
# the first start compiles and loads SciPy, which can take ~20 s
for ($i = 0; $i -lt 40; $i++) {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:47390/status" -Headers @{ "X-Asistent" = "1" } -TimeoutSec 2
    if ($r.app -eq "asistent") { Write-Host "Asistent engine работи (стартира се сам при вход)."; exit 0 }
  } catch {}
  Start-Sleep -Seconds 1
}
Write-Host "Engine-ът не отговаря. Виж $App\logs\"; exit 1
