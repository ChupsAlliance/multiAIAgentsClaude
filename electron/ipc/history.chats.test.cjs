// electron/ipc/history.chats.test.cjs
import { describe, test, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');
const historyModule = require('./history.cjs');

describe('mission chat session storage', () => {
  const missionId = 'mission-chat-test-' + Date.now();
  const chatsDir = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.chats`);

  afterEach(() => {
    try { fs.rmSync(chatsDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('list_mission_chats returns empty array when no chats exist', async () => {
    const result = await historyModule.__listMissionChatsForTest({ missionId });
    expect(result).toEqual([]);
  });

  test('a written chat file is returned by list and get', async () => {
    fs.mkdirSync(chatsDir, { recursive: true });
    const chat = {
      id: 'chat-1', missionId, title: 'Why React?', createdAt: 1000, updatedAt: 1000,
      messages: [{ role: 'user', content: 'Why React?', timestamp: 1000 }],
    };
    fs.writeFileSync(path.join(chatsDir, 'chat-1.json'), JSON.stringify(chat), 'utf-8');

    const list = await historyModule.__listMissionChatsForTest({ missionId });
    expect(list).toEqual([{ id: 'chat-1', title: 'Why React?', createdAt: 1000, updatedAt: 1000, messageCount: 1 }]);

    const full = await historyModule.__getMissionChatForTest({ missionId, chatId: 'chat-1' });
    expect(full).toEqual(chat);
  });

  test('delete_mission_chat removes the chat file', async () => {
    fs.mkdirSync(chatsDir, { recursive: true });
    fs.writeFileSync(path.join(chatsDir, 'chat-2.json'), JSON.stringify({
      id: 'chat-2', missionId, title: 'x', createdAt: 1, updatedAt: 1, messages: [],
    }), 'utf-8');

    await historyModule.__deleteMissionChatForTest({ missionId, chatId: 'chat-2' });
    expect(fs.existsSync(path.join(chatsDir, 'chat-2.json'))).toBe(false);
  });
});
