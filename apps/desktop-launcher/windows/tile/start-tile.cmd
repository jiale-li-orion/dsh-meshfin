@echo off
rem ============================================================================
rem  start-tile.cmd - wait for the desktop, then start the Meshfin desktop tile.
rem
rem  Why a wrapper: a Startup-folder shortcut is launched by Explorer, which
rem  queues it behind every other startup app on this machine (the tile showed
rem  up ~5 minutes after logon). A logon-triggered scheduled task runs this
rem  script promptly, and the wait below keeps the tile from being created
rem  before the shell and wallpaper host exist. Every step is timestamped into
rem  tile-startup.log so the next reboot can be verified instead of guessed.
rem
rem  build-tile.cmd must have run first; it writes MeshfinTile.exe beside this file.
rem ============================================================================
setlocal
set "HERE=%~dp0"
set "LOG=%HERE%tile-startup.log"

echo [%date% %time%] start-tile invoked >> "%LOG%"

if not exist "%HERE%MeshfinTile.exe" (
  echo [tile] MeshfinTile.exe was not found; run build-tile.cmd first. 1>&2
  exit /b 1
)

rem Wait up to 3 minutes for Explorer (the shell that owns the desktop).
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "for ($i = 0; $i -lt 90; $i++) { if (Get-Process explorer -ErrorAction SilentlyContinue) { exit 0 }; Start-Sleep -Seconds 2 }; exit 1" >> "%LOG%" 2>&1

rem Let the desktop, taskbar and wallpaper host finish coming up.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 4" >> "%LOG%" 2>&1

rem The mutex in MeshfinTile.exe makes a duplicate launch a no-op, so the other
rem autostart paths (Run key, Startup folder) can stay as backups.
start "" "%HERE%MeshfinTile.exe"
echo [%date% %time%] MeshfinTile.exe launched >> "%LOG%"
exit /b 0
