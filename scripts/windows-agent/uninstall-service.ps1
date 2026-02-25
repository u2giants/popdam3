#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Removes the legacy PopDAM Windows Agent NSSM service.

.DESCRIPTION
  Stops and removes the "PopDAMWindowsAgent" Windows Service
  that was previously installed via NSSM. This is necessary
  because Illustrator COM automation does not work in
  non-interactive service sessions.

  After running this script, install the agent as a Scheduled
  Task using install-scheduled-task.ps1.

.EXAMPLE
  .\uninstall-service.ps1
#>

$ErrorActionPreference = "Stop"
$ServiceName = "PopDAMWindowsAgent"

# ── Check if service exists ─────────────────────────────────────

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "Service '$ServiceName' not found — nothing to remove." -ForegroundColor Green
    exit 0
}

# ── Stop service if running ─────────────────────────────────────

if ($svc.Status -eq "Running") {
    Write-Host "Stopping service '$ServiceName'..." -ForegroundColor Yellow
    Stop-Service -Name $ServiceName -Force
    Start-Sleep -Seconds 2
}

# ── Try NSSM removal first ──────────────────────────────────────

$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssm) {
    Write-Host "Removing service via NSSM..." -ForegroundColor Yellow
    & nssm remove $ServiceName confirm
} else {
    # Fallback: sc.exe
    Write-Host "NSSM not found — removing via sc.exe..." -ForegroundColor Yellow
    & sc.exe delete $ServiceName
}

Start-Sleep -Seconds 1

# ── Verify ──────────────────────────────────────────────────────

$check = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($check) {
    Write-Warning "Service may still be registered (pending reboot). Check manually."
} else {
    Write-Host ""
    Write-Host "SUCCESS: Service '$ServiceName' removed." -ForegroundColor Green
    Write-Host "Now install the Scheduled Task instead:"
    Write-Host "  .\install-scheduled-task.ps1" -ForegroundColor Cyan
    Write-Host ""
}
