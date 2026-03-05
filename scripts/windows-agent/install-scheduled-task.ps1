#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the PopDAM Windows Render Agent as a Scheduled Task
  that runs in an interactive desktop session (required for
  Adobe Illustrator COM automation).

.DESCRIPTION
  Performs a preflight scrub before installation:
    - Removes existing scheduled task if present
    - Removes legacy NSSM service if present
    - Cleans stale temp artifacts (popdam-gs-*, popdam-ink-*, popdam-im-*, magick-*)
    - Recreates config/log directories cleanly

  Then creates a Scheduled Task "PopDAM Windows Render Agent" that:
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

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  PopDAM Windows Agent — Install                         ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Preflight Scrub ─────────────────────────────────────────────────

Write-Host "── Preflight Scrub ──" -ForegroundColor Yellow

# Remove existing scheduled task
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "  Stopping and removing existing task '$TaskName'..." -ForegroundColor Yellow
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "  Existing task removed." -ForegroundColor Green
} else {
    Write-Host "  No existing task found." -ForegroundColor DarkGray
}

# Remove legacy NSSM service
$legacyService = Get-Service -Name "PopDAMWindowsAgent" -ErrorAction SilentlyContinue
if ($legacyService) {
    Write-Host "  Legacy service 'PopDAMWindowsAgent' detected — removing..." -ForegroundColor Yellow
    Stop-Service -Name "PopDAMWindowsAgent" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $nssm = Get-Command nssm -ErrorAction SilentlyContinue
    if ($nssm) {
        & nssm remove PopDAMWindowsAgent confirm 2>&1 | Out-Null
    } else {
        & sc.exe delete PopDAMWindowsAgent 2>&1 | Out-Null
    }
    Write-Host "  Legacy service removed." -ForegroundColor Green
} else {
    Write-Host "  No legacy service found." -ForegroundColor DarkGray
}

# Clean stale temp artifacts
$tempDir = $env:LOCALAPPDATA + "\Temp"
if (-not (Test-Path $tempDir)) { $tempDir = $env:TEMP }
$dirPrefixes = @("popdam-gs-*", "popdam-ink-*", "popdam-im-*")
$filePrefixes = @("magick-*")
$cleanedCount = 0

foreach ($prefix in $dirPrefixes) {
    $matches = Get-ChildItem -Path $tempDir -Directory -Filter $prefix -ErrorAction SilentlyContinue
    foreach ($d in $matches) {
        try {
            Remove-Item -Recurse -Force $d.FullName -ErrorAction Stop
            $cleanedCount++
        } catch { <# locked, ignore #> }
    }
}
foreach ($prefix in $filePrefixes) {
    $matches = Get-ChildItem -Path $tempDir -File -Filter $prefix -ErrorAction SilentlyContinue
    foreach ($f in $matches) {
        try {
            Remove-Item -Force $f.FullName -ErrorAction Stop
            $cleanedCount++
        } catch { <# locked, ignore #> }
    }
}
if ($cleanedCount -gt 0) {
    Write-Host "  Cleaned $cleanedCount stale temp items." -ForegroundColor Green
} else {
    Write-Host "  No stale temp artifacts." -ForegroundColor DarkGray
}

Write-Host ""

# ── Validate install directory ──────────────────────────────────

Write-Host "── Validation ──" -ForegroundColor Yellow

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
    Write-Host "  Falling back to direct node.exe execution." -ForegroundColor Yellow
    $LauncherBat = $null
} else {
    Write-Host "  All required files found." -ForegroundColor Green
}

# ── Ensure ProgramData directories exist (clean) ────────────────

$ConfigDir = Join-Path $env:ProgramData "PopDAM"
$LogDir = Join-Path $ConfigDir "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Write-Host "  Config dir: $ConfigDir"
Write-Host "  Log dir:    $LogDir"

Write-Host ""

# ── Create the scheduled task ───────────────────────────────────

Write-Host "── Task Registration ──" -ForegroundColor Yellow
Write-Host "  Install dir : $InstallDir"
Write-Host "  User        : $Username"

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
    Write-Host "  To start now  : Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "  To verify     : .\verify-agent.ps1"
    Write-Host "  Logs          : $LogDir"
    Write-Host ""
} else {
    Write-Error "Failed to create scheduled task."
    exit 1
}
