@echo off
rem ============================================================================
rem  Meshfin setup (Windows)
rem
rem  Creates a "Meshfin Web" shortcut on the desktop pointing at this
rem  distribution's launcher, with this distribution's icon, so a later start is
rem  one double-click. Run it once after extracting the archive. It sits at
rem  <archive>\launch\windows\, so every path below is relative to THIS folder.
rem
rem  Optional: pass --tile to also build and start the desktop tile, a big
rem  resizable block that sits on the wallpaper itself (see tile\MeshfinTile.cs).
rem ============================================================================
setlocal
set "HERE=%~dp0"
rem The archive root, two levels above this file, resolved to an absolute path.
for %%I in ("%HERE%..\..") do set "ROOT=%%~fI"
set "TILE=0"
if /i "%~1"=="--tile" set "TILE=1"

if not exist "%ROOT%\meshfin.ps1" (
  echo [setup] meshfin.ps1 was not found at %ROOT% 1>&2
  echo [setup] Extract the whole archive and run this file from inside it. 1>&2
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$shell = New-Object -ComObject WScript.Shell;" ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$path = Join-Path $desktop 'Meshfin Web.lnk';" ^
  "$link = $shell.CreateShortcut($path);" ^
  "$link.TargetPath = '%HERE%start-meshfin.cmd';" ^
  "$link.WorkingDirectory = '%ROOT%';" ^
  "$link.IconLocation = '%HERE%meshfin.ico';" ^
  "$link.Description = 'Start Meshfin and open its Web UI';" ^
  "$link.Save();" ^
  "Write-Host ('[setup] shortcut created: ' + $path)"

if "%TILE%"=="1" (
  call "%HERE%tile\build-tile.cmd" || exit /b 1
  call "%HERE%tile\start-tile.cmd"
)

echo [setup] done.
