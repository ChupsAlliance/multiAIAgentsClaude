// electron/ipc/mission.createQaFixMission.test.cjs
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

const require = createRequire(import.meta.url);

const ELECTRON_PATH = require.resolve('electron');
const ipcHandlers = new Map();
const windowSendCalls = [];
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

const spawnCalls = [];
let nextFakeProc = null;
const CROSS_SPAWN_PATH = require.resolve('cross-spawn');
function installFakeCrossSpawn() {
  require.cache[CROSS_SPAWN_PATH] = {
    id: CROSS_SPAWN_PATH, filename: CROSS_SPAWN_PATH, loaded: true,
    exports: {
      spawn: (...callArgs) => {
        spawnCalls.push(callArgs);
        return nextFakeProc || makeFakeProc();
      },
    },
  };
}

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new Readable({ read() {} });
  proc.stderr = new Readable({ read() {} });
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.pid = 9999;
  proc.kill = () => { proc.killed = true; };
  return proc;
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
  spawnCalls.length = 0;
  nextFakeProc = null;
  windowSendCalls.length = 0;
  ipcHandlers.clear();
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: (channel, data) => { windowSendCalls.push([channel, data]); } },
  };
  mission(() => fakeWindow);
  return mission;
}

function stuckMissionState() {
  return {
    id: 'old-mission-1', description: 'Build the checkout flow',
    project_path: '/tmp/proj', status: 'Needs Attention', phase: 'Executing',
    execution_mode: 'agent_teams', permission_mode: 'auto', backend: 'claude',
    autoResumeCount: 4, stuckReason: 'final_qa_retry_exhausted',
    question_history: [], started_at: 1000, ended_at: null,
    agents: [
      { name: 'Lead', role: 'Orchestrator', status: 'Idle', model: 'opus', backend: 'claude', current_task: null },
      { name: 'Dev', role: 'Developer', status: 'Idle', model: 'sonnet', backend: 'claude', current_task: null },
    ],
    tasks: [
      {
        id: 't1', title: 'Checkout flow', status: 'failed_qa', assigned_agent: 'Dev', qcRound: 3,
        lastFailureDetail: { stage: 'qa', reason: 'fails 6/7 Playwright specs', responsibleAgent: 'Dev', timestamp: 900 },
      },
    ],
    log: [], file_changes: [], raw_output: [], messages: [], team_name: 'qa-fix',
  };
}

describe('create_qa_fix_mission', () => {
  let mission;

  beforeEach(() => {
    mission = freshMission();
  });

  afterEach(() => {
    mission.__setMissionStateForTest(null);
  });

  test('rejects when mission is not in the exact stuck state', async () => {
    mission.__setMissionStateForTest({ id: 'm1', status: 'Running' });
    const handler = ipcHandlers.get('create_qa_fix_mission');

    const result = await handler(null, {});

    expect(result.ok).toBe(false);
  });

  test('stops the old mission, forks a new one, and seeds the prompt with QA failures and roster', async () => {
    const proc = makeFakeProc();
    nextFakeProc = proc;
    mission.__setMissionStateForTest(stuckMissionState());

    const handler = ipcHandlers.get('create_qa_fix_mission');
    const result = await handler(null, {});

    expect(result.ok).toBe(true);
    expect(spawnCalls.length).toBe(1);

    const newState = mission.__getMissionStateForTest();
    expect(newState.id).not.toBe('old-mission-1');
    expect(newState.forked_from).toBe('old-mission-1');
    expect(newState.status).toBe('Running');
    expect(newState.agents.map(a => a.name)).toEqual(['Lead']);

    const writtenPrompt = proc.stdin.write.mock.calls[0][0];
    expect(writtenPrompt).toContain('Checkout flow');
    expect(writtenPrompt).toContain('fails 6/7 Playwright specs');
    expect(writtenPrompt).toContain('Dev (Developer), model: sonnet, backend: claude');
    expect(writtenPrompt).toContain('Do NOT re-plan or redesign the project');
  });
});
