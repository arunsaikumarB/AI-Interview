# Pilot packaging setup — models, seed, embeddings.
# Prereq: Docker Desktop running.
# Usage:  .\scripts\setup-pilot.ps1
#         .\scripts\setup-pilot.ps1 -SkipBuild

param(
  [switch]$SkipBuild,
  [switch]$SkipSeed,
  [switch]$SkipEmbed
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$DotEnv = Join-Path $Root ".env"
if (-not (Test-Path $DotEnv)) {
  Copy-Item (Join-Path $Root ".env.example") $DotEnv
  Write-Host "Created .env from example — set AUTH_SECRET to a long random value before use."
}

$authLine = Get-Content $DotEnv -Encoding utf8 |
  Where-Object { $_.TrimStart([char]0xFEFF).Trim() -match '^\s*AUTH_SECRET=(.+)$' } |
  Select-Object -First 1
$authVal = $null
if ($authLine -match '^\s*AUTH_SECRET=(.+)$') {
  $authVal = $Matches[1].Trim().Trim('"').Trim("'")
}
if (
  [string]::IsNullOrWhiteSpace($authVal) -or
  $authVal -eq "replace-with-a-long-random-secret" -or
  $authVal -eq "change-me-to-a-long-random-string"
) {
  throw "AUTH_SECRET in .env is missing or still a placeholder. Set a long random secret (single source for host + Docker)."
}

$EnvFile = Join-Path $Root ".env.docker"
if (-not (Test-Path $EnvFile)) {
  Copy-Item (Join-Path $Root ".env.docker.example") $EnvFile
  Write-Host "Created .env.docker from example (ports/services only; AUTH_SECRET comes from .env)."
}

# Strip legacy AUTH_SECRET from .env.docker so it cannot override .env
if (Test-Path $EnvFile) {
  $dockerLines = Get-Content $EnvFile -Encoding utf8
  $filtered = $dockerLines | Where-Object { $_.TrimStart([char]0xFEFF).Trim() -notmatch '^\s*AUTH_SECRET=' }
  if ($filtered.Count -ne $dockerLines.Count) {
    Set-Content -Path $EnvFile -Value $filtered -Encoding utf8
    Write-Host "Removed AUTH_SECRET from .env.docker (use .env only)."
  }
}

$ChatModel = "qwen2.5:7b"
$EmbedModel = "nomic-embed-text"
if (Test-Path $EnvFile) {
  Get-Content $EnvFile -Encoding utf8 | ForEach-Object {
    $line = $_.Trim().TrimStart([char]0xFEFF)
    if ($line -match '^\s*OLLAMA_CHAT_MODEL=(.+)$') { $ChatModel = $Matches[1].Trim().Trim('"') }
    if ($line -match '^\s*OLLAMA_EMBED_MODEL=(.+)$') { $EmbedModel = $Matches[1].Trim().Trim('"') }
  }
}
# Prefer chat/embed from .env when present
Get-Content $DotEnv -Encoding utf8 | ForEach-Object {
  $line = $_.Trim().TrimStart([char]0xFEFF)
  if ($line -match '^\s*OLLAMA_CHAT_MODEL=(.+)$') { $ChatModel = $Matches[1].Trim().Trim('"') }
  if ($line -match '^\s*OLLAMA_EMBED_MODEL=(.+)$') { $EmbedModel = $Matches[1].Trim().Trim('"') }
}
if ([string]::IsNullOrWhiteSpace($ChatModel)) { $ChatModel = "qwen2.5:7b" }
if ([string]::IsNullOrWhiteSpace($EmbedModel)) { $EmbedModel = "nomic-embed-text" }

$ComposeEnv = @("--env-file", ".env.docker", "--env-file", ".env")

Write-Host "==> Starting stack (postgres + ollama + speech + app)"
if ($SkipBuild) {
  docker compose @ComposeEnv up -d
} else {
  docker compose @ComposeEnv up -d --build
}

Write-Host "==> Waiting for app health…"
$ok = $false
for ($i = 1; $i -le 60; $i++) {
  try {
    $h = Invoke-RestMethod "http://localhost:3000/api/health" -TimeoutSec 5
    if ($h.ok -and $h.database.ok) { $ok = $true; break }
  } catch { }
  Start-Sleep -Seconds 3
}
if (-not $ok) { throw "App health check failed — see: docker compose logs app" }

Write-Host "==> Pulling Ollama models ($ChatModel, $EmbedModel)"
docker compose @ComposeEnv exec -T ollama ollama pull $EmbedModel
docker compose @ComposeEnv exec -T ollama ollama pull $ChatModel

if (-not $SkipSeed) {
  Write-Host "==> Seeding database"
  docker compose @ComposeEnv exec -T app node dist/docker/seed.cjs
}

if (-not $SkipEmbed) {
  Write-Host "==> Backfilling candidate embeddings"
  docker compose @ComposeEnv exec -T `
    -e DATABASE_URL="postgresql://ats:ats_local_dev@postgres:5432/ai_recruitment_os?schema=public" `
    -e OLLAMA_LOCAL_URL="http://ollama:11434" `
    -e OLLAMA_EMBED_MODEL="$EmbedModel" `
    app node dist/docker/backfill-embeddings.cjs
}

Write-Host ""
Write-Host "Pilot stack ready:"
Write-Host "  App:     http://localhost:3000"
Write-Host "  Health:  http://localhost:3000/api/health"
Write-Host "  Login:   recruiter@local.dev / password123  (change after seed)"
Write-Host "  Speech:  http://localhost:8001/health"
Write-Host "  Ollama:  http://localhost:11434"
Write-Host ""
Write-Host "MediaPipe is vendored at image build (npm run setup:mediapipe)."
Write-Host "Piper voice is vendored in the speech image build."
