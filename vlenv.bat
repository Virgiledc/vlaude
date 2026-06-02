@echo off
REM Vlaude build env wrapper: loads MSVC (vcvars) + node/cargo PATH, cd to project, runs %*
REM Usage: cmd.exe /c "C:\Users\VirgileDc\Vlaude\vlenv.bat <command without quotes>"
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
set "PATH=C:\Program Files\nodejs;C:\Users\VirgileDc\.cargo\bin;%PATH%"
cd /d C:\Users\VirgileDc\Vlaude
%*
