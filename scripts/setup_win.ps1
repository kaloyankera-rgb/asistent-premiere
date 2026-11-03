# Asistent on Windows, from this folder (the repo or an unpacked release): Python environment, the files in
# %LOCALAPPDATA%\Asistent\current (the engine runs from there), the host, the font, the panel, and a Startup shortcut
# that starts the engine at login (hidden window). Safe to run again. After the first install the panel updates itself.
#   powershell -ExecutionPolicy Bypass -File scripts\setup_win.ps1 [-Subtitles] [-NoPanel]
#   -Subtitles also installs the speech recognition packages (faster-whisper; CUDA wheels for an NVIDIA GPU).
param([switch]$Subtitles, [switch]$NoPanel)
$ErrorActionPreference = "Stop"
$Src = Split-Path -Parent $PSScriptRoot
$App = Join-Path $env:LOCALAPPDATA "Asistent"
New-Item -ItemType Directory -Force -Path (Join-Path $App "logs") | Out-Null

$py = $null
try { $py = (& py -3.12 -c "import sys; print(sys.executable)") } catch {}
if (-not $py) { Write-Host "Python 3.12 is needed: winget install Python.Python.3.12"; exit 1 }
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "FFmpeg is needed in PATH: winget install Gyan.FFmpeg (then open a new window and run this again)"; exit 1
}

$venvPy = Join-Path $App "venv\Scripts\python.exe"
if (-not (Test-Path $venvPy)) { & $py -m venv (Join-Path $App "venv") }
& $venvPy -m pip install -q --upgrade pip
& $venvPy -m pip install -q -r (Join-Path $Src "requirements.txt")
if ($LASTEXITCODE) { Write-Host "pip could not install requirements.txt"; exit 1 }
# speech recognition for subtitles; an install that already has it keeps it up to date
# (Windows PowerShell 5.1 turns a native command's stderr into an error under "Stop": hence the try)
$hasAsr = $false
try { & $venvPy -c "import faster_whisper" 2>&1 | Out-Null; $hasAsr = ($LASTEXITCODE -eq 0) } catch { $hasAsr = $false }
if ($Subtitles -or $hasAsr) {
  & $venvPy -m pip install -q -r (Join-Path $Src "requirements-asr.txt")
  if ($LASTEXITCODE) { Write-Host "pip could not install requirements-asr.txt"; exit 1 }
  # cuBLAS/cuDNN for large-v3 on the GPU; without them the engine falls back to the CPU (int8)
  if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { & $venvPy -m pip install -q nvidia-cublas-cu12 nvidia-cudnn-cu12 }
  # Bulgarian word list (LibreOffice dictionaries/bg_BG, GPL v2; see LICENSES.md): not part of the repository
  $lex = Join-Path $App "models\lexicon"
  New-Item -ItemType Directory -Force -Path $lex | Out-Null
  foreach ($f in @("bg_BG.dic", "bg_BG.aff", "COPYING")) {
    $out = Join-Path $lex $f
    if (-not (Test-Path $out) -or (Get-Item $out).Length -eq 0) {
      Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/bg_BG/$f" -OutFile $out
    }
  }
}

# stop a running engine, so the files under current\ can be replaced
Get-CimInstance Win32_Process -Filter "Name = 'pythonw.exe' OR Name = 'python.exe'" |
  Where-Object { $_.CommandLine -like "*run_engine.py*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

# the files into $App\current, the host into Premiere's CEP folder, the font, the panel (engine\asistent\install.py)
$env:PYTHONPATH = Join-Path $Src "engine"
$installArgs = @("-m", "asistent.install", "--src", $Src)
if ($NoPanel) { $installArgs += "--no-panel" }
& $venvPy @installArgs
if ($LASTEXITCODE) { exit 1 }
Remove-Item Env:\PYTHONPATH

$pyw = Join-Path $App "venv\Scripts\pythonw.exe"
$engine = Join-Path $App "current\engine\run_engine.py"
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "Asistent engine.lnk"
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = $pyw
$s.Arguments = '"' + $engine + '"'
$s.WorkingDirectory = $App
$s.WindowStyle = 7
$s.Save()

Start-Process -FilePath $pyw -ArgumentList $s.Arguments -WorkingDirectory $App -WindowStyle Hidden
# the first start compiles and loads SciPy, which can take ~20 s
for ($i = 0; $i -lt 40; $i++) {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:47390/status" -Headers @{ "X-Asistent" = "1" } -TimeoutSec 2
    if ($r.app -eq "asistent") {
      Write-Host "Asistent engine is running (it starts by itself at login). Later versions install from the panel's Update button."
      exit 0
    }
  } catch {}
  Start-Sleep -Seconds 1
}
Write-Host "The engine does not answer. See $App\logs\"; exit 1
