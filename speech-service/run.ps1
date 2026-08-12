# Start local speech service (Windows)
Set-Location $PSScriptRoot
if (-not (Test-Path .\.venv\Scripts\python.exe)) {
  python -m venv .venv
  .\.venv\Scripts\pip install -r requirements.txt
}
if (-not (Test-Path .\voices\en_US-lessac-medium.onnx)) {
  Write-Host "Downloading Piper voice…"
  .\.venv\Scripts\python .\scripts\download_voice.py
}
.\.venv\Scripts\python .\run.py
