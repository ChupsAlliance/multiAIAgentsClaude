'use strict';
// Port of history commands from lib.rs → Node.js
const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnAgentProcess } = require('./mission.cjs');
const { queryIndex } = require('../lib/missionIndex.cjs');

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

// ─────────────────────────────────────────────────────────────────
// ask_mission_chat — agentic multi-turn debrief chat (spec §3)
// Spawns its own independent process via spawnAgentProcessRefHistory
// (a local indirection mirroring mission.cjs's spawnAgentProcessRef
// pattern from Task 5, kept separate here since history.cjs doesn't
// share mission.cjs's module scope).
// ─────────────────────────────────────────────────────────────────
let spawnAgentProcessRefHistory = spawnAgentProcess;

/** Parse `--output-format stream-json` stdout lines, return the last assistant text. */
function extractAssistantTextLocal(stdoutText) {
  const lines = stdoutText.split('\n').filter(Boolean);
  let lastText = null;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'assistant' && parsed.message && Array.isArray(parsed.message.content)) {
        const textPart = parsed.message.content.find(p => p.type === 'text');
        if (textPart) lastText = textPart.text;
      }
    } catch (_) { /* skip non-JSON lines */ }
  }
  return lastText;
}

async function askMissionChat({ missionId, chatId, question }) {
  let chat = chatId ? await getMissionChat({ missionId, chatId }) : null;
  if (!chat) {
    chat = {
      id: chatId || `chat-${Date.now()}`,
      missionId,
      title: question.slice(0, 60),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    };
  }

  const topK = await queryIndex(missionId, question, 6);
  const contextBlock = topK.map(c => `[${c.source.type}] ${c.text}`).join('\n');
  const transcript = chat.messages.map(m => `${m.role}: ${m.content}`).join('\n');
  const prompt = [
    `You are a debrief assistant for a completed mission. Use the retrieved context and prior conversation to answer follow-up questions. You may reason step by step, but give a clear final answer.`,
    `## Retrieved context\n${contextBlock}`,
    `## Prior conversation\n${transcript}`,
    `## New question\n${question}`,
  ].join('\n\n');

  return new Promise((resolve) => {
    let proc;
    try {
      const spawned = spawnAgentProcessRefHistory({
        backendId: 'claude', model: 'sonnet', prompt, resumeSessionId: null, maxTurns: 20,
        useAgentTeams: false, cwd: undefined,
      });
      proc = spawned.proc;
      try {
        if (spawned.promptViaStdin) proc.stdin.write(prompt, 'utf8');
        proc.stdin.end();
      } catch (_) {}
    } catch (err) {
      resolve({ chatId: chat.id, answer: null, error: err.message });
      return;
    }

    let stdout = '';
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      resolve({ chatId: chat.id, answer: null, error: 'Chat request timed out' });
    }, 180000);

    proc.stdout.on('data', d => { stdout += d.toString('utf8'); });
    proc.on('error', (err) => { clearTimeout(timer); resolve({ chatId: chat.id, answer: null, error: err.message }); });
    proc.on('close', () => {
      clearTimeout(timer);
      const answer = extractAssistantTextLocal(stdout);
      const now = Date.now();
      chat.messages.push({ role: 'user', content: question, timestamp: now });
      chat.messages.push({ role: 'assistant', content: answer, timestamp: now });
      chat.updatedAt = now;
      writeMissionChat(missionId, chat);
      resolve({ chatId: chat.id, answer });
    });
  });
}

// ─── get_mission_detail ─────────────────────────────────────────────
async function getMissionDetail(args) {
  const missionId = args.missionId || args.mission_id || args;
  const snapshotPath = path.join(snapshotsDirPath, `${missionId}.json`);
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot not found for mission ${missionId}`);
  }
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
}

module.exports = function registerHistory(getMainWindow) {
  const userprofile = os.homedir();
  const historyPath = path.join(userprofile, '.claude', 'agent-teams-history.json');

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
  ipcMain.handle('get_mission_detail', async (_event, args) => getMissionDetail(args));

  // ─── mission chat sessions ──────────────────────────────────────
  ipcMain.handle('list_mission_chats', async (_event, args) => listMissionChats(args));
  ipcMain.handle('get_mission_chat', async (_event, args) => getMissionChat(args));
  ipcMain.handle('delete_mission_chat', async (_event, args) => deleteMissionChat(args));
  ipcMain.handle('ask_mission_chat', async (_event, args) => askMissionChat(args));

  console.log('[IPC] history OK');
};

if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
  module.exports.__getMissionDetailForTest = getMissionDetail;
  module.exports.__listMissionChatsForTest = listMissionChats;
  module.exports.__getMissionChatForTest = getMissionChat;
  module.exports.__deleteMissionChatForTest = deleteMissionChat;
  module.exports.__writeMissionChatForTest = writeMissionChat;
  module.exports.__askMissionChatForTest = askMissionChat;
  module.exports.__setSpawnAgentProcessForTest = (fn) => { spawnAgentProcessRefHistory = fn; };
}
