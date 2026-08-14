# Allows the phone (same Wi‑Fi) to open https://<LAN>:3443.
# Self-elevates once via UAC.
$ErrorActionPreference = "Stop"
$ruleName = "Logisoft HireOS secondary camera HTTPS"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
  Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $PSCommandPath
  )
  exit $LASTEXITCODE
}

$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
  netsh advfirewall firewall set rule name="$ruleName" new profile=any | Out-Null
  Write-Host "Firewall rule updated (all profiles): $ruleName"
  exit 0
}

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 3443 `
  -Profile Domain,Private,Public `
  -Description "Logisoft HireOS secondary-camera QR (host TLS proxy)" | Out-Null

Write-Host "Allowed inbound TCP 3443 for the secondary camera phone."
