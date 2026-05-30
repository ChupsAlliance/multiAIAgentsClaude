'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,      // allows require('path/fs') in preload; renderer stays isolated
      webviewTag: true,
    },
    // Dark title bar to match app theme
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'default',
  });

  // Load the built frontend
  mainWindow.loadFile(path.join(__dirname, '../dist-electron/index.html'));

  // Debug: open DevTools for main window
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Debug: pipe webview console to main process stdout
  mainWindow.webContents.on('did-attach-webview', (_e, wc) => {
    console.log('[DEBUG] webview attached, url:', wc.getURL());
    wc.openDevTools();
    wc.on('console-message', (_e2, level, msg) => {
      console.log('[WEBVIEW]', msg);
    });
    wc.on('did-finish-load', () => console.log('[DEBUG] webview did-finish-load'));
    wc.on('did-fail-load', (_e2, code, desc, url) => console.log('[DEBUG] webview FAILED', code, desc, url));
    wc.on('preload-error', (_e2, path, err) => console.log('[DEBUG] preload ERROR', path, err));
  });
  console.log('[DEBUG] main window created, waiting for webview attach');

  mainWindow.on('closed', () => { mainWindow = null; });

  return mainWindow;
}

// Getter for IPC handlers that need to send events
function getMainWindow() { return mainWindow; }

// Register all IPC handlers
const registerSystem  = require('./ipc/system.cjs');
const registerFiles   = require('./ipc/files.cjs');
const registerHistory = require('./ipc/history.cjs');
const registerMission = require('./ipc/mission.cjs');
const registerPixelAgents = require('./ipc/pixelAgents.cjs');

app.whenReady().then(() => {
  createWindow();
  registerSystem(getMainWindow);
  registerFiles(getMainWindow);
  registerHistory(getMainWindow);
  registerMission(getMainWindow);
  registerPixelAgents(getMainWindow);

  console.log('[Electron] App ready, all IPC handlers registered');
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
