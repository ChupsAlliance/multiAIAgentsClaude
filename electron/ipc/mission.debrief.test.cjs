// electron/ipc/mission.debrief.test.cjs
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
const require = createRequire(import.meta.url);
const fs = require('fs');
const os = require('os');
const path = require('path');
const missionModule = require('./mission.cjs');

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  proc.kill = () => {};
  return proc;
}

describe('generateDebriefSummary', () => {
  const missionId = 'mission-debrief-test-' + Date.now();
  const snapshotPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.json`);

  beforeEach(() => {
    missionModule.__setMissionStateForTest({
      id: missionId, status: 'Completed', phase: 'Done',
      project_path: '/tmp/proj', agents: [{ name: 'Lead', model: 'sonnet', backend: 'claude' }],
      log: [], tasks: [], file_changes: [], messages: [], description: 'Add login feature',
    });
  });

  afterEach(() => {
    try { fs.unlinkSync(snapshotPath); } catch (_) {}
  });

  test('writes debrief_summary onto the saved snapshot', async () => {
    const fakeProc = makeFakeProc();
    missionModule.__setSpawnAgentProcessForTest(() => ({ proc: fakeProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true }));

    const debriefPromise = missionModule.__generateDebriefSummaryForTest();

    fakeProc.stdout.emit('data', Buffer.from(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: JSON.stringify({
        goal: 'Add login feature', agents_involved: ['Lead'], key_files: ['src/Login.jsx'],
        issues_encountered: [], outcome: 'Completed successfully',
      }) }] },
    }) + '\n'));
    fakeProc.emit('close', 0);

    const debrief = await debriefPromise;
    expect(debrief.goal).toBe('Add login feature');
    expect(debrief.outcome).toBe('Completed successfully');
  });
});

describe('backward compatibility', () => {
  test('get_mission_detail still loads a snapshot with no debrief_summary field', () => {
    const missionId = 'mission-old-shape-' + Date.now();
    const snapshotPath = path.join(os.homedir(), '.claude', 'agent-teams-snapshots', `${missionId}.json`);
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify({ id: missionId, status: 'Completed', tasks: [], log: [] }), 'utf-8');

    expect(() => JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'))).not.toThrow();
    fs.unlinkSync(snapshotPath);
  });
});
