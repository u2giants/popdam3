<#
.SYNOPSIS
  Diagnostic script for the PopDAM Windows Render Agent.

.DESCRIPTION
  Checks and reports:
    - Scheduled task: exists, state, action, principal, triggers, last result
    - Install directory: exists and key files present
    - Config path: agent-config.json exists and is readable
    - Log paths: exist and last 20 lines of each log
    - Legacy service: warns if still present

.EXAMPLE
  .\verify-agent.ps1
#>

$TaskName = "PopDAM Windows Render Agent"
$InstallDir = "C:\Program Files\PopDAM\WindowsAgent"
$ConfigDir = Join-Path $env:ProgramData "PopDAM"
$LogDir = Join-Path $ConfigDir "logs"

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  PopDAM Windows Agent — Verification                    ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

$allOk = $true

# ── 1. Scheduled Task ──────────────────────────────────────────────

Write-Host "── Scheduled Task ──" -ForegroundColor Yellow
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    $info = $task | Get-ScheduledTaskInfo -ErrorAction SilentlyContinue
    Write-Host "  Status        : $($task.State)" -ForegroundColor $(if ($task.State -eq "Running") { "Green" } elseif ($task.State -eq "Ready") { "Green" } else { "Yellow" })
    Write-Host "  Action        : $($task.Actions[0].Execute) $($task.Actions[0].Arguments)"
    Write-Host "  Working Dir   : $($task.Actions[0].WorkingDirectory)"
    Write-Host "  Principal     : $($task.Principal.UserId) (LogonType: $($task.Principal.LogonType), RunLevel: $($task.Principal.RunLevel))"

    if ($task.Triggers) {
        foreach ($trigger in $task.Triggers) {
            Write-Host "  Trigger       : $($trigger.CimClass.CimClassName -replace 'MSFT_Task','' -replace 'Trigger','') — Enabled: $($trigger.Enabled)"
        }
    }

    if ($info) {
        $lastResult = $info.LastTaskResult
        $resultColor = if ($lastResult -eq 0) { "Green" } elseif ($lastResult -eq 267009) { "DarkGray" } else { "Red" }
        $resultText = switch ($lastResult) {
            0        { "0 (SUCCESS)" }
            267009   { "267009 (task has not run yet)" }
            267014   { "267014 (task was terminated by user)" }
            1        { "1 (GENERIC ERROR — check logs)" }
            default  { "$lastResult (see https://docs.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-error-and-success-constants)" }
        }
        Write-Host "  Last Result   : $resultText" -ForegroundColor $resultColor
        if ($info.LastRunTime -and $info.LastRunTime -ne [DateTime]::MinValue) {
            Write-Host "  Last Run      : $($info.LastRunTime)"
        }
        if ($info.NextRunTime -and $info.NextRunTime -ne [DateTime]::MinValue) {
            Write-Host "  Next Run      : $($info.NextRunTime)"
        }
    }
} else {
    Write-Host "  NOT FOUND" -ForegroundColor Red
    Write-Host "  Run install-scheduled-task.ps1 to create it." -ForegroundColor DarkGray
    $allOk = $false
}

Write-Host ""

# ── 2. Install Directory ──────────────────────────────────────────

Write-Host "── Install Directory ──" -ForegroundColor Yellow
if (Test-Path $InstallDir) {
    Write-Host "  Path          : $InstallDir" -ForegroundColor Green
    $checkFiles = @("node.exe", "package.json", "popdam-launcher.bat", "dist\index.js")
    foreach ($f in $checkFiles) {
        $fp = Join-Path $InstallDir $f
        if (Test-Path $fp) {
            $size = (Get-Item $fp).Length
            Write-Host "  ✓ $f ($([math]::Round($size / 1KB, 1)) KB)" -ForegroundColor Green
        } else {
            Write-Host "  ✗ $f — MISSING" -ForegroundColor Red
            $allOk = $false
        }
    }
    # Check .env
    $envFile = Join-Path $InstallDir ".env"
    if (Test-Path $envFile) {
        Write-Host "  ✓ .env (present)" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ .env — missing (agent may use agent-config.json fallback)" -ForegroundColor Yellow
    }
    # Show version from package.json
    $pkgJson = Join-Path $InstallDir "package.json"
    if (Test-Path $pkgJson) {
        try {
            $pkg = Get-Content $pkgJson -Raw | ConvertFrom-Json
            Write-Host "  Version       : $($pkg.version)" -ForegroundColor Cyan
        } catch { }
    }
} else {
    Write-Host "  NOT FOUND: $InstallDir" -ForegroundColor Red
    $allOk = $false
}

Write-Host ""

# ── 3. Config Path ────────────────────────────────────────────────

Write-Host "── Configuration ──" -ForegroundColor Yellow
$configFile = Join-Path $ConfigDir "agent-config.json"
if (Test-Path $configFile) {
    Write-Host "  Config file   : $configFile" -ForegroundColor Green
    try {
        $cfg = Get-Content $configFile -Raw | ConvertFrom-Json
        # Show keys present without revealing sensitive values
        $keys = $cfg.PSObject.Properties.Name
        Write-Host "  Keys present  : $($keys -join ', ')" -ForegroundColor DarkGray
        if ($cfg.server_url) {
            Write-Host "  Server URL    : $($cfg.server_url)" -ForegroundColor DarkGray
        }
        if ($cfg.pairing_code) {
            $masked = $cfg.pairing_code.Substring(0, [Math]::Min(4, $cfg.pairing_code.Length)) + "****"
            Write-Host "  Pairing code  : $masked" -ForegroundColor DarkGray
        }
    } catch {
        Write-Host "  ⚠ Could not parse config: $_" -ForegroundColor Yellow
    }
} else {
    Write-Host "  NOT FOUND: $configFile" -ForegroundColor Red
    Write-Host "  The agent needs this file or .env to connect to PopDAM." -ForegroundColor DarkGray
    $allOk = $false
}

Write-Host ""

# ── 4. Log Paths ─────────────────────────────────────────────────

Write-Host "── Logs ──" -ForegroundColor Yellow
if (Test-Path $LogDir) {
    Write-Host "  Log dir       : $LogDir" -ForegroundColor Green
    $logFiles = @("agent.log", "agent-error.log", "drive-map.log")
    foreach ($lf in $logFiles) {
        $lfp = Join-Path $LogDir $lf
        if (Test-Path $lfp) {
            $size = (Get-Item $lfp).Length
            $sizeStr = if ($size -gt 1MB) { "$([math]::Round($size / 1MB, 1)) MB" } else { "$([math]::Round($size / 1KB, 1)) KB" }
            Write-Host ""
            Write-Host "  ── $lf ($sizeStr) — last 20 lines ──" -ForegroundColor Cyan
            try {
                $lines = Get-Content $lfp -Tail 20 -ErrorAction Stop
                foreach ($line in $lines) {
                    Write-Host "    $line" -ForegroundColor DarkGray
                }
            } catch {
                Write-Host "    (could not read: $_)" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  - $lf — not found (agent may not have run yet)" -ForegroundColor DarkGray
        }
    }
} else {
    Write-Host "  Log dir NOT FOUND: $LogDir" -ForegroundColor Red
    $allOk = $false
}

Write-Host ""

# ── 5. Legacy Service Check ──────────────────────────────────────

$legacySvc = Get-Service -Name "PopDAMWindowsAgent" -ErrorAction SilentlyContinue
if ($legacySvc) {
    Write-Host "── Legacy Service ──" -ForegroundColor Yellow
    Write-Host "  ⚠ Legacy service 'PopDAMWindowsAgent' still exists (Status: $($legacySvc.Status))" -ForegroundColor Red
    Write-Host "  Run uninstall-service.ps1 to remove it." -ForegroundColor DarkGray
    $allOk = $false
    Write-Host ""
}

# ── Summary ──────────────────────────────────────────────────────

Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
if ($allOk) {
    Write-Host "║  ✓ All checks passed                                    ║" -ForegroundColor Green
} else {
    Write-Host "║  ⚠ Some checks failed — review above                    ║" -ForegroundColor Yellow
}
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
