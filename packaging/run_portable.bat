@echo off
setlocal
cd /d "%~dp0"
title ABB Workforce360 Portable

set "PYTHON=%~dp0runtime\python.exe"
set "SUPERVISOR=%~dp0packaging\run_portable.py"
if not exist "%PYTHON%" (
  echo ERROR: The bundled Python runtime is missing: %PYTHON%
  pause
  exit /b 1
)
if not exist "%~dp0frontend\dist\index.html" (
  echo ERROR: The built Workforce360 frontend is missing.
  pause
  exit /b 1
)

set "ACTION="
if /i "%~1"=="/stop" set "ACTION=--stop"
"%PYTHON%" "%SUPERVISOR%" %ACTION%
set "APP_EXIT=%ERRORLEVEL%"
if not "%APP_EXIT%"=="0" (
  echo.
  echo Workforce360 stopped after an error. See the message above.
  pause
)
exit /b %APP_EXIT%
