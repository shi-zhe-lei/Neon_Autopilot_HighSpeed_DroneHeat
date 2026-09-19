@echo off
setlocal EnableExtensions DisableDelayedExpansion
if not defined TEMP set "TEMP=%SystemRoot%\Temp"
set "Neon_CANONICAL=%~dp0Start-Neon-Windows.cmd"
set "Neon_LAUNCH_LOG=%TEMP%\Neon-Windows-launch.log"
echo Neon Windows launcher alias preflight>"%Neon_LAUNCH_LOG%"

if not exist "%Neon_CANONICAL%" (
  echo [Neon] Missing Windows launcher: "%Neon_CANONICAL%"
  echo [Neon] Copy the complete game directory and try again.
  echo [Neon] Missing Windows launcher: "%Neon_CANONICAL%">>"%Neon_LAUNCH_LOG%"
  echo [Neon] Press any key to close this window.
  pause >nul
  exit /b 2
)

call "%Neon_CANONICAL%"
set "Neon_EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %Neon_EXIT_CODE%
