@echo off
cd /d "%~dp0"
rem เลขเวอร์ชันมาจาก git tag ล่าสุด (ถ้าไม่มี git/tag จะเป็น dev)
set VER=dev
for /f "delims=" %%v in ('git describe --tags --always --dirty 2^>nul') do set VER=%%v
rem ไอคอน + version info ของไฟล์ exe (ต้องต่อเน็ตครั้งแรกเพื่อโหลด go-winres) ถ้าทำไม่ได้ก็ build ต่อแบบไม่มีไอคอน
set FVER=0.0.0
for /f "tokens=1 delims=-" %%v in ("%VER:v=%") do set FVER=%%v
echo %FVER%| findstr /r "^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$" >nul || set FVER=0.0.0
go run github.com/tc-hib/go-winres@v0.3.3 make --arch amd64 --product-version "%VER%" --file-version "%FVER%" || echo (skip icon)
echo Building yg-stat.exe %VER% ...
go build -ldflags="-s -w -X main.version=%VER%" -o yg-stat.exe .
if errorlevel 1 (
  echo BUILD FAILED
  pause
  exit /b 1
)
echo Done: %~dp0yg-stat.exe
pause
