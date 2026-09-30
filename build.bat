@echo off
cd /d "%~dp0"
rem เลขเวอร์ชันมาจาก git tag ล่าสุด (ถ้าไม่มี git/tag จะเป็น dev)
set VER=dev
for /f "delims=" %%v in ('git describe --tags --always --dirty 2^>nul') do set VER=%%v
echo Building yg-stat.exe %VER% ...
go build -ldflags="-s -w -X main.version=%VER%" -o yg-stat.exe .
if errorlevel 1 (
  echo BUILD FAILED
  pause
  exit /b 1
)
echo Done: %~dp0yg-stat.exe
pause
