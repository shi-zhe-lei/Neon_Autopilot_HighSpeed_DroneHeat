@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Neon Windows Local Launcher

if not defined TEMP set "TEMP=%SystemRoot%\Temp"
set "Neon_EXIT_CODE=1"
set "Neon_ROOT=%~dp0"
set "Neon_LAUNCHER=%Neon_ROOT%server\windows-local-server.ps1"
set "Neon_LAUNCH_LOG=%TEMP%\Neon-Windows-launch.log"
set "Neon_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
echo Neon Windows local launcher preflight>"%Neon_LAUNCH_LOG%"

echo [Neon] Starting local game...
if not exist "%Neon_LAUNCHER%" (
  echo [Neon] Missing launcher file: "%Neon_LAUNCHER%"
  echo [Neon] Copy the complete game directory and try again.
  echo [Neon] Missing launcher file: "%Neon_LAUNCHER%">>"%Neon_LAUNCH_LOG%"
  set "Neon_EXIT_CODE=2"
  goto :finish
)
if not exist "%Neon_POWERSHELL%" (
  echo [Neon] Windows PowerShell 5.1 was not found.
  echo [Neon] Windows PowerShell 5.1 was not found.>>"%Neon_LAUNCH_LOG%"
  set "Neon_EXIT_CODE=3"
  goto :finish
)

"%Neon_POWERSHELL%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%Neon_LAUNCHER%"
set "Neon_EXIT_CODE=%ERRORLEVEL%"

:finish
echo [Neon] Launcher exit code %Neon_EXIT_CODE%.>>"%Neon_LAUNCH_LOG%"
echo.
if "%Neon_EXIT_CODE%"=="0" (
  echo [Neon] Local game server stopped normally.
) else (
  echo [Neon] Launch failed with exit code %Neon_EXIT_CODE%.
)
echo [Neon] Diagnostic log: Neon-Windows-launch.log in the Windows TEMP directory.
echo [Neon] Press any key to close this window.
pause >nul
endlocal & exit /b %Neon_EXIT_CODE%
