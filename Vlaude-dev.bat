@echo off
title Vlaude (dev)
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
set "PATH=C:\Program Files\nodejs;C:\Users\VirgileDc\.cargo\bin;%PATH%"
cd /d C:\Users\VirgileDc\Vlaude
echo Lancement de Vlaude (mode dev)... la fenetre va s'ouvrir apres compilation.
npm run tauri dev
