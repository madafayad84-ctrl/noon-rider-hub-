@echo off
title Stop noon Rider Hub
color 0C
echo Stopping noon Rider Hub server process...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq noon Rider Hub*" 2>nul
powershell -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*node*' } | Stop-Process -Force"
echo Stopped!
pause
