#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Installs the PopDAM Windows Render Agent as a Windows service
  (NSSM-wrapped) so it runs at boot with no interactive login.

.DESCRIPTION
  Converts the agent from the interactive Scheduled Task to a real
  Windows service named "PopDAMWindowsAgent".

  Preflight:
    - Exports the existing Scheduled Task XML to
      %ProgramData%\PopDAM\backup\ (reversal safety)
    - Stops and removes the Scheduled Task
    - Removes any previous PopDAMWindowsAgent service
    - Kills leftover node/cmd processes from the install dir
    - Cleans stale temp artifacts

  Then:
    - Places nssm.exe into the install dir
    - Registers the service around popdam-launcher.bat
    - Configures auto-start, restart-on-failure, log rotation
    - Starts the service and prints verification steps

  Capability note:
    - PDF text extraction (mupdf + tesseract.js + AI vision) works.
    - Thumbnail render (Ghostscript / Poppler / ImageMagick / Inkscape)
      works.
    - Adobe Illustrator COM automation does NOT work in Session 0
      (no interactive desktop). The current agent build does not use
      Illustrator COM (see docs/WINDOWS_AGENT_RUNBOOK.md).

  Existing pairing is preserved: %ProgramData%\PopDAM\agent-config.json
  is never touched.

.PARAMETER InstallDir
  Agent installation directory.
  Default: C:\Program Files\PopDAM\WindowsAgent

.PARAMETER NssmExe
  Path to nssm.exe. If omitted, the script looks in the install dir,
  then downloads nssm 2.24 from nssm.cc into the install dir.

.PARAMETER ServiceAccount
  Account the service runs as.
  Default: LocalSystem (runs with no login required).
  Pass "DOMAIN\user" or ".\user" to run as a specific account; you will
  be prompted for that account's password (never echoed).

.PARAMETER KeepScheduledTask
  Opt-out: leave the Scheduled Task in place (disabled) instead of
  removing it. Only useful for A/B testing — do not run both.

.EXAMPLE
  .\install-service.ps1

.EXAMPLE
  .\install-service.ps1 -NssmExe "D:\tools\nssm.exe"

.EXAMPLE
  .\install-service.ps1 -ServiceAccount ".\renderuser"
#>

param(
    [string]$InstallDir = "C:\Program Files\PopDAM\WindowsAgent",
    [string]$NssmExe,
    [string]$ServiceAccount = "LocalSystem",
    [switch]$KeepScheduledTask
)

$ErrorActionPreference = "Stop"
$TaskName   = "PopDAM Windows Render Agent"
$ServiceName = "PopDAMWindowsAgent"
$ConfigDir  = Join-Path $env:ProgramData "PopDAM"
$LogDir     = Join-Path $ConfigDir "logs"
$BackupDir  = Join-Path $ConfigDir "backup"
$NssmUrl    = "https://nssm.cc/release/nssm-2.24.zip"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  PopDAM Windows Agent - Install as Windows Service" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

New-Item -ItemType Directory -Force -Path $LogDir, $BackupDir | Out-Null

# ── 1. Backup + remove Scheduled Task ───────────────────────────────

Write-Host "[1/7] Scheduled Task..." -ForegroundColor White
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    $xmlPath = Join-Path $BackupDir "popdam-windows-render-agent-task.xml"
    try {
        Export-ScheduledTask -TaskName $TaskName | Out-File -FilePath $xmlPath -Encoding utf8
        Write-Host "      Backed up task XML -> $xmlPath" -ForegroundColor Green
    } catch {
        Write-Host "      WARNING: could not export task XML: $_" -ForegroundColor Yellow
    }
    if ($KeepScheduledTask) {
        Write-Host "      Disabling task (kept, -KeepScheduledTask)..." -ForegroundColor Yellow
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
    } else {
        Write-Host "      Stopping and removing task '$TaskName'..." -ForegroundColor Yellow
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "      Removed." -ForegroundColor Green
    }
} else {
    Write-Host "      No scheduled task found (OK)" -ForegroundColor DarkGray
}

# ── 2. Remove previous service ──────────────────────────────────────

Write-Host "[2/7] Previous service..." -ForegroundColor White
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "      Removing existing service '$ServiceName'..." -ForegroundColor Yellow
    if ($svc.Status -eq "Running") {
        Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
    $existingNssm = Join-Path $InstallDir "nssm.exe"
    if (Test-Path $existingNssm) {
        & $existingNssm remove $ServiceName confirm 2>&1 | Out-Null
    } else {
        & sc.exe delete $ServiceName 2>&1 | Out-Null
    }
    Start-Sleep -Seconds 1
    Write-Host "      Removed." -ForegroundColor Green
} else {
    Write-Host "      No existing service (OK)" -ForegroundColor DarkGray
}

# ── 3. Kill leftover processes ──────────────────────────────────────

Write-Host "[3/7] Leftover processes..." -ForegroundColor White
$installDirLiteral = $InstallDir.Replace('\', '\\')
$killed = 0
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        ($_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe') -and
        ($_.CommandLine -like "*$InstallDir*" -or $_.CommandLine -like "*popdam-launcher*")
    } |
    ForEach-Object {
        try {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
            $killed++
        } catch { <# already gone #> }
    }
if ($killed -gt 0) {
    Write-Host "      Stopped $killed leftover process(es)." -ForegroundColor Green
} else {
    Write-Host "      None found (OK)" -ForegroundColor DarkGray
}
Start-Sleep -Seconds 1

# ── 4. Validate install directory ───────────────────────────────────

Write-Host "[4/7] Validation..." -ForegroundColor White
$LauncherBat = Join-Path $InstallDir "popdam-launcher.bat"
$NodeExe     = Join-Path $InstallDir "node.exe"
$EntryPoint  = Join-Path $InstallDir "dist\index.js"
$ConfigJson  = Join-Path $ConfigDir "agent-config.json"

if (-not (Test-Path $NodeExe))    { Write-Error "node.exe not found at $NodeExe"; exit 1 }
if (-not (Test-Path $EntryPoint)) { Write-Error "dist\index.js not found at $EntryPoint"; exit 1 }
if (-not (Test-Path $LauncherBat)) {
    Write-Error "popdam-launcher.bat not found at $LauncherBat"
    exit 1
}
if (-not (Test-Path $ConfigJson)) {
    Write-Warning "agent-config.json not found at $ConfigJson — agent may need re-pairing."
} else {
    Write-Host "      Pairing config present (will be preserved)." -ForegroundColor Green
}
Write-Host "      Install dir: $InstallDir" -ForegroundColor DarkGray

# ── 5. Obtain NSSM ──────────────────────────────────────────────────

Write-Host "[5/7] Service wrapper (NSSM)..." -ForegroundColor White
if (-not $NssmExe) {
    $NssmExe = Join-Path $InstallDir "nssm.exe"
}
if (-not (Test-Path $NssmExe)) {
    Write-Host "      Downloading NSSM 2.24..." -ForegroundColor Yellow
    $zipPath = Join-Path $env:TEMP "nssm-2.24.zip"
    $extractPath = Join-Path $env:TEMP "nssm-2.24-extract"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $NssmUrl -OutFile $zipPath -UseBasicParsing
        if (Test-Path $extractPath) { Remove-Item -Recurse -Force $extractPath }
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
        $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
        $src = Get-ChildItem -Path $extractPath -Recurse -Filter "nssm.exe" |
               Where-Object { $_.DirectoryName -like "*$arch*" } |
               Select-Object -First 1
        if (-not $src) {
            $src = Get-ChildItem -Path $extractPath -Recurse -Filter "nssm.exe" | Select-Object -First 1
        }
        if (-not $src) { throw "nssm.exe not found in downloaded archive" }
        Copy-Item $src.FullName $NssmExe -Force
        Write-Host "      Installed nssm.exe -> $NssmExe" -ForegroundColor Green
    } catch {
        Write-Error "Failed to obtain NSSM: $_. Place nssm.exe at $NssmExe or pass -NssmExe."
        exit 1
    } finally {
        Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
        Remove-Item -Recurse -Force $extractPath -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "      Using $NssmExe" -ForegroundColor Green
}

# ── 6. Register the service ─────────────────────────────────────────

Write-Host "[6/7] Service registration..." -ForegroundColor White
Write-Host "      Name    : $ServiceName"
Write-Host "      Account : $ServiceAccount"
Write-Host "      Command : $LauncherBat"

& $NssmExe install $ServiceName $LauncherBat 2>&1 | Out-Null
& $NssmExe set $ServiceName AppDirectory $InstallDir 2>&1 | Out-Null
& $NssmExe set $ServiceName AppExit Default Restart 2>&1 | Out-Null
& $NssmExe set $ServiceName AppRestartDelay 5000 2>&1 | Out-Null
& $NssmExe set $ServiceName AppStopMethodSkip 0 2>&1 | Out-Null
& $NssmExe set $ServiceName AppStopMethodConsole 3000 2>&1 | Out-Null
& $NssmExe set $ServiceName AppStopMethodWindow 3000 2>&1 | Out-Null
& $NssmExe set $ServiceName AppStopMethodThreads 3000 2>&1 | Out-Null
& $NssmExe set $ServiceName AppRotateFiles 1 2>&1 | Out-Null
& $NssmExe set $ServiceName AppRotateOnline 1 2>&1 | Out-Null
& $NssmExe set $ServiceName AppRotateBytes 5242880 2>&1 | Out-Null
& $NssmExe set $ServiceName AppStdout (Join-Path $LogDir "service-stdout.log") 2>&1 | Out-Null
& $NssmExe set $ServiceName AppStderr (Join-Path $LogDir "service-stderr.log") 2>&1 | Out-Null
& $NssmExe set $ServiceName Start SERVICE_AUTO_START 2>&1 | Out-Null
& $NssmExe set $ServiceName Description "PopDAM Windows Render Agent - headless render/PDF agent. No interactive desktop; Illustrator COM unavailable." 2>&1 | Out-Null

# Indra OCR for scanned PDFs (see packages/agent-common/src/indra-ocr.ts). Own venv + pinned
# models under ProgramData, mirroring the bridge image. Without it the agent falls back to tesseract.js.
$IndraRoot = "C:\ProgramData\PopDAM\indra"
$SystemPython = Get-Command python.exe -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike "*WindowsApps*" } | Select-Object -First 1 -ExpandProperty Source
if ($SystemPython) {
    & $SystemPython -m venv $IndraRoot
    & "$IndraRoot\Scripts\python.exe" -m pip install --quiet --disable-pip-version-check indra-ocr==1.1.1
    & "$IndraRoot\Scripts\python.exe" -c "from huggingface_hub import snapshot_download; snapshot_download('datalab-to/indra-ocr', revision='v1.1.0', allow_patterns=['*.onnx','meta.json','lm.npz','lm_*.npz'], ignore_patterns=['math*.onnx','math_meta.json','model.safetensors'], local_dir=r'$IndraRoot\models')"
    & $NssmExe set $ServiceName AppEnvironmentExtra "INDRA_OCR_PYTHON=$IndraRoot\Scripts\python.exe" "INDRA_OCR_MODEL_DIR=$IndraRoot\models" 2>&1 | Out-Null
} else {
    Write-Warning "Python not found; Indra OCR not installed (agent will use tesseract.js)."
}

if ($ServiceAccount -ne "LocalSystem") {
    $pass = Read-Host -AsSecureString "Password for $ServiceAccount"
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($pass)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        & $NssmExe set $ServiceName ObjectName $ServiceAccount $plain 2>&1 | Out-Null
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
} else {
    & $NssmExe set $ServiceName ObjectName LocalSystem 2>&1 | Out-Null
}

# SCM-level recovery: restart on failure with backoff
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/15000/restart/60000 2>&1 | Out-Null
& sc.exe failureflag $ServiceName 1 2>&1 | Out-Null

Write-Host "      Registered." -ForegroundColor Green

# ── 7. Start + verify ───────────────────────────────────────────────

Write-Host "[7/7] Start..." -ForegroundColor White
Start-Service -Name $ServiceName
Start-Sleep -Seconds 5

$svc = Get-Service -Name $ServiceName
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
if ($svc.Status -eq "Running") {
    Write-Host "  SUCCESS: service '$ServiceName' is Running." -ForegroundColor Green
} else {
    Write-Host "  WARNING: service status is $($svc.Status). Check logs." -ForegroundColor Yellow
}
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Service       : $ServiceName ($($svc.Status)), start=$($svc.StartType)"
Write-Host "  Logs          : $LogDir\agent.log / agent-error.log"
Write-Host "  Service I/O   : $LogDir\service-stdout.log / service-stderr.log"
Write-Host "  Pairing       : $ConfigJson (untouched)"
Write-Host ""
Write-Host "  Verify        : .\verify-agent.ps1"
Write-Host "  Heartbeat     : check agent_registrations, or latest log lines"
Write-Host "  Rollback      : .\install-scheduled-task.ps1  (restores interactive task)"
Write-Host "  Remove        : .\uninstall-service.ps1 -KeepConfig"
Write-Host ""
Write-Host "  NOTE: Illustrator COM will not work without an interactive"
Write-Host "  session. PDF extraction and thumbnail rendering are unaffected."
Write-Host ""
