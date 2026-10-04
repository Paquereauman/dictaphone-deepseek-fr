@echo off
chcp 65001 >nul
setlocal
title Dictaphone FR - demarrage automatique

cd /d "%~dp0"

if /i "%~1"=="off"  goto :desactiver
if /i "%~1"=="-off" goto :desactiver
if /i "%~1"=="etat" goto :etat

echo.
echo ====================================================================
echo   DEMARRAGE AUTOMATIQUE DU SERVEUR DE DICTEE
echo ====================================================================
echo.
echo   Le serveur se lancera tout seul, sans aucune fenetre, a chaque
echo   ouverture de session Windows. Tu n'auras plus jamais a y penser.
echo.
echo   Cout quand tu ne dictes pas : environ 60 Mo de RAM, 0 Mo de VRAM
echo   (le modele Whisper ne se charge qu'a la premiere dictee).
echo.
echo   1 = Activer le demarrage automatique
echo   2 = Le desactiver
echo   3 = Voir l'etat
echo   4 = Quitter
echo.
set /p choix="Ton choix [1] : "
if "%choix%"=="" set choix=1

if "%choix%"=="1" goto :activer
if "%choix%"=="2" goto :desactiver
if "%choix%"=="3" goto :etat
goto :fin

:activer
powershell -NoProfile -ExecutionPolicy Bypass -File "outils\demarrage-auto.ps1"
goto :fin

:desactiver
powershell -NoProfile -ExecutionPolicy Bypass -File "outils\demarrage-auto.ps1" -Desactiver
goto :fin

:etat
powershell -NoProfile -ExecutionPolicy Bypass -File "outils\demarrage-auto.ps1" -Statut
goto :fin

:fin
echo.
pause
