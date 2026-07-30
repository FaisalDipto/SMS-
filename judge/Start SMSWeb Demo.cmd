@echo off
setlocal
cd /d "%~dp0"
echo Starting SMSWeb Judge Demo...
echo The application will open at http://127.0.0.1:8080
echo Keep this window open during the demonstration.
SMSWeb-Demo.exe -demo -web web -open -addr 127.0.0.1:8080 -db judge-demo.db
if errorlevel 1 (
  echo.
  echo SMSWeb could not start. Check whether port 8080 is already in use.
  pause
)
