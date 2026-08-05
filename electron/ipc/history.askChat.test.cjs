// electron/ipc/history.askChat.test.cjs
import { describe, test, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const historyModule = require('./history.cjs');

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  proc.kill = () => {};
  return proc;
}

describe('ask_mission_chat', () => {
  const missionId = 'mission-chat-ask-' + Date.now();
  const chatsDir = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.chats`);

  afterEach(() => {
    try { fs.rmSync(chatsDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('creates a new chat when chatId is null and persists both messages', async () => {
    const fakeProc = makeFakeProc();
    // askMissionChat awaits getMissionChat()/queryIndex() before spawning and
    // attaching stdout/close listeners, so emitting synchronously right after
    // calling __askMissionChatForTest would race ahead of those listeners
    // (same pattern/rationale as mission.askLive.test.cjs). Synchronize on the
    // spawn callback firing before emitting events.
    const spawnedPromise = new Promise((resolve) => {
      historyModule.__setSpawnAgentProcessForTest((spec) => {
        resolve(spec);
        return { proc: fakeProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true };
      });
    });

    const answerPromise = historyModule.__askMissionChatForTest({ missionId, chatId: null, question: 'Why was React chosen?' });

    await spawnedPromise;
    fakeProc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant', message: { content: [{ type: 'text', text: 'React was chosen for its ecosystem.' }] },
    }) + '\n'));
    fakeProc.emit('close', 0);

    const result = await answerPromise;
    expect(result.answer).toMatch(/ecosystem/);
    expect(result.chatId).toMatch(/^chat-/);

    const saved = await historyModule.__getMissionChatForTest({ missionId, chatId: result.chatId });
    expect(saved.messages).toHaveLength(2);
    expect(saved.messages[0]).toMatchObject({ role: 'user', content: 'Why was React chosen?' });
    expect(saved.messages[1]).toMatchObject({ role: 'assistant', content: 'React was chosen for its ecosystem.' });
    expect(saved.title).toBe('Why was React chosen?');
  });

  test('appends to an existing chat when chatId is provided', async () => {
    await historyModule.__writeMissionChatForTest(missionId, {
      id: 'chat-existing', missionId, title: 'first question', createdAt: 1, updatedAt: 1,
      messages: [{ role: 'user', content: 'first question', timestamp: 1 }, { role: 'assistant', content: 'first answer', timestamp: 1 }],
    });

    const fakeProc = makeFakeProc();
    const spawnedPromise = new Promise((resolve) => {
      historyModule.__setSpawnAgentProcessForTest((spec) => {
        resolve(spec);
        return { proc: fakeProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true };
      });
    });

    const answerPromise = historyModule.__askMissionChatForTest({ missionId, chatId: 'chat-existing', question: 'follow-up question' });
    await spawnedPromise;
    fakeProc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant', message: { content: [{ type: 'text', text: 'follow-up answer' }] },
    }) + '\n'));
    fakeProc.emit('close', 0);

    const result = await answerPromise;
    expect(result.chatId).toBe('chat-existing');

    const saved = await historyModule.__getMissionChatForTest({ missionId, chatId: 'chat-existing' });
    expect(saved.messages).toHaveLength(4);
    expect(saved.title).toBe('first question');
  });
});
