' Ouvre la page de reglages du Dictaphone dans Chrome.
'
' Chrome interdit d'ouvrir directement une URL chrome-extension:// depuis un
' raccourci Windows (elle est remplacee par un nouvel onglet). On passe donc par
' une page locale servie par le serveur, qui demande a l'extension de s'ouvrir.
'
' Le serveur est demarre au passage s'il ne tourne pas deja.

Option Explicit

Dim fso, sh, root, pythonw, chrome

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

root    = fso.GetParentFolderName(WScript.ScriptFullName)
pythonw = root & "\.venv\Scripts\pythonw.exe"
chrome  = "C:\Program Files\Google\Chrome\Application\chrome.exe"

' 1. Demarrer le serveur si besoin.
If fso.FileExists(pythonw) And Not ServeurEnMarche() Then
  sh.CurrentDirectory = root
  sh.Run """" & pythonw & """ -m server.app --log", 0, False
  Dim i
  For i = 1 To 25
    WScript.Sleep 300
    If ServeurEnMarche() Then Exit For
  Next
End If

' 2. Ouvrir la page de reglages dans Chrome.
If fso.FileExists(chrome) Then
  sh.Run """" & chrome & """ ""http://127.0.0.1:8765/reglages?open=options""", 1, False
Else
  sh.Run "http://127.0.0.1:8765/reglages?open=options", 1, False
End If

WScript.Quit 0


' Interroge /health pour savoir si le serveur tourne deja.
Function ServeurEnMarche()
  Dim http
  ServeurEnMarche = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  If Err.Number <> 0 Then Exit Function
  http.setTimeouts 400, 400, 400, 800
  http.open "GET", "http://127.0.0.1:8765/health", False
  http.send
  If Err.Number = 0 Then
    If http.status = 200 Then ServeurEnMarche = True
  End If
  On Error GoTo 0
End Function
