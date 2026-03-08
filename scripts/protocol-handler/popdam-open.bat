@echo off
REM PopDAM Protocol Handler for Windows
REM Usage: popdam://open-folder?path=<url-encoded-path>
REM This script extracts the folder path from the URI and opens it in Explorer.

setlocal enabledelayedexpansion

set "URI=%~1"

REM Strip the protocol prefix: popdam://open-folder?path=
set "ENCODED=%URI:popdam://open-folder?path==%"

REM URL-decode common characters
set "DECODED=%ENCODED:%%5C=\%"
set "DECODED=%DECODED:%%2F=/%"
set "DECODED=%DECODED:%%20= %"
set "DECODED=%DECODED:%%25=%%%"
set "DECODED=%DECODED:%%28=(%"
set "DECODED=%DECODED:%%29=)%"
set "DECODED=%DECODED:%%27='%"
set "DECODED=%DECODED:%%26=&%"
set "DECODED=%DECODED:%%23=#%"
set "DECODED=%DECODED:%%40=@%"
set "DECODED=%DECODED:%%2B=+%"
set "DECODED=%DECODED:%%2C=,%"
set "DECODED=%DECODED:%%3B=;%"

REM Open the folder in Explorer
if exist "%DECODED%" (
    explorer "%DECODED%"
) else (
    REM Try parent folder if the path is a file
    for %%I in ("%DECODED%") do set "PARENT=%%~dpI"
    if exist "!PARENT!" (
        explorer "!PARENT!"
    ) else (
        echo Path not found: %DECODED%
        echo.
        echo The folder may not be accessible. Ensure the NAS is mapped or Synology Drive is synced.
        pause
    )
)
