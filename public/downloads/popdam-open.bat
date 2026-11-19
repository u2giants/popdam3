@echo off
REM Legacy manual entry point. The registered browser handler uses the JS directly.
setlocal DisableDelayedExpansion
if not exist "%~dp0popdam-open.js" (
    echo popdam-open.js was not found. Download it from PopDAM and put it beside this launcher.
    exit /b 1
)
"%SystemRoot%\System32\cscript.exe" //nologo "%~dp0popdam-open.js" "%~1"
exit /b %errorlevel%
