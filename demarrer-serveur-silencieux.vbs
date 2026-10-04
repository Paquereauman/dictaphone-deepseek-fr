' Demarre le serveur de dictee SANS AUCUNE FENETRE.
'
' Appele par le raccourci du dossier "Demarrage" cree par demarrage-auto.bat.
' On peut aussi le lancer a la main pour demarrer le serveur discrètement.
'
' Ne fait rien si le serveur repond deja.

Option Explicit

Dim fso, sh, root, pythonw

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
pythonw = root & "\.venv\Scripts\pythonw.exe"

' Environnement absent : on sort en silence. L'extension affichera deja
' un message clair ("Impossible de joindre le serveur...") le cas echeant.
If Not fso.FileExists(pythonw) Then WScript.Quit 1

' Deja demarre ? On ne cree pas de deuxieme instance.
If ServeurEnMarche() Then WScript.Quit 0

sh.CurrentDirectory = root
' 0 = fenetre masquee, False = ne pas attendre la fin du processus.
sh.Run """" & pythonw & """ -m server.app --log", 0, False

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
