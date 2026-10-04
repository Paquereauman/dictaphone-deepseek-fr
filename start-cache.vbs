Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

dossier = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dossier
sh.Environment("Process")("PYTHONUTF8") = "1"
sh.Environment("Process")("PYTHONIOENCODING") = "utf-8"

sh.Run Chr(34) & dossier & "\.venv\Scripts\python.exe" & Chr(34) & " -m server.app", 0, False