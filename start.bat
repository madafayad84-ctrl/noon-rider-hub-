@echo off
title noon Rider Hub - Operations Server
color 0E
echo ========================================================
echo        noon Rider Hub - Server Starter
echo ========================================================
echo Starting local and network server on port 3000...
echo Access from this PC: http://localhost:3000
echo.
cd /d "%~dp0"
node server.js
pause
