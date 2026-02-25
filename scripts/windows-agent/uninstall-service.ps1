#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Removes the PopDAM Windows Agent (both legacy service and scheduled task).

.DESCRIPTION
  Stops and removes:
  1. The "PopDAM Windows Render Agent" Scheduled Task (current install method)
  2. The "PopDAMWindowsAgent" Windows Service via NSSM (legacy install method)

  Optionally removes configuration from %ProgramData%\PopDAM.

.PARAMETER RemoveConfig
  If specified, also removes agent configuration and logs from
  %ProgramData%\PopDAM. Without this flag, config is preserved
  for future reinstalls.

.EXAMPLE
  .\uninstall-service.ps1
  .\uninstall-service.ps1 -RemoveConfig
#>

param(
    [switch]$RemoveConfig
)

$ErrorActionPreference = "Stop"
$ServiceName = "PopDAMWindowsAgent"
$TaskName = "PopDAM Windows Render Agent"

# ── Remove Scheduled Task (current method) ──────────────────────

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Write-Host "Stopping scheduled task '$TaskName'..." -ForegroundColor Yellow
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "Removing scheduled task '$TaskName'..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Scheduled task removed." -ForegroundColor Green
} else {
    Write-Host "Scheduled task '$TaskName' not found." -ForegroundColor DarkGray
}

# ── Remove legacy NSSM service ──────────────────────────────────

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -eq "Running") {
        Write-Host "Stopping legacy service '$ServiceName'..." -ForegroundColor Yellow
        Stop-Service -Name $ServiceName -Force
        Start-Sleep -Seconds 2
    }

    $nssm = Get-Command nssm -ErrorAction SilentlyContinue
    if ($nssm) {
        Write-Host "Removing legacy service via NSSM..." -ForegroundColor Yellow
        & nssm remove $ServiceName confirm
    } else {
        Write-Host "Removing legacy service via sc.exe..." -ForegroundColor Yellow
        & sc.exe delete $ServiceName
    }

    Start-Sleep -Seconds 1
    $check = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($check) {
        Write-Warning "Legacy service may still be registered (pending reboot)."
    } else {
        Write-Host "Legacy service removed." -ForegroundColor Green
    }
} else {
    Write-Host "Legacy service '$ServiceName' not found." -ForegroundColor DarkGray
}

# ── Optionally remove config ────────────────────────────────────

$ConfigDir = Join-Path $env:ProgramData "PopDAM"
if ($RemoveConfig) {
    if (Test-Path $ConfigDir) {
        Write-Host "Removing configuration at $ConfigDir..." -ForegroundColor Yellow
        Remove-Item -Recurse -Force $ConfigDir
        Write-Host "Configuration removed." -ForegroundColor Green
    }
} else {
    if (Test-Path $ConfigDir) {
        Write-Host ""
        Write-Host "Configuration preserved at $ConfigDir" -ForegroundColor Cyan
        Write-Host "To remove it too, run: .\uninstall-service.ps1 -RemoveConfig" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "SUCCESS: PopDAM Windows Agent uninstalled." -ForegroundColor Green
Write-Host ""
