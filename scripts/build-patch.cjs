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

// Copy .bat templates from scripts/patch-templates/ (pure ASCII, no JS escaping issues)
const TEMPLATES_DIR = path.join(__dirname, 'patch-templates');
for (const batFile of ['apply-patch.bat', 'rollback.bat']) {
  const tmpl = path.join(TEMPLATES_DIR, batFile);
  if (fs.existsSync(tmpl)) {
    let content = fs.readFileSync(tmpl, 'utf8');
    content = content.replace(/\{\{VERSION\}\}/g, VERSION);
    fs.writeFileSync(path.join(PATCH_DIR, batFile), content);
    console.log(`    Copied ${batFile} from template`);
  } else {
    console.warn(`    WARNING: ${tmpl} not found — skipping`);
  }
}

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
console.log('  1. Send zip to teammate');
console.log('  2. Unzip');
console.log('  3. Double-click apply-patch.bat');
console.log('  4. Done!\n');
