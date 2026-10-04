@echo off
chcp 65001 >nul
setlocal
title Dictaphone FR - serveur de transcription

cd /d "%~dp0"

set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

if not exist ".venv\Scripts\python.exe" (
  echo.
  echo   [!] L'environnement n'existe pas encore.
  echo       Double-clique d'abord sur install.bat
  echo.
  pause & exit /b 1
)

echo.
echo ====================================================================
echo   DICTAPHONE FR - serveur local
echo ====================================================================
echo.
echo   Page de test  : http://127.0.0.1:8765
echo   Etat du moteur: http://127.0.0.1:8765/health
echo.
echo   Laisse cette fenetre ouverte pendant que tu dictes.
echo   Ferme-la (ou Ctrl+C) pour arreter.
echo.
echo ====================================================================
echo.

".venv\Scripts\python.exe" -m server.app %*

echo.
echo   Serveur arrete.
pause
