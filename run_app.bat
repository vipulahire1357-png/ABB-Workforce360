@echo off
setlocal
cd /d "%~dp0"
title ABB Workforce360 Launcher

set "BOOTSTRAP=%~dp0bootstrap_portable.ps1"
if not exist "%BOOTSTRAP%" (
  echo ERROR: The Workforce360 bootstrap script is missing.
  echo Restore bootstrap_portable.ps1 from the complete project folder.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%BOOTSTRAP%"
if errorlevel 1 (
  echo.
  echo Workforce360 could not be downloaded or started.
  pause
  exit /b 1
)
endlocal
