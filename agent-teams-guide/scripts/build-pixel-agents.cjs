#!/usr/bin/env node
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_URL = 'https://github.com/pablodelucca/pixel-agents.git';
const DEST_DIR = path.join(__dirname, '../src/assets/pixel-agents-webview');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-agents-'));

try {
  console.log(`Cloning into ${tmp}...`);
  const cloneResult = spawnSync('git', ['clone', '--depth', '1', REPO_URL, tmp], { stdio: 'inherit' });
  if (cloneResult.status !== 0) throw new Error(`git clone failed with status ${cloneResult.status}`);

  const webviewDir = path.join(tmp, 'webview-ui');
  console.log('Installing dependencies...');
  execSync('npm ci', { cwd: webviewDir, stdio: 'inherit' });

  console.log('Building...');
  execSync('npm run build', { cwd: webviewDir, stdio: 'inherit' });

  // vite.config.ts sets outDir: '../dist/webview' (relative to webview-ui/)
  const builtDir = path.join(tmp, 'dist', 'webview');

  if (!fs.existsSync(builtDir)) {
    console.error(`Build output not found at ${builtDir}.`);
    console.error('Check webview-ui/vite.config.ts for the actual outDir.');
    process.exit(1);
  }

  // Atomic copy: stage to temporary location, then swap
  const stagingDir = DEST_DIR + '.new';
  if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.cpSync(builtDir, stagingDir, { recursive: true });
  if (fs.existsSync(DEST_DIR)) fs.rmSync(DEST_DIR, { recursive: true, force: true });
  fs.renameSync(stagingDir, DEST_DIR);

  console.log(`\nDone! Vendored to:\n  ${DEST_DIR}\n`);
  console.log('Contents:');
  const list = (dir, indent = '') => {
    for (const f of fs.readdirSync(dir)) {
      console.log(indent + f);
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) list(full, indent + '  ');
    }
  };
  list(DEST_DIR);
} finally {
  // Always clean up tmp directory, even on error
  if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
}
