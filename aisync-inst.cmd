@echo off
setlocal
rem Run from a terminal you watch, so git may ask you to sign in.
set AIKIT_INTERACTIVE=1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.ai-instructions\sync.ps1" -Mode Pull
exit /b %ERRORLEVEL%
