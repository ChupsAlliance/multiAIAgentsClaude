/**
 * build-patch.cjs — Generate a lightweight patch package for distribution
 *
 * Usage: node scripts/build-patch.cjs
 *
 * This builds the app and creates a small self-applying patch:
 *   release/patch/Claude-Agent-Teams-Patch-{version}.zip
 *     ├── app.asar          (updated app code)
 *     ├── prompts/           (updated prompt templates)
 *     ├── apply-patch.bat    (double-click to apply)
 *     └── rollback.bat       (double-click to undo patch)
 */
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');
const UNPACKED = path.join(RELEASE, 'win-unpacked');
const PATCH_DIR = path.join(RELEASE, 'patch');

// Read version from package.json
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

console.log(`\n=== Building patch v${VERSION} ===\n`);

// Step 1: Build frontend + package
console.log('[1/3] Building app...');
execSync('npm run electron:build', { cwd: ROOT, stdio: 'inherit' });

// Step 2: Prepare patch directory
console.log('\n[2/3] Preparing patch package...');
if (fs.existsSync(PATCH_DIR)) fs.rmSync(PATCH_DIR, { recursive: true });
fs.mkdirSync(PATCH_DIR, { recursive: true });

// Copy app.asar
fs.copyFileSync(
  path.join(UNPACKED, 'resources', 'app.asar'),
  path.join(PATCH_DIR, 'app.asar')
);

// Copy prompts
const promptsSrc = path.join(UNPACKED, 'resources', 'prompts');
const promptsDst = path.join(PATCH_DIR, 'prompts');
fs.mkdirSync(promptsDst, { recursive: true });
for (const f of fs.readdirSync(promptsSrc)) {
  fs.copyFileSync(path.join(promptsSrc, f), path.join(promptsDst, f));
}

// Create apply-patch.bat
const batchScript = `@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════════╗
echo ║  Claude Agent Teams - Patch v${VERSION}        ║
echo ╚══════════════════════════════════════════╝
echo.

REM --- Detect install location ---
set "APP_DIR="

REM Check common install locations
if exist "%LOCALAPPDATA%\\Programs\\agent-teams-guide\\resources" (
    set "APP_DIR=%LOCALAPPDATA%\\Programs\\agent-teams-guide"
    goto :found
)
if exist "%LOCALAPPDATA%\\Programs\\claude-agent-teams\\resources" (
    set "APP_DIR=%LOCALAPPDATA%\\Programs\\claude-agent-teams"
    goto :found
)
if exist "%ProgramFiles%\\Claude Agent Teams\\resources" (
    set "APP_DIR=%ProgramFiles%\\Claude Agent Teams"
    goto :found
)

REM Not found — ask user
echo [!] Khong tim thay thu muc cai dat tu dong.
echo     Hay nhap duong dan thu muc cai dat (vd: C:\\Users\\you\\AppData\\Local\\Programs\\agent-teams-guide)
set /p "APP_DIR=Duong dan: "
if not exist "%APP_DIR%\\resources" (
    echo [X] Khong tim thay thu muc resources trong: %APP_DIR%
    echo     Vui long kiem tra lai duong dan.
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
set "BACKUP=%APP_DIR%\\resources\\backup_%date:~-4%%date:~3,2%%date:~0,2%"
if not exist "%BACKUP%" mkdir "%BACKUP%"
if exist "%APP_DIR%\\resources\\app.asar" copy /Y "%APP_DIR%\\resources\\app.asar" "%BACKUP%\\app.asar" >nul
if exist "%APP_DIR%\\resources\\prompts" xcopy /Y /E "%APP_DIR%\\resources\\prompts" "%BACKUP%\\prompts\\" >nul
echo     Backup tai: %BACKUP%

REM --- Apply patch ---
echo [2/3] Ap dung patch...
copy /Y "%~dp0app.asar" "%APP_DIR%\\resources\\app.asar" >nul
if errorlevel 1 (
    echo [X] Loi khi copy app.asar! Co the can chay voi quyen Admin.
    pause
    exit /b 1
)

xcopy /Y /E "%~dp0prompts" "%APP_DIR%\\resources\\prompts\\" >nul
if errorlevel 1 (
    echo [X] Loi khi copy prompts!
    pause
    exit /b 1
)

echo [3/3] Patch thanh cong!
echo.
echo ╔══════════════════════════════════════════╗
echo ║  Da cap nhat len v${VERSION}!                   ║
echo ║  Ban co the mo lai app binh thuong.      ║
echo ╚══════════════════════════════════════════╝
echo.

REM --- Ask to launch ---
set /p "LAUNCH=Mo app ngay bay gio? (y/n): "
if /I "%LAUNCH%"=="y" (
    start "" "%APP_DIR%\\Claude Agent Teams.exe"
)

pause
`;
fs.writeFileSync(path.join(PATCH_DIR, 'apply-patch.bat'), batchScript, 'utf8');

// Create rollback.bat — restore from backup if patch causes issues
const rollbackScript = `@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════════╗
echo ║  Claude Agent Teams - Rollback           ║
echo ║  Khoi phuc lai phien ban truoc patch     ║
echo ╚══════════════════════════════════════════╝
echo.

REM --- Detect install location ---
set "APP_DIR="
if exist "%LOCALAPPDATA%\\Programs\\agent-teams-guide\\resources" (
    set "APP_DIR=%LOCALAPPDATA%\\Programs\\agent-teams-guide"
    goto :found
)
if exist "%LOCALAPPDATA%\\Programs\\claude-agent-teams\\resources" (
    set "APP_DIR=%LOCALAPPDATA%\\Programs\\claude-agent-teams"
    goto :found
)
if exist "%ProgramFiles%\\Claude Agent Teams\\resources" (
    set "APP_DIR=%ProgramFiles%\\Claude Agent Teams"
    goto :found
)
echo [!] Khong tim thay thu muc cai dat tu dong.
set /p "APP_DIR=Nhap duong dan cai dat: "
if not exist "%APP_DIR%\\resources" (
    echo [X] Duong dan khong hop le.
    pause
    exit /b 1
)

:found
echo [OK] App tai: %APP_DIR%
echo.

REM --- List available backups ---
echo Cac ban backup co san:
echo ─────────────────────────
set "FOUND_BACKUP=0"
for /d %%D in ("%APP_DIR%\\resources\\backup_*") do (
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
if exist "%LATEST%\\app.asar" (
    copy /Y "%LATEST%\\app.asar" "%APP_DIR%\\resources\\app.asar" >nul
    echo       OK
) else (
    echo       [!] Khong tim thay app.asar trong backup, bo qua
)

echo [2/2] Khoi phuc prompts...
if exist "%LATEST%\\prompts" (
    xcopy /Y /E "%LATEST%\\prompts" "%APP_DIR%\\resources\\prompts\\" >nul
    echo       OK
) else (
    echo       [!] Khong tim thay prompts trong backup, bo qua
)

echo.
echo ╔══════════════════════════════════════════╗
echo ║  Rollback thanh cong!                    ║
echo ║  App da quay ve phien ban truoc patch.   ║
echo ╚══════════════════════════════════════════╝
echo.

set /p "LAUNCH=Mo app ngay bay gio? (y/n): "
if /I "%LAUNCH%"=="y" (
    start "" "%APP_DIR%\\Claude Agent Teams.exe"
)
pause
`;
fs.writeFileSync(path.join(PATCH_DIR, 'rollback.bat'), rollbackScript, 'utf8');

// Step 3: Zip it
console.log('[3/3] Creating zip...');
const zipName = `Claude-Agent-Teams-Patch-${VERSION}.zip`;
const zipPath = path.join(RELEASE, zipName);
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

execSync(
  `powershell -Command "Compress-Archive -Path '${PATCH_DIR}\\*' -DestinationPath '${zipPath}'"`,
  { stdio: 'inherit' }
);

const sizeMB = (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1);
console.log(`\n✓ Patch ready: release/${zipName} (${sizeMB} MB)\n`);
console.log('User guide:');
console.log('  1. Gửi file zip cho teammate');
console.log('  2. Teammate giải nén');
console.log('  3. Double-click apply-patch.bat');
console.log('  4. Done!\n');
