@echo off
setlocal
pushd "%~dp0"
set "ACTION=Start"
if /i "%~1"=="/stop" set "ACTION=Stop"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0workforce360_server.ps1" -Action %ACTION%
set "WORKFORCE360_EXIT=%ERRORLEVEL%"
popd
if not "%WORKFORCE360_EXIT%"=="0" pause
exit /b %WORKFORCE360_EXIT%
