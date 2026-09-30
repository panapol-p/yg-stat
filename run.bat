@echo off
cd /d "%~dp0"
if not exist yg-stat.exe (
  echo yg-stat.exe not found, building...
  go build -ldflags="-s -w" -o yg-stat.exe .
  if errorlevel 1 ( echo BUILD FAILED & pause & exit /b 1 )
)
yg-stat.exe
pause
