@echo off
rem BianjieTools updater launcher. Keep this file CRLF and WITHOUT BOM,
rem and keep comments ASCII-only: cmd requires CRLF, and an LF-only .bat
rem gets mis-parsed so that rem lines are executed as commands.
rem
rem The plugin normally launches powershell.exe directly with -WindowStyle Hidden,
rem which shows no console at all. This .bat is only a fallback, so it hands the
rem work to a hidden process and exits immediately -- that way the console window
rem only flashes instead of staying open for the whole update.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0updater.ps1"
exit /b 0
