#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the PopDAM Windows Render Agent as a Scheduled Task
  that runs in an interactive desktop session (required for
  Adobe Illustrator COM automation).

.DESCRIPTION
  Creates a Scheduled Task "PopDAM Windows Render Agent" that:
    - Triggers at logon for the specified user
    - Runs only when the user is logged on (interactive session)
    - Restarts on failure (up to 3 times, 60s delay)
    - Runs the launcher wrapper (handles drive mapping before starting agent)
    - Stores logs in %ProgramData%\PopDAM\logs\

.PARAMETER InstallDir
  Path to the agent installation directory.
  Default: C:\Program Files\PopDAM\WindowsAgent

.PARAMETER Username
  The Windows user account under which the task runs.
  Default: current user ($env:USERNAME)

.EXAMPLE
  .\install-scheduled-task.ps1
  .\install-scheduled-task.ps1 -InstallDir "D:\PopDAM\WindowsAgent"
  .\install-scheduled-task.ps1 -Username "DOMAIN\renderuser"
#>

param(
    [string]$InstallDir = "C:\Program Files\PopDAM\WindowsAgent",
    [string]$Username = $env:USERNAME
)

$ErrorActionPreference = "Stop"
$TaskName = "PopDAM Windows Render Agent"

# ── Validate install directory ──────────────────────────────────

$LauncherBat = Join-Path $InstallDir "popdam-launcher.bat"
$NodeExe = Join-Path $InstallDir "node.exe"
$EntryPoint = Join-Path $InstallDir "dist\index.js"

if (-not (Test-Path $NodeExe)) {
    Write-Error "node.exe not found at $NodeExe — is the agent installed?"
    exit 1
}
if (-not (Test-Path $EntryPoint)) {
    Write-Error "dist\index.js not found at $EntryPoint — is the agent built?"
    exit 1
}
if (-not (Test-Path $LauncherBat)) {
    Write-Warning "popdam-launcher.bat not found at $LauncherBat — drive mapping will not work."
    Write-Host "Falling back to direct node.exe execution." -ForegroundColor Yellow
    $LauncherBat = $null
}

# ── Ensure ProgramData directories exist ────────────────────────

$ConfigDir = Join-Path $env:ProgramData "PopDAM"
$LogDir = Join-Path $ConfigDir "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# ── Remove existing task if present ─────────────────────────────

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Removing existing scheduled task '$TaskName'..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# ── Remove legacy NSSM service if present ───────────────────────

$legacyService = Get-Service -Name "PopDAMWindowsAgent" -ErrorAction SilentlyContinue
if ($legacyService) {
    Write-Host ""
    Write-Host "WARNING: Legacy Windows Service 'PopDAMWindowsAgent' detected." -ForegroundColor Red
    Write-Host "Services cannot use Illustrator COM automation reliably." -ForegroundColor Red
    Write-Host "Stopping and removing legacy service..." -ForegroundColor Yellow
    Stop-Service -Name "PopDAMWindowsAgent" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $nssm = Get-Command nssm -ErrorAction SilentlyContinue
    if ($nssm) {
        & nssm remove PopDAMWindowsAgent confirm
    } else {
        & sc.exe delete PopDAMWindowsAgent
    }
    Write-Host "Legacy service removed." -ForegroundColor Green
    Write-Host ""
}

# ── Create the scheduled task ───────────────────────────────────

Write-Host "Creating scheduled task '$TaskName'..." -ForegroundColor Green
Write-Host "  Install dir : $InstallDir"
Write-Host "  User        : $Username"
Write-Host "  Config dir  : $ConfigDir"
Write-Host "  Log dir     : $LogDir"

# Action: run launcher.bat (or node.exe directly as fallback)
if ($LauncherBat) {
    $action = New-ScheduledTaskAction `
        -Execute $LauncherBat `
        -WorkingDirectory $InstallDir
    Write-Host "  Launcher    : $LauncherBat"
} else {
    $action = New-ScheduledTaskAction `
        -Execute $NodeExe `
        -Argument "dist\index.js" `
        -WorkingDirectory $InstallDir
    Write-Host "  Launcher    : $NodeExe dist\index.js (direct)"
}

# Trigger: at logon for the specified user
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $Username

# Settings: restart on failure, don't stop on idle, run indefinitely
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -DontStopOnIdleEnd `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Seconds 60) `
    -ExecutionTimeLimit (New-TimeSpan -Days 0) `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew

# Principal: run only when user is logged on (interactive session)
$principal = New-ScheduledTaskPrincipal `
    -UserId $Username `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "PopDAM Windows Render Agent — renders AI/PSD thumbnails using Adobe Illustrator. Requires interactive desktop session for COM automation." `
    -Force

# ── Verify ──────────────────────────────────────────────────────

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Write-Host ""
    Write-Host "SUCCESS: Scheduled task '$TaskName' created." -ForegroundColor Green
    Write-Host ""
    Write-Host "The agent will start automatically when '$Username' logs in."
    Write-Host "Logs will be written to: $LogDir"
    Write-Host ""
    Write-Host "To start it now:  Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "To check status:  Get-ScheduledTask -TaskName '$TaskName' | Format-List"
    Write-Host ""
} else {
    Write-Error "Failed to create scheduled task."
    exit 1
}
