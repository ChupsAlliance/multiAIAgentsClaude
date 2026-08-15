// electron/ipc/mission.getIncompleteMissions.test.cjs
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

const ELECTRON_PATH = require.resolve('electron');
const ipcHandlers = new Map();
function installFakeElectron() {
  require.cache[ELECTRON_PATH] = {
    id: ELECTRON_PATH, filename: ELECTRON_PATH, loaded: true,
    exports: {
      ipcMain: { handle: (channel, fn) => { ipcHandlers.set(channel, fn); }, on: () => {} },
      shell: { openExternal: async () => {}, openPath: async () => {} },
      dialog: { showSaveDialog: async () => ({ canceled: true }) },
      BrowserWindow: class FakeBrowserWindow {
        constructor() { this.webContents = { send: () => {}, printToPDF: async () => Buffer.from('') }; }
        loadURL() { return Promise.resolve(); }
        isDestroyed() { return false; }
      },
    },
  };
}

const CROSS_SPAWN_PATH = require.resolve('cross-spawn');
function installFakeCrossSpawn() {
  require.cache[CROSS_SPAWN_PATH] = {
    id: CROSS_SPAWN_PATH, filename: CROSS_SPAWN_PATH, loaded: true,
    exports: { spawn: () => { throw new Error('not used in this test'); } },
  };
}

function freshMission() {
  installFakeElectron();
  installFakeCrossSpawn();
  delete require.cache[require.resolve('./mission.cjs')];
  delete require.cache[require.resolve('../lib/cliAdapters/index.cjs')];
  delete require.cache[require.resolve('../lib/cliAdapters/claudeAdapter.cjs')];
  delete require.cache[require.resolve('../lib/cliAdapters/copilotAdapter.cjs')];
  const mission = require('./mission.cjs');
  mission.__setMissionStateForTest(null);
  ipcHandlers.clear();
  const fakeWindow = { isDestroyed: () => false, webContents: { send: () => {} } };
  mission(() => fakeWindow);
  return mission;
}

const snapshotsDir = path.join(os.homedir(), '.claude', 'agent-teams-snapshots');
const testSnapshotPath = path.join(snapshotsDir, 'test-needs-attention-mission.json');

describe('get_incomplete_missions — excludes Needs Attention snapshots', () => {
  beforeEach(() => {
    freshMission();
    fs.mkdirSync(snapshotsDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.unlinkSync(testSnapshotPath); } catch (_) {}
  });

  test('a snapshot with status Needs Attention is not returned', async () => {
    fs.writeFileSync(testSnapshotPath, JSON.stringify({
      id: 'test-needs-attention-mission',
      description: 'stuck on QA retry',
      project_path: '/tmp/proj',
      status: 'Needs Attention',
      phase: 'Executing',
      started_at: Date.now(),
      agents: [], tasks: [], log: [],
    }));

    const handler = ipcHandlers.get('get_incomplete_missions');
    const result = await handler(null);

    expect(result.some(m => m.id === 'test-needs-attention-mission')).toBe(false);
  });
});
