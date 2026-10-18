@echo off
rem ============================================================================
rem  Meshfin Web launcher (Windows side)
rem
rem  Run this file, or the desktop shortcut that setup.cmd creates, to start the
rem  harness from wherever this distribution was extracted. It sits at
rem  <archive>\launch\windows\, so the launcher it runs is at the archive root.
rem
rem  Lifetime contract:
rem    * closing the browser window     -> the server keeps running
rem    * closing this console window    -> the server stops
rem    * Ctrl+C in this console window  -> the server stops
rem
rem  The harness opens the browser itself, on the authenticated URL it prints.
rem  Nothing here probes a port first: that URL carries a per-process token, so a
rem  request to the bare origin is refused and a port probe would prove nothing.
rem
rem  Environment / arguments:
rem    start-meshfin.cmd [port]     port to serve on (default 3080)
rem    MESHFIN_NO_BROWSER=1         do not open a browser; print the URL instead
rem ============================================================================
setlocal
set "HERE=%~dp0"
rem The archive root, two levels above this file, resolved to an absolute path.
for %%I in ("%HERE%..\..") do set "ROOT=%%~fI"
set "PORT=%~1"
if "%PORT%"=="" set "PORT=3080"

if not exist "%ROOT%\meshfin.ps1" (
  echo [launcher] meshfin.ps1 was not found at %ROOT% 1>&2
  echo [launcher] Extract the whole archive and run this file from inside it. 1>&2
  exit /b 1
)

set "OPEN="
if "%MESHFIN_NO_BROWSER%"=="1" set "OPEN=--no-open"

echo [launcher] starting Meshfin on port %PORT% ...
echo [launcher] closing the browser keeps it running; closing this window stops it.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\meshfin.ps1" web --port %PORT% %OPEN%
