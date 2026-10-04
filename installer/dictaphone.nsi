; Dictaphone FR installer (NSIS). Build:  makensis -DVERSION=1.0.0 installer/dictaphone.nsi
Unicode true
!ifndef VERSION
  !define VERSION "1.0.0"
!endif
Name "Dictaphone DeepSeek FR"
OutFile "..\Dictaphone-Setup.exe"
InstallDir "$LOCALAPPDATA\Dictaphone FR"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "..\outils\dictaphone.ico"
UninstallIcon "..\outils\dictaphone.ico"
BrandingText "Dictaphone DeepSeek FR ${VERSION}"

!include "MUI2.nsh"
!define MUI_ICON "..\outils\dictaphone.ico"
!define MUI_UNICON "..\outils\dictaphone.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "French"

Section "Install"
  SetOutPath "$INSTDIR"
  File "..\README.md"
  File "..\config.json"
  File "..\requirements.txt"
  File "..\start.bat"
  File "..\demarrage-auto.bat"
  File "..\demarrer-serveur-silencieux.vbs"
  SetOutPath "$INSTDIR\server"
  File /r "..\server\*.*"
  SetOutPath "$INSTDIR\extension"
  File /r "..\extension\*.*"
  SetOutPath "$INSTDIR\outils"
  File "..\outils\demarrage-auto.ps1"
  File "..\outils\ouvrir-reglages.vbs"
  File "..\outils\dictaphone.ico"
  SetOutPath "$INSTDIR\installer"
  File "setup.ps1"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Dictaphone FR"
  CreateShortcut "$SMPROGRAMS\Dictaphone FR\Dictaphone FR (settings).lnk" "$INSTDIR\outils\ouvrir-reglages.vbs" "" "$INSTDIR\outils\dictaphone.ico"
  CreateShortcut "$SMPROGRAMS\Dictaphone FR\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DictaphoneFR" "DisplayName" "Dictaphone DeepSeek FR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DictaphoneFR" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DictaphoneFR" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DictaphoneFR" "DisplayIcon" "$INSTDIR\outils\dictaphone.ico"

  DetailPrint "Setting up Python, dependencies and the speech model (a few minutes)..."
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\installer\setup.ps1" -Root "$INSTDIR"'
SectionEnd

Section "Uninstall"
  nsExec::Exec 'powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 8765 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $$_.OwningProcess -Force }"'
  nsExec::Exec 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\outils\demarrage-auto.ps1" -Desactiver'
  Delete "$SMPROGRAMS\Dictaphone FR\*.lnk"
  RMDir "$SMPROGRAMS\Dictaphone FR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DictaphoneFR"
  RMDir /r "$INSTDIR"
SectionEnd
