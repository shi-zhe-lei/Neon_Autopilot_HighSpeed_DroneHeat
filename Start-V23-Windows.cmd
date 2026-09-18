@echo off
setlocal EnableExtensions DisableDelayedExpansion
title V23 Windows Local Launcher

if not defined TEMP set "TEMP=%SystemRoot%\Temp"
set "V23_EXIT_CODE=1"
set "V23_ROOT=%~dp0"
set "V23_LAUNCHER=%V23_ROOT%server\windows-local-server.ps1"
set "V23_LAUNCH_LOG=%TEMP%\NeonV23-Windows-launch.log"
set "V23_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
echo V23 Windows local launcher preflight>"%V23_LAUNCH_LOG%"

echo [V23] Starting local game...
if not exist "%V23_LAUNCHER%" (
  echo [V23] Missing launcher file: "%V23_LAUNCHER%"
  echo [V23] Copy the complete game directory and try again.
  echo [V23] Missing launcher file: "%V23_LAUNCHER%">>"%V23_LAUNCH_LOG%"
  set "V23_EXIT_CODE=2"
  goto :finish
)
if not exist "%V23_POWERSHELL%" (
  echo [V23] Windows PowerShell 5.1 was not found.
  echo [V23] Windows PowerShell 5.1 was not found.>>"%V23_LAUNCH_LOG%"
  set "V23_EXIT_CODE=3"
  goto :finish
)

"%V23_POWERSHELL%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%V23_LAUNCHER%"
set "V23_EXIT_CODE=%ERRORLEVEL%"

:finish
echo [V23] Launcher exit code %V23_EXIT_CODE%.>>"%V23_LAUNCH_LOG%"
echo.
if "%V23_EXIT_CODE%"=="0" (
  echo [V23] Local game server stopped normally.
) else (
  echo [V23] Launch failed with exit code %V23_EXIT_CODE%.
)
echo [V23] Diagnostic log: NeonV23-Windows-launch.log in the Windows TEMP directory.
echo [V23] Press any key to close this window.
pause >nul
endlocal & exit /b %V23_EXIT_CODE%
