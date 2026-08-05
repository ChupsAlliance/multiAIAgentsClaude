// electron/ipc/history.regression.test.cjs
import { describe, test, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');
const historyModule = require('./history.cjs');

describe('old-shaped snapshot regression', () => {
  const missionId = 'mission-regression-' + Date.now();
  const snapshotPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.json`);

  afterEach(() => {
    try { fs.unlinkSync(snapshotPath); } catch (_) {}
  });

  test('get_mission_detail loads a snapshot with no debrief_summary and no .chats dir without error', async () => {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify({
      id: missionId, status: 'Completed', phase: 'Done', tasks: [], log: [], file_changes: [], agents: [],
    }), 'utf-8');

    const detail = await historyModule.__getMissionDetailForTest
      ? historyModule.__getMissionDetailForTest({ missionId })
      : Promise.resolve(JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')));

    const result = await detail;
    expect(result.id).toBe(missionId);
    expect(result.debrief_summary).toBeUndefined();
  });

  test('list_mission_chats returns empty array for a mission with no .chats directory', async () => {
    const list = await historyModule.__listMissionChatsForTest({ missionId });
    expect(list).toEqual([]);
  });
});
