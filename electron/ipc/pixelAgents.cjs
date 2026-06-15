'use strict';
const { ipcMain, app } = require('electron');
const fs = require('fs/promises');
const path = require('path');

// Fallback: pixel-agents' own bundled default layout
const BUNDLED_DEFAULT_LAYOUT = path.join(
  __dirname, '../../src/assets/pixel-agents-webview/assets/default-layout-1.json'
);

module.exports = function registerPixelAgents(_getMainWindow) {
  const LAYOUT_FILE = path.join(app.getPath('userData'), 'pa-office-layout.json');
  const SEATS_FILE  = path.join(app.getPath('userData'), 'pa-office-seats.json');

  // Load saved layout (pixel-agents native format). Falls back to bundled default.
  ipcMain.handle('load_office_layout', async () => {
    try {
      return await fs.readFile(LAYOUT_FILE, 'utf-8');
    } catch {
      return await fs.readFile(BUNDLED_DEFAULT_LAYOUT, 'utf-8');
    }
  });

  ipcMain.handle('pa:save-layout', async (_event, { layout }) => {
    const json = typeof layout === 'string' ? layout : JSON.stringify(layout);
    if (json.length > 5_000_000) throw new Error('Layout payload too large');
    await fs.writeFile(LAYOUT_FILE, json, 'utf-8');
  });

  ipcMain.handle('pa:save-seats', async (_event, { seats }) => {
    const json = JSON.stringify(seats);
    if (json.length > 1_000_000) throw new Error('Seats payload too large');
    await fs.writeFile(SEATS_FILE, json, 'utf-8');
  });

  console.log('[IPC] pixelAgents OK');
};
