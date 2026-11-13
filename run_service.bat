@echo off
cd /d "C:\Development\CollectionWeb\MovieAPI"
if errorlevel 1 exit /b 1

:: App.js writes to logs\app-YYYY-MM-DD.log (Monday, Asia/Seoul).
:: WinSW still captures startup/fallback errors. Do not append to app_server.log.
"C:\Program Files\nodejs\node.exe" "App.js"
exit /b %ERRORLEVEL%