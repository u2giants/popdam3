# PopDAM Protocol Handler Installer for Windows
# Registers the popdam:// URI scheme so "Open Folder" works from the web app.
#
# Usage: Right-click → "Run with PowerShell"  (or run from admin terminal)
# Registers the handler for the current user.

$ErrorActionPreference = "Stop"

$scriptPath = "C:\PopDAM\popdam-open.js"
$scriptHost = Join-Path $env:SystemRoot "System32\wscript.exe"
$regRoot = "HKCU:\Software\Classes\popdam"

Write-Host ""
Write-Host "=== PopDAM Protocol Handler Installer ===" -ForegroundColor Cyan
Write-Host ""

# 1. Ensure C:\PopDAM exists
if (!(Test-Path "C:\PopDAM")) {
    New-Item -ItemType Directory -Path "C:\PopDAM" -Force | Out-Null
    Write-Host "[OK] Created C:\PopDAM\" -ForegroundColor Green
} else {
    Write-Host "[OK] C:\PopDAM\ already exists" -ForegroundColor Green
}

# 2. Check that popdam-open.js is in place
if (!(Test-Path $scriptPath)) {
    Write-Host ""
    Write-Host "[!] popdam-open.js not found at $scriptPath" -ForegroundColor Yellow
    Write-Host "    Download it from PopDAM → Downloads and place it in C:\PopDAM\" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# 3. Register the protocol in the current user profile
try {
    # Create the protocol key
    if (!(Test-Path $regRoot)) {
        New-Item -Path $regRoot -Force | Out-Null
    }
    Set-ItemProperty -Path $regRoot -Name "(Default)" -Value "URL:PopDAM Protocol"
    Set-ItemProperty -Path $regRoot -Name "URL Protocol" -Value ""

    # Create shell\open\command
    $cmdPath = "$regRoot\shell\open\command"
    if (!(Test-Path $cmdPath)) {
        New-Item -Path $cmdPath -Force | Out-Null
    }
    Set-ItemProperty -Path $cmdPath -Name "(Default)" -Value "`"$scriptHost`" `"$scriptPath`" `"%1`""

    Write-Host "[OK] Protocol handler registered: popdam://" -ForegroundColor Green
    Write-Host "     Command: `"$scriptHost`" `"$scriptPath`" `"%1`"" -ForegroundColor Gray
} catch {
    Write-Host "[ERROR] Failed to register protocol: $_" -ForegroundColor Red
    Write-Host "        Try running this script as Administrator." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Installation complete! Restart your browser for changes to take effect." -ForegroundColor Cyan
Write-Host ""
Read-Host "Press Enter to exit"
