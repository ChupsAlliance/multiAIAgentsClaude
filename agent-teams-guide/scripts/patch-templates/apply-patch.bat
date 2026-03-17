@echo off
echo.
echo ============================================
echo   Claude Agent Teams - Patch v{{VERSION}}
echo ============================================
echo.

REM --- Detect install location ---
set "APP_DIR="

if exist "%LOCALAPPDATA%\Programs\agent-teams-guide\resources" (
    set "APP_DIR=%LOCALAPPDATA%\Programs\agent-teams-guide"
    goto :found
)
if exist "%LOCALAPPDATA%\Programs\claude-agent-teams\resources" (
    set "APP_DIR=%LOCALAPPDATA%\Programs\claude-agent-teams"
    goto :found
)
if exist "%ProgramFiles%\Claude Agent Teams\resources" (
    set "APP_DIR=%ProgramFiles%\Claude Agent Teams"
    goto :found
)

echo [!] Khong tim thay thu muc cai dat tu dong.
echo     Hay nhap duong dan thu muc cai dat
set /p "APP_DIR=Duong dan: "
if not exist "%APP_DIR%\resources" (
    echo [X] Khong tim thay thu muc resources trong: %APP_DIR%
    pause
    exit /b 1
)

:found
echo [OK] Tim thay app tai: %APP_DIR%
echo.

REM --- Check if app is running ---
tasklist /FI "IMAGENAME eq Claude Agent Teams.exe" 2>nul | find /I "Claude Agent Teams.exe" >nul
if %ERRORLEVEL%==0 (
    echo [!] App dang chay. Dang tat app...
    taskkill /IM "Claude Agent Teams.exe" /F >nul 2>&1
    timeout /t 2 /nobreak >nul
)

REM --- Backup current files ---
echo [1/3] Backup file cu...
set "BACKUP=%APP_DIR%\resources\backup_%date:~-4%%date:~3,2%%date:~0,2%"
if not exist "%BACKUP%" mkdir "%BACKUP%"
if exist "%APP_DIR%\resources\app.asar" copy /Y "%APP_DIR%\resources\app.asar" "%BACKUP%\app.asar" >nul
if exist "%APP_DIR%\resources\prompts" xcopy /Y /E "%APP_DIR%\resources\prompts" "%BACKUP%\prompts\" >nul
echo     Backup tai: %BACKUP%

REM --- Apply patch ---
echo [2/3] Ap dung patch...
copy /Y "%~dp0app.asar" "%APP_DIR%\resources\app.asar" >nul
if errorlevel 1 (
    echo [X] Loi khi copy app.asar! Co the can chay voi quyen Admin.
    pause
    exit /b 1
)

xcopy /Y /E "%~dp0prompts" "%APP_DIR%\resources\prompts\" >nul
if errorlevel 1 (
    echo [X] Loi khi copy prompts!
    pause
    exit /b 1
)

echo [3/3] Patch thanh cong!
echo.
echo ============================================
echo   Da cap nhat len v{{VERSION}}!
echo   Ban co the mo lai app binh thuong.
echo ============================================
echo.

REM --- Ask to launch ---
set /p "LAUNCH=Mo app ngay bay gio? (y/n): "
if /I "%LAUNCH%"=="y" (
    start "" "%APP_DIR%\Claude Agent Teams.exe"
)

pause
