@echo off
:: PopDAM Protocol Handler Installer for Windows
:: Registers the popdam:// URI scheme so "Open Folder" works from the web app.
::
:: Usage: Double-click to run (or right-click → Run as Administrator)
:: Uses REG ADD commands — no .reg import, no .ps1, no Smart App Control issues.

echo.
echo === PopDAM Protocol Handler Installer ===
echo.

:: 1. Ensure C:\PopDAM exists
if not exist "C:\PopDAM" (
    mkdir "C:\PopDAM"
    echo [OK] Created C:\PopDAM\
) else (
    echo [OK] C:\PopDAM\ already exists
)

:: 2. Check that popdam-open.bat is in place
if not exist "C:\PopDAM\popdam-open.bat" (
    echo.
    echo [!] popdam-open.bat not found at C:\PopDAM\popdam-open.bat
    echo     Download it from PopDAM and place it in C:\PopDAM\
    echo     The protocol handler will still be registered.
    echo.
)

:: 3. Register the popdam:// protocol handler
reg add "HKCU\Software\Classes\popdam" /ve /d "URL:PopDAM Protocol" /f >nul 2>&1
reg add "HKCU\Software\Classes\popdam" /v "URL Protocol" /d "" /f >nul 2>&1
reg add "HKCU\Software\Classes\popdam\shell\open\command" /ve /d "\"C:\PopDAM\popdam-open.bat\" \"%%1\"" /f >nul 2>&1

if %errorlevel% equ 0 (
    echo [OK] Protocol handler registered: popdam://
) else (
    echo [ERROR] Failed to register protocol handler.
    echo         Try right-clicking this file and selecting "Run as Administrator".
)

echo.
echo Installation complete! Restart your browser for changes to take effect.
echo.
pause
