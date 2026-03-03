@echo off
REM ────────────────────────────────────────────────────────────────
REM  PopDAM Windows Render Agent — Launcher / Supervisor Loop
REM
REM  This script:
REM    1. Maps the NAS drive letter (if configured in agent-config.json)
REM    2. Runs the agent (node.exe dist\index.js)
REM    3. On exit code 77: immediately restart (hot-update applied)
REM    4. On any other exit: wait 5s then restart (crash recovery)
REM
REM  The agent detects this launcher via POPDAM_LAUNCHER=1 env var.
REM ────────────────────────────────────────────────────────────────

set POPDAM_LAUNCHER=1

REM ── Read drive mapping from agent-config.json (if present) ──────
set AGENT_CONFIG=%ProgramData%\PopDAM\agent-config.json
set DRIVE_LETTER=
set NAS_UNC=
set NAS_USER=
set NAS_PASS=

if exist "%AGENT_CONFIG%" (
    REM Use PowerShell to parse JSON — available on all supported Windows
    for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "try { $c = Get-Content '%AGENT_CONFIG%' | ConvertFrom-Json; if ($c.drive_letter) { Write-Output $c.drive_letter } } catch {}"`) do set DRIVE_LETTER=%%A
    for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "try { $c = Get-Content '%AGENT_CONFIG%' | ConvertFrom-Json; if ($c.nas_unc) { Write-Output $c.nas_unc } } catch {}"`) do set NAS_UNC=%%A
    for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "try { $c = Get-Content '%AGENT_CONFIG%' | ConvertFrom-Json; if ($c.nas_username) { Write-Output $c.nas_username } } catch {}"`) do set NAS_USER=%%A
    for /f "usebackq delims=" %%A in (`powershell -NoProfile -Command "try { $c = Get-Content '%AGENT_CONFIG%' | ConvertFrom-Json; if ($c.nas_password) { Write-Output $c.nas_password } } catch {}"`) do set NAS_PASS=%%A
)

:map_drive
if defined DRIVE_LETTER if defined NAS_UNC (
    echo [launcher] Mapping %DRIVE_LETTER%: to %NAS_UNC%
    net use %DRIVE_LETTER%: /delete >nul 2>&1
    if defined NAS_USER (
        net use %DRIVE_LETTER%: "%NAS_UNC%" /user:"%NAS_USER%" "%NAS_PASS%" /persistent:no >nul 2>&1
    ) else (
        net use %DRIVE_LETTER%: "%NAS_UNC%" /persistent:no >nul 2>&1
    )
    if errorlevel 1 (
        echo [launcher] WARNING: Drive mapping failed — agent may not access NAS files
    ) else (
        echo [launcher] Drive %DRIVE_LETTER%: mapped successfully
    )
)

REM ── Supervisor loop ─────────────────────────────────────────────
:loop
echo [launcher] Starting PopDAM Windows Render Agent...
"%~dp0node.exe" "%~dp0dist\index.js"
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% equ 77 (
    echo [launcher] Agent exited with code 77 (update/rollback) — restarting immediately
    goto map_drive
)

echo [launcher] Agent exited with code %EXIT_CODE% — restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
