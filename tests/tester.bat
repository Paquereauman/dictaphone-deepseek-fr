@echo off
chcp 65001 >nul
cd /d "%~dp0.."
set PYTHONIOENCODING=utf-8
set PYTHONUTF8=1
echo Test du serveur de dictee...
echo.
".venv\Scripts\python.exe" -c "import json,urllib.request;d=json.load(urllib.request.urlopen('http://127.0.0.1:8765/health',timeout=5));print(json.dumps(d,indent=2,ensure_ascii=False))" 2>nul
if errorlevel 1 (
  echo   [X] Serveur injoignable. Lance start.bat d'abord.
) else (
  echo.
  echo   [OK] Le serveur repond.
)
echo.
pause
