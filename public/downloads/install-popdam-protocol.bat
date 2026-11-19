@echo off
:: PopDAM Protocol Handler Installer for Windows
:: Registers the popdam:// URI scheme so "Open Folder" works from the web app.
::
:: Usage: Double-click to run (or right-click → Run as Administrator)
:: Uses REG ADD to register the current user.

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

:: 2. Check that popdam-open.js is in place
if not exist "C:\PopDAM\popdam-open.js" (
    echo.
    echo [!] popdam-open.js not found at C:\PopDAM\popdam-open.js
    echo     Download it from PopDAM and place it in C:\PopDAM\
    pause
    exit /b 1
)

:: 3. Register the popdam:// protocol handler
reg add "HKCU\Software\Classes\popdam" /ve /d "URL:PopDAM Protocol" /f >nul 2>&1
reg add "HKCU\Software\Classes\popdam" /v "URL Protocol" /d "" /f >nul 2>&1
reg add "HKCU\Software\Classes\popdam\shell\open\command" /ve /d "\"%SystemRoot%\System32\wscript.exe\" \"C:\PopDAM\popdam-open.js\" \"%%1\"" /f >nul 2>&1

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
