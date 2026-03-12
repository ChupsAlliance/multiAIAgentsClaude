'use strict';
// Port of history commands from lib.rs → Node.js
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = function registerHistory(getMainWindow) {
  const userprofile = os.homedir();
  const historyPath = path.join(userprofile, '.claude', 'agent-teams-history.json');
  const snapshotsDir = path.join(userprofile, '.claude', 'agent-teams-snapshots');

  function readHistory() {
    if (!fs.existsSync(historyPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
    } catch {
      return [];
    }
  }

  function writeHistory(data) {
    fs.mkdirSync(path.dirname(historyPath), { recursive: true });
    fs.writeFileSync(historyPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ─── save_to_history ────────────────────────────────────────────
  ipcMain.handle('save_to_history', async (_event, args) => {
    const entry = args.entry || args;
    const history = readHistory();
    history.unshift(entry);
    if (history.length > 50) history.length = 50; // truncate
    writeHistory(history);
  });

  // ─── load_history ───────────────────────────────────────────────
  ipcMain.handle('load_history', async () => {
    return readHistory();
  });

  // ─── get_mission_history (alias) ────────────────────────────────
  ipcMain.handle('get_mission_history', async () => {
    return readHistory();
  });

  // ─── delete_history_entry ───────────────────────────────────────
  ipcMain.handle('delete_history_entry', async (_event, args) => {
    const index = args.index ?? args;
    const history = readHistory();
    if (index >= 0 && index < history.length) {
      history.splice(index, 1);
    }
    writeHistory(history);
  });

  // ─── get_mission_detail ─────────────────────────────────────────
  ipcMain.handle('get_mission_detail', async (_event, args) => {
    const missionId = args.missionId || args.mission_id || args;
    const snapshotPath = path.join(snapshotsDir, `${missionId}.json`);
    if (!fs.existsSync(snapshotPath)) {
      throw new Error(`Snapshot not found for mission ${missionId}`);
    }
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  });

  console.log('[IPC] history OK');
};
