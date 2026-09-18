@echo off
setlocal EnableExtensions DisableDelayedExpansion
if not defined TEMP set "TEMP=%SystemRoot%\Temp"
set "V23_CANONICAL=%~dp0Start-V23-Windows.cmd"
set "V23_LAUNCH_LOG=%TEMP%\NeonV23-Windows-launch.log"
echo V23 Windows launcher alias preflight>"%V23_LAUNCH_LOG%"

if not exist "%V23_CANONICAL%" (
  echo [V23] Missing Windows launcher: "%V23_CANONICAL%"
  echo [V23] Copy the complete game directory and try again.
  echo [V23] Missing Windows launcher: "%V23_CANONICAL%">>"%V23_LAUNCH_LOG%"
  echo [V23] Press any key to close this window.
  pause >nul
  exit /b 2
)

call "%V23_CANONICAL%"
set "V23_EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %V23_EXIT_CODE%
