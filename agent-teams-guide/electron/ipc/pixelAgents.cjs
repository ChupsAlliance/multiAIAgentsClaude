'use strict';
const { ipcMain, app } = require('electron');
const fs = require('fs/promises');
const path = require('path');

module.exports = function registerPixelAgents(_getMainWindow) {
  const LAYOUT_FILE = path.join(app.getPath('userData'), 'pa-office-layout.json');
  const SEATS_FILE  = path.join(app.getPath('userData'), 'pa-office-seats.json');

  ipcMain.handle('pa:save-layout', async (_event, { layout }) => {
    const json = JSON.stringify(layout);
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
