@echo off
title Install noon Rider Hub Autostart
color 0A
echo ========================================================
echo   noon Rider Hub - Background Autostart Setup
echo ========================================================
echo Setting up automatic 24/7 background service on PC boot...

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "TARGET_VBS=%~dp0run-hidden.vbs"
set "SHORTCUT_VBS=%TEMP%\CreateShortcut.vbs"

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%SHORTCUT_VBS%"
echo sLinkFile = "%STARTUP_FOLDER%\noon-rider-hub.lnk" >> "%SHORTCUT_VBS%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%SHORTCUT_VBS%"
echo oLink.TargetPath = "wscript.exe" >> "%SHORTCUT_VBS%"
echo oLink.Arguments = """%TARGET_VBS%""" >> "%SHORTCUT_VBS%"
echo oLink.WorkingDirectory = "%~dp0" >> "%SHORTCUT_VBS%"
echo oLink.Description = "noon Rider Hub Background Service" >> "%SHORTCUT_VBS%"
echo oLink.Save >> "%SHORTCUT_VBS%"

cscript //nologo "%SHORTCUT_VBS%"
del "%SHORTCUT_VBS%"

echo.
echo [SUCCESS] Auto-start configured!
echo The noon Rider Hub will now run in the background 24/7 automatically when your computer starts.
echo.
pause
