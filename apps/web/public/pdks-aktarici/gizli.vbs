' Aktariciyi pencere acmadan calistirir (Gorev Zamanlayici bunu cagirir)
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\aktarici.ps1""", 0, False
