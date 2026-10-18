@echo off
taskkill /IM MeshfinTile.exe /F >nul 2>&1
echo Meshfin desktop tile stopped. Run MeshfinTile.exe (or log in again) to bring it back.
pause
