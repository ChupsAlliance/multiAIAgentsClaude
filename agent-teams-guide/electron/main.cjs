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
    },
    // Dark title bar to match app theme
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'default',
  });

  // Load the built frontend
  mainWindow.loadFile(path.join(__dirname, '../dist-electron/index.html'));

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

app.whenReady().then(() => {
  createWindow();
  registerSystem(getMainWindow);
  registerFiles(getMainWindow);
  registerHistory(getMainWindow);
  registerMission(getMainWindow);

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
