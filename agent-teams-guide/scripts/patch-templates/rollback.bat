@echo off
echo.
echo ============================================
echo   Claude Agent Teams - Rollback
echo   Khoi phuc lai phien ban truoc patch
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
set /p "APP_DIR=Nhap duong dan cai dat: "
if not exist "%APP_DIR%\resources" (
    echo [X] Duong dan khong hop le.
    pause
    exit /b 1
)

:found
echo [OK] App tai: %APP_DIR%
echo.

REM --- List available backups ---
echo Cac ban backup co san:
echo -------------------------
set "FOUND_BACKUP=0"
for /d %%D in ("%APP_DIR%\resources\backup_*") do (
    echo   %%~nxD
    set "FOUND_BACKUP=1"
    set "LATEST=%%D"
)
if "%FOUND_BACKUP%"=="0" (
    echo   [Khong co backup nao]
    echo   Ban chua apply patch nao, hoac backup da bi xoa.
    pause
    exit /b 0
)
echo.
echo Backup moi nhat: %LATEST%
echo.
set /p "CONFIRM=Khoi phuc tu backup moi nhat? (y/n): "
if /I not "%CONFIRM%"=="y" (
    echo Huy bo.
    pause
    exit /b 0
)

REM --- Check if app is running ---
tasklist /FI "IMAGENAME eq Claude Agent Teams.exe" 2>nul | find /I "Claude Agent Teams.exe" >nul
if %ERRORLEVEL%==0 (
    echo [!] Dang tat app...
    taskkill /IM "Claude Agent Teams.exe" /F >nul 2>&1
    timeout /t 2 /nobreak >nul
)

REM --- Restore ---
echo [1/2] Khoi phuc app.asar...
if exist "%LATEST%\app.asar" (
    copy /Y "%LATEST%\app.asar" "%APP_DIR%\resources\app.asar" >nul
    echo       OK
) else (
    echo       [!] Khong tim thay app.asar trong backup, bo qua
)

echo [2/2] Khoi phuc prompts...
if exist "%LATEST%\prompts" (
    xcopy /Y /E "%LATEST%\prompts" "%APP_DIR%\resources\prompts\" >nul
    echo       OK
) else (
    echo       [!] Khong tim thay prompts trong backup, bo qua
)

echo.
echo ============================================
echo   Rollback thanh cong!
echo   App da quay ve phien ban truoc patch.
echo ============================================
echo.

set /p "LAUNCH=Mo app ngay bay gio? (y/n): "
if /I "%LAUNCH%"=="y" (
    start "" "%APP_DIR%\Claude Agent Teams.exe"
)
pause
