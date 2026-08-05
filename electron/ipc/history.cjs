'use strict';
// Port of history commands from lib.rs → Node.js
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Module-level snapshots dir (shared by get_mission_detail and the
// mission-chat storage helpers below, so the latter can be exported as
// test seams outside the registerHistory(...) closure). ──
const snapshotsDirPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots');

// ─────────────────────────────────────────────────────────────────
// Mission chat session storage
// ~/.claude/agent-teams-snapshots/{missionId}.chats/{chatId}.json
// ─────────────────────────────────────────────────────────────────
function chatsDirFor(missionId) {
  return path.join(snapshotsDirPath, `${missionId}.chats`);
}

async function listMissionChats({ missionId }) {
  const dir = chatsDirFor(missionId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  return files.map(f => {
    const chat = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    return { id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messageCount: chat.messages.length };
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function getMissionChat({ missionId, chatId }) {
  const filePath = path.join(chatsDirFor(missionId), `${chatId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

async function deleteMissionChat({ missionId, chatId }) {
  const filePath = path.join(chatsDirFor(missionId), `${chatId}.json`);
  try { fs.unlinkSync(filePath); } catch (_) {}
}

function writeMissionChat(missionId, chat) {
  const dir = chatsDirFor(missionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${chat.id}.json`), JSON.stringify(chat), 'utf-8');
}

module.exports = function registerHistory(getMainWindow) {
  const userprofile = os.homedir();
  const historyPath = path.join(userprofile, '.claude', 'agent-teams-history.json');
  const snapshotsDir = snapshotsDirPath;

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

  // ─── mission chat sessions ──────────────────────────────────────
  ipcMain.handle('list_mission_chats', async (_event, args) => listMissionChats(args));
  ipcMain.handle('get_mission_chat', async (_event, args) => getMissionChat(args));
  ipcMain.handle('delete_mission_chat', async (_event, args) => deleteMissionChat(args));

  console.log('[IPC] history OK');
};

if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
  module.exports.__listMissionChatsForTest = listMissionChats;
  module.exports.__getMissionChatForTest = getMissionChat;
  module.exports.__deleteMissionChatForTest = deleteMissionChat;
  module.exports.__writeMissionChatForTest = writeMissionChat;
}
