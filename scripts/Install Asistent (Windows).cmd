@echo off
rem Double-click once to install Asistent on Windows (needs Python 3.12 and FFmpeg, see README). Later versions install
rem from the panel's Update button. Works from the top of the release folder and from scripts\.
set "S=%~dp0setup_win.ps1"
if not exist "%S%" set "S=%~dp0scripts\setup_win.ps1"
powershell -NoProfile -ExecutionPolicy Bypass -File "%S%" -Subtitles
echo.
pause
