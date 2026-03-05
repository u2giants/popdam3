#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Fully removes the PopDAM Windows Agent and all its artifacts.

.DESCRIPTION
  Deep-clean uninstall (default) removes:
    1. Scheduled task: "PopDAM Windows Render Agent"
    2. Legacy NSSM service: "PopDAMWindowsAgent"
    3. Install directory: C:\Program Files\PopDAM\WindowsAgent\
    4. Config & logs: %ProgramData%\PopDAM\
    5. Stale temp artifacts: popdam-gs-*, popdam-ink-*, popdam-im-*, magick-*
    6. Start Menu shortcuts under PopDAM
    7. Add/Remove Programs registry entry

  Use -KeepConfig to preserve %ProgramData%\PopDAM (agent-config.json, logs).
  Use -KeepInstallDir to preserve the install directory.

.PARAMETER KeepConfig
  Opt-out: preserve %ProgramData%\PopDAM (config + logs).

.PARAMETER KeepInstallDir
  Opt-out: preserve the agent install directory.

.PARAMETER SkipTempClean
  Opt-out: skip cleaning stale temp artifacts.

.EXAMPLE
  .\uninstall-service.ps1                  # full deep-clean (default)
  .\uninstall-service.ps1 -KeepConfig      # keep config/logs, remove everything else
#>

param(
    [switch]$KeepConfig,
    [switch]$KeepInstallDir,
    [switch]$SkipTempClean
)

$ErrorActionPreference = "Continue"   # don't abort on non-fatal errors
$TaskName = "PopDAM Windows Render Agent"
$ServiceName = "PopDAMWindowsAgent"
$InstallDir = "C:\Program Files\PopDAM\WindowsAgent"
$ConfigDir = Join-Path $env:ProgramData "PopDAM"
$StartMenuDir = Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "PopDAM"
$UninstallRegKey = "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\PopDAMWindowsAgent"

$summary = @{
    Removed = [System.Collections.ArrayList]::new()
    Skipped = [System.Collections.ArrayList]::new()
    Locked  = [System.Collections.ArrayList]::new()
    Errors  = [System.Collections.ArrayList]::new()
}

function Add-Result($category, $message) {
    $summary[$category].Add($message) | Out-Null
}

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  PopDAM Windows Agent — Deep-Clean Uninstall            ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── 1. Remove Scheduled Task ───────────────────────────────────────

Write-Host "[1/7] Scheduled Task..." -ForegroundColor White
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    try {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
        Write-Host "      Removed: $TaskName" -ForegroundColor Green
        Add-Result "Removed" "Scheduled task '$TaskName'"
    } catch {
        Write-Host "      ERROR: $_" -ForegroundColor Red
        Add-Result "Errors" "Scheduled task: $_"
    }
} else {
    Write-Host "      Not found (OK)" -ForegroundColor DarkGray
    Add-Result "Skipped" "Scheduled task '$TaskName' (not found)"
}

# ── 2. Remove Legacy NSSM Service ─────────────────────────────────

Write-Host "[2/7] Legacy service..." -ForegroundColor White
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    try {
        if ($svc.Status -eq "Running") {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
        }
        $nssm = Get-Command nssm -ErrorAction SilentlyContinue
        if ($nssm) {
            & nssm remove $ServiceName confirm 2>&1 | Out-Null
        } else {
            & sc.exe delete $ServiceName 2>&1 | Out-Null
        }
        Start-Sleep -Seconds 1
        $check = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($check) {
            Write-Host "      Marked for removal (pending reboot)" -ForegroundColor Yellow
            Add-Result "Removed" "Legacy service '$ServiceName' (pending reboot)"
        } else {
            Write-Host "      Removed: $ServiceName" -ForegroundColor Green
            Add-Result "Removed" "Legacy service '$ServiceName'"
        }
    } catch {
        Write-Host "      ERROR: $_" -ForegroundColor Red
        Add-Result "Errors" "Legacy service: $_"
    }
} else {
    Write-Host "      Not found (OK)" -ForegroundColor DarkGray
    Add-Result "Skipped" "Legacy service '$ServiceName' (not found)"
}

# ── 3. Remove Install Directory ────────────────────────────────────

Write-Host "[3/7] Install directory..." -ForegroundColor White
if ($KeepInstallDir) {
    Write-Host "      Skipped (-KeepInstallDir)" -ForegroundColor DarkGray
    Add-Result "Skipped" "Install directory (opt-out)"
} elseif (Test-Path $InstallDir) {
    try {
        Remove-Item -Recurse -Force $InstallDir -ErrorAction Stop
        Write-Host "      Removed: $InstallDir" -ForegroundColor Green
        Add-Result "Removed" "Install directory: $InstallDir"
        # Also remove parent if empty
        $parentDir = Split-Path $InstallDir
        if ((Test-Path $parentDir) -and ((Get-ChildItem $parentDir -Force | Measure-Object).Count -eq 0)) {
            Remove-Item $parentDir -Force -ErrorAction SilentlyContinue
            Add-Result "Removed" "Empty parent: $parentDir"
        }
    } catch {
        Write-Host "      ERROR (files may be locked): $_" -ForegroundColor Red
        Add-Result "Locked" "Install directory: $InstallDir — $_"
    }
} else {
    Write-Host "      Not found (OK)" -ForegroundColor DarkGray
    Add-Result "Skipped" "Install directory (not found)"
}

# ── 4. Remove Config & Logs ───────────────────────────────────────

Write-Host "[4/7] Config & logs..." -ForegroundColor White
if ($KeepConfig) {
    Write-Host "      Skipped (-KeepConfig)" -ForegroundColor DarkGray
    Add-Result "Skipped" "Config directory (opt-out)"
} elseif (Test-Path $ConfigDir) {
    try {
        Remove-Item -Recurse -Force $ConfigDir -ErrorAction Stop
        Write-Host "      Removed: $ConfigDir" -ForegroundColor Green
        Add-Result "Removed" "Config directory: $ConfigDir"
    } catch {
        Write-Host "      ERROR (files may be locked): $_" -ForegroundColor Red
        Add-Result "Locked" "Config directory: $ConfigDir — $_"
    }
} else {
    Write-Host "      Not found (OK)" -ForegroundColor DarkGray
    Add-Result "Skipped" "Config directory (not found)"
}

# ── 5. Clean Stale Temp Artifacts ──────────────────────────────────

Write-Host "[5/7] Temp artifacts..." -ForegroundColor White
if ($SkipTempClean) {
    Write-Host "      Skipped (-SkipTempClean)" -ForegroundColor DarkGray
    Add-Result "Skipped" "Temp artifacts (opt-out)"
} else {
    $tempDir = $env:LOCALAPPDATA + "\Temp"
    if (-not (Test-Path $tempDir)) { $tempDir = $env:TEMP }

    $dirPrefixes = @("popdam-gs-*", "popdam-ink-*", "popdam-im-*")
    $filePrefixes = @("magick-*")
    $cleanedCount = 0
    $lockedCount = 0

    foreach ($prefix in $dirPrefixes) {
        $matches = Get-ChildItem -Path $tempDir -Directory -Filter $prefix -ErrorAction SilentlyContinue
        foreach ($d in $matches) {
            try {
                Remove-Item -Recurse -Force $d.FullName -ErrorAction Stop
                $cleanedCount++
            } catch {
                $lockedCount++
                Add-Result "Locked" "Temp dir: $($d.Name)"
            }
        }
    }
    foreach ($prefix in $filePrefixes) {
        $matches = Get-ChildItem -Path $tempDir -File -Filter $prefix -ErrorAction SilentlyContinue
        foreach ($f in $matches) {
            try {
                Remove-Item -Force $f.FullName -ErrorAction Stop
                $cleanedCount++
            } catch {
                $lockedCount++
                Add-Result "Locked" "Temp file: $($f.Name)"
            }
        }
    }
    if ($cleanedCount -gt 0) {
        Write-Host "      Cleaned $cleanedCount temp items" -ForegroundColor Green
        Add-Result "Removed" "Temp artifacts: $cleanedCount items"
    }
    if ($lockedCount -gt 0) {
        Write-Host "      $lockedCount items locked (in use)" -ForegroundColor Yellow
    }
    if ($cleanedCount -eq 0 -and $lockedCount -eq 0) {
        Write-Host "      None found (OK)" -ForegroundColor DarkGray
        Add-Result "Skipped" "Temp artifacts (none found)"
    }
}

# ── 6. Remove Start Menu Shortcuts ─────────────────────────────────

Write-Host "[6/7] Start Menu shortcuts..." -ForegroundColor White
if (Test-Path $StartMenuDir) {
    try {
        Remove-Item -Recurse -Force $StartMenuDir -ErrorAction Stop
        Write-Host "      Removed: $StartMenuDir" -ForegroundColor Green
        Add-Result "Removed" "Start Menu shortcuts"
    } catch {
        Write-Host "      ERROR: $_" -ForegroundColor Red
        Add-Result "Errors" "Start Menu: $_"
    }
} else {
    Write-Host "      Not found (OK)" -ForegroundColor DarkGray
    Add-Result "Skipped" "Start Menu shortcuts (not found)"
}

# ── 7. Remove Add/Remove Programs Entry ────────────────────────────

Write-Host "[7/7] Registry (Add/Remove Programs)..." -ForegroundColor White
if (Test-Path $UninstallRegKey) {
    try {
        Remove-Item -Path $UninstallRegKey -Force -ErrorAction Stop
        Write-Host "      Removed: registry entry" -ForegroundColor Green
        Add-Result "Removed" "Add/Remove Programs registry entry"
    } catch {
        Write-Host "      ERROR: $_" -ForegroundColor Red
        Add-Result "Errors" "Registry: $_"
    }
} else {
    Write-Host "      Not found (OK)" -ForegroundColor DarkGray
    Add-Result "Skipped" "Registry entry (not found)"
}

# ── Summary ────────────────────────────────────────────────────────

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║  Uninstall Summary                                      ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════════════════╝" -ForegroundColor Cyan

if ($summary.Removed.Count -gt 0) {
    Write-Host ""
    Write-Host "  REMOVED:" -ForegroundColor Green
    foreach ($item in $summary.Removed) {
        Write-Host "    ✓ $item" -ForegroundColor Green
    }
}
if ($summary.Skipped.Count -gt 0) {
    Write-Host ""
    Write-Host "  SKIPPED:" -ForegroundColor DarkGray
    foreach ($item in $summary.Skipped) {
        Write-Host "    - $item" -ForegroundColor DarkGray
    }
}
if ($summary.Locked.Count -gt 0) {
    Write-Host ""
    Write-Host "  LOCKED (retry after reboot):" -ForegroundColor Yellow
    foreach ($item in $summary.Locked) {
        Write-Host "    ⚠ $item" -ForegroundColor Yellow
    }
}
if ($summary.Errors.Count -gt 0) {
    Write-Host ""
    Write-Host "  ERRORS:" -ForegroundColor Red
    foreach ($item in $summary.Errors) {
        Write-Host "    ✗ $item" -ForegroundColor Red
    }
}

Write-Host ""
if ($summary.Errors.Count -eq 0 -and $summary.Locked.Count -eq 0) {
    Write-Host "Deep-clean uninstall completed successfully." -ForegroundColor Green
} elseif ($summary.Errors.Count -eq 0) {
    Write-Host "Uninstall completed with locked items. Reboot and re-run to finish." -ForegroundColor Yellow
} else {
    Write-Host "Uninstall completed with errors. Review above and retry." -ForegroundColor Red
}
Write-Host ""
