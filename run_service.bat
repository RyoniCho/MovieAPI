@echo off
:: 작업 디렉토리로 이동 (중요)
cd /d "C:\Development\CollectionWeb\MovieAPI"

:: 로그 폴더가 없으면 생성
if not exist "logs" mkdir "logs"

:: 실행 로그 남기기 (디버깅용)
echo [%DATE% %TIME%] Starting Movie API Service... >> "logs\service_launch.log"

:: Node.js 실행 (로그를 파일로 직접 저장, 2>&1은 에러도 포함한다는 뜻)
"C:\Program Files\nodejs\node.exe" "App.js" >> "logs\app_server.log" 2>&1
