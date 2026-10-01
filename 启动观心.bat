@echo off
title Citta - Local Diary
cd /d "%~dp0"

echo.
echo   Citta - Watch Your Mind
echo   --------------------------------
echo.

if exist "node_modules\electron\dist\electron.exe" goto run

echo   First run: installing dependencies (one time only)...
echo.
call npm install --no-audit --no-fund
if errorlevel 1 goto npmfail
echo.

:run
echo   Starting...
start "" "node_modules\electron\dist\electron.exe" "."
exit /b 0

:npmfail
echo.
echo   [ERROR] Failed to install dependencies.
echo   If npm is unreachable, try a mirror first:
echo       npm config set registry https://registry.npmmirror.com
echo       set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
echo.
pause
exit /b 1
