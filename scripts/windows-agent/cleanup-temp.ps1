<#
.SYNOPSIS
  One-time cleanup of stale PopDAM/ImageMagick temp files on a Windows machine.

.DESCRIPTION
  This script:
    1. Stops the PopDAM Windows Render Agent scheduled task
    2. Deletes stale PopDAM temp directories (popdam-gs-*, popdam-ink-*, popdam-im-*)
    3. Deletes stale ImageMagick temp files (magick-*)
    4. Truncates PopDAM log files (keeps last 1000 lines)
    5. Restarts the scheduled task
    6. Prints before/after free space

.PARAMETER StaleHours
  Only delete temp items older than this many hours. Default: 1 (hour).

.EXAMPLE
  .\cleanup-temp.ps1
  .\cleanup-temp.ps1 -StaleHours 0   # delete ALL matching temp items
#>

param(
    [int]$StaleHours = 1
)

$ErrorActionPreference = "Continue"
$TaskName = "PopDAM Windows Render Agent"
$TempDir = $env:TEMP
$LogDir = Join-Path $env:ProgramData "PopDAM\logs"

# ── Helpers ─────────────────────────────────────────────────────

function Get-FreeSpaceGB {
    $drive = (Get-Item $TempDir).PSDrive
    return [math]::Round($drive.Free / 1GB, 2)
}

function Format-Size($bytes) {
    if ($bytes -ge 1GB) { return "{0:N2} GB" -f ($bytes / 1GB) }
    if ($bytes -ge 1MB) { return "{0:N1} MB" -f ($bytes / 1MB) }
    return "{0:N0} KB" -f ($bytes / 1KB)
}

# ── Pre-flight ──────────────────────────────────────────────────

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  PopDAM Temp Cleanup Script" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$freeSpaceBefore = Get-FreeSpaceGB
Write-Host "Free disk space (before): $freeSpaceBefore GB" -ForegroundColor Yellow
Write-Host "Temp directory: $TempDir"
Write-Host "Stale threshold: $StaleHours hour(s)"
Write-Host ""

# ── Step 1: Stop agent ──────────────────────────────────────────

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task -and $task.State -eq "Running") {
    Write-Host "[1/5] Stopping agent task..." -ForegroundColor Yellow
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 3
} else {
    Write-Host "[1/5] Agent task not running — skipping stop" -ForegroundColor Gray
}

# ── Step 2: Clean temp directories ──────────────────────────────

Write-Host "[2/5] Cleaning PopDAM temp directories..." -ForegroundColor Yellow
$dirPrefixes = @("popdam-gs-", "popdam-ink-", "popdam-im-")
$cutoff = (Get-Date).AddHours(-$StaleHours)
$dirsRemoved = 0
$bytesFreed = 0

foreach ($prefix in $dirPrefixes) {
    Get-ChildItem -Path $TempDir -Directory -Filter "$prefix*" -ErrorAction SilentlyContinue | Where-Object {
        $_.LastWriteTime -lt $cutoff
    } | ForEach-Object {
        $size = (Get-ChildItem -Path $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
        try {
            Remove-Item -Path $_.FullName -Recurse -Force -ErrorAction Stop
            $dirsRemoved++
            $bytesFreed += $size
        } catch {
            Write-Host "  WARNING: Could not remove $($_.Name): $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}
Write-Host "  Directories removed: $dirsRemoved ($(Format-Size $bytesFreed))"

# ── Step 3: Clean temp files ────────────────────────────────────

Write-Host "[3/5] Cleaning ImageMagick temp files..." -ForegroundColor Yellow
$filePrefixes = @("magick-")
$filesRemoved = 0
$fileBytesFreed = 0

foreach ($prefix in $filePrefixes) {
    Get-ChildItem -Path $TempDir -File -Filter "$prefix*" -ErrorAction SilentlyContinue | Where-Object {
        $_.LastWriteTime -lt $cutoff
    } | ForEach-Object {
        try {
            $fileBytesFreed += $_.Length
            Remove-Item -Path $_.FullName -Force -ErrorAction Stop
            $filesRemoved++
        } catch {
            Write-Host "  WARNING: Could not remove $($_.Name): $($_.Exception.Message)" -ForegroundColor Red
        }
    }
}
Write-Host "  Files removed: $filesRemoved ($(Format-Size $fileBytesFreed))"

# ── Step 4: Truncate logs ──────────────────────────────────────

Write-Host "[4/5] Truncating PopDAM logs..." -ForegroundColor Yellow
if (Test-Path $LogDir) {
    Get-ChildItem -Path $LogDir -File -Filter "*.log" -ErrorAction SilentlyContinue | ForEach-Object {
        $lineCount = (Get-Content $_.FullName -ErrorAction SilentlyContinue | Measure-Object).Count
        if ($lineCount -gt 1000) {
            $sizeBefore = $_.Length
            $tail = Get-Content $_.FullName -Tail 1000
            $tail | Set-Content $_.FullName -Force
            $sizeAfter = (Get-Item $_.FullName).Length
            Write-Host "  $($_.Name): $lineCount lines → 1000 lines (saved $(Format-Size ($sizeBefore - $sizeAfter)))"
        }
    }
} else {
    Write-Host "  Log directory not found: $LogDir" -ForegroundColor Gray
}

# ── Step 5: Restart agent ──────────────────────────────────────

if ($task) {
    Write-Host "[5/5] Restarting agent task..." -ForegroundColor Yellow
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $newState = (Get-ScheduledTask -TaskName $TaskName).State
    Write-Host "  Task state: $newState"
} else {
    Write-Host "[5/5] No scheduled task found — skipping restart" -ForegroundColor Gray
}

# ── Summary ─────────────────────────────────────────────────────

$freeSpaceAfter = Get-FreeSpaceGB
$recovered = $freeSpaceAfter - $freeSpaceBefore
Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Cleanup complete" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  Dirs removed   : $dirsRemoved"
Write-Host "  Files removed  : $filesRemoved"
Write-Host "  Free space now : $freeSpaceAfter GB ($(if($recovered -gt 0){"+$recovered GB"}else{"unchanged"}))"
Write-Host ""
