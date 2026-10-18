@echo off
rem ============================================================================
rem  Build the Meshfin desktop tile from source.
rem
rem  The tile is a Win32 layered window, so it needs nothing but the C# compiler
rem  that ships with .NET Framework on every Windows install. No NuGet, no
rem  project file, no SDK.
rem ============================================================================
setlocal
set "HERE=%~dp0"

set "CSC="
for %%D in (
  "%WINDIR%\Microsoft.NET\Framework64\v4.0.30319"
  "%WINDIR%\Microsoft.NET\Framework\v4.0.30319"
) do (
  if not defined CSC if exist "%%~D\csc.exe" set "CSC=%%~D\csc.exe"
)
if not defined CSC (
  echo [tile] csc.exe was not found; install .NET Framework 4 or newer. 1>&2
  exit /b 1
)

"%CSC%" /nologo /target:winexe /optimize+ ^
  /out:"%HERE%MeshfinTile.exe" ^
  /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll ^
  "%HERE%MeshfinTile.cs" || exit /b 1

echo [tile] built %HERE%MeshfinTile.exe
