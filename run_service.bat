@echo off
:: 작업 디렉토리로 이동 (중요)
cd /d "C:\Development\CollectionWeb\MovieAPI"

:: 실행 로그 남기기 (디버깅용)
echo [%DATE% %TIME%] Starting Movie API Service...

:: Node.js 실행
"C:\Program Files\nodejs\node.exe" "App.js"
