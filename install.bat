@echo off
chcp 65001 >nul
setlocal
title Dictaphone FR - installation

cd /d "%~dp0"

set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1

echo.
echo ====================================================================
echo   DICTAPHONE FR - installation
echo ====================================================================
echo.
echo   Ce script va :
echo     1. creer un environnement Python isole dans .venv
echo     2. installer faster-whisper + CUDA (environ 1,5 Go)
echo     3. telecharger le modele Whisper "small" (environ 480 Mo)
echo.
echo   Duree estimee : 3 a 10 minutes selon la connexion.
echo.
pause

REM -- 1. Trouver Python -------------------------------------------------
set PY=
for %%P in (python.exe) do if not defined PY set PY=%%~$PATH:P
if not defined PY (
  if exist "%LOCALAPPDATA%\Programs\Python\Python312\python.exe" set PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe
)
if not defined PY (
  if exist "%LOCALAPPDATA%\Programs\Python\Python310\python.exe" set PY=%LOCALAPPDATA%\Programs\Python\Python310\python.exe
)
if not defined PY (
  echo [ERREUR] Python introuvable. Installe Python 3.10+ depuis https://www.python.org/downloads/
  echo          et coche "Add python.exe to PATH".
  pause & exit /b 1
)
echo [1/3] Python : %PY%

REM -- 2. Environnement virtuel -----------------------------------------
if not exist ".venv\Scripts\python.exe" (
  echo       Creation de .venv ...
  "%PY%" -m venv .venv
  if errorlevel 1 ( echo [ERREUR] Creation du venv impossible. & pause & exit /b 1 )
) else (
  echo       .venv deja present.
)

set VPY=%CD%\.venv\Scripts\python.exe

REM -- 3. Dependances ----------------------------------------------------
echo [2/3] Installation des dependances (pip) ...
"%VPY%" -m pip install --upgrade pip setuptools wheel
"%VPY%" -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo [ERREUR] L'installation des dependances a echoue.
  pause & exit /b 1
)

REM -- 4. Modele ---------------------------------------------------------
echo [3/3] Telechargement du modele Whisper "small" ...
"%VPY%" -c "import sys; sys.path.insert(0,'.'); from server.stt import SttEngine; e=SttEngine('small'); e.ensure('small', warmup=False); print('Modele OK')"
if errorlevel 1 (
  echo.
  echo [ATTENTION] Le modele n'a pas pu etre telecharge.
  echo             Il le sera automatiquement au premier lancement de start.bat.
)

echo.
echo ====================================================================
echo   INSTALLATION TERMINEE
echo ====================================================================
echo.
echo   Etape suivante : installe l'extension Chrome
echo     1. ouvre chrome://extensions
echo     2. active "Mode developpeur" (en haut a droite)
echo     3. clique "Charger l'extension non empaquetee"
echo     4. choisis le dossier :  %CD%\extension
echo.
echo   Puis lance start.bat et appuie sur Ctrl+Shift+Espace dans DeepSeek.
echo.
pause
