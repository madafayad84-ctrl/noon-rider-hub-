Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = scriptDir

' 1. Start Node Enterprise Server in background
WshShell.Run """C:\Program Files\nodejs\node.exe"" """ & scriptDir & "\server.js""", 0, False

' 2. Wait 2 seconds
WScript.Sleep 2000

' 3. Start Cloudflare Tunnel in background for 24/7 Global HTTPS URL
WshShell.Run """" & scriptDir & "\cloudflared.exe"" tunnel --url http://localhost:3000", 0, False
