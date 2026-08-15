// electron/ipc/mission.qaHeadedMode.test.cjs
//
// Coverage for the "headed/headless Playwright toggle" feature: a per-mission
// setting (qa_headed_mode) that, when on, injects a HEADED BROWSER MODE
// instruction into every prompt that can trigger Playwright/E2E test runs —
// both the task-writing/execution prompts (deploy_mission, continue_mission,
// create_qa_fix_mission) and the verification prompts (enqueueQcCheck,
// enqueueQaCheck, the final-QA-sweep). Since FleetView never spawns
// Playwright itself (agents decide and run it via their own shell commands),
// the whole feature is prompt-injection — these tests assert the injected
// text actually reaches the prompt strings that get written to the child
// process's stdin (or, for the QC/QA pipeline, passed to qcQaRunner).
//
// Harness: same require.cache-injection technique as mission.backend.test.cjs
// (fake `electron` + fake `cross-spawn`, real IPC handlers invoked directly).

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);

const ipcHandlers = new Map();
const ELECTRON_PATH = require.resolve('electron');
function installFakeElectron() {
  require.cache[ELECTRON_PATH] = {
    id: ELECTRON_PATH,
    filename: ELECTRON_PATH,
    loaded: true,
    exports: {
      ipcMain: {
        handle: (channel, fn) => { ipcHandlers.set(channel, fn); },
        on: () => {},
      },
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
    id: CROSS_SPAWN_PATH,
    filename: CROSS_SPAWN_PATH,
    loaded: true,
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
  proc.stdin = { write: () => {}, end: () => {} };
  proc.pid = 9999;
  proc.kill = () => { proc.killed = true; };
  return proc;
}

function closeProc(proc, code = 0) {
  proc.emit('close', code);
}

const SNAPSHOTS_DIR = path.join(os.homedir(), '.claude', 'agent-teams-snapshots');
function cleanupSnapshot(missionId) {
  try { fs.unlinkSync(path.join(SNAPSHOTS_DIR, `${missionId}.json`)); } catch (_) {}
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
  ipcHandlers.clear();
  const fakeWindow = {
    isDestroyed: () => false,
    webContents: { send: () => {} },
  };
  mission(() => fakeWindow);
  return mission;
}

describe('buildQaHeadedModeSection (unit)', () => {
  let mission;
  beforeEach(() => { mission = freshMission(); });
  afterEach(() => { mission.__setMissionStateForTest(null); });

  test('Given headed=false, Then returns empty string (no prompt bloat when off)', () => {
    expect(mission.__buildQaHeadedModeSectionForTest(false)).toBe('');
    expect(mission.__buildQaHeadedModeSectionForTest(undefined)).toBe('');
  });

  test('Given headed=true, Then returns an instruction block mentioning --headed', () => {
    const section = mission.__buildQaHeadedModeSectionForTest(true);
    expect(section).toContain('--headed');
    expect(section).toMatch(/HEADED BROWSER MODE/i);
  });
});

describe('qa_headed_mode threading — launch_mission (Given/When/Then)', () => {
  let mission;
  const missionIds = [];

  beforeEach(() => { mission = freshMission(); });
  afterEach(() => {
    for (const id of missionIds.splice(0)) cleanupSnapshot(id);
    mission.__setMissionStateForTest(null);
  });

  test('Given qaHeadedMode=true passed to launch_mission, Then missionState.qa_headed_mode is true', async () => {
    const proc = makeFakeProc();
    nextFakeProc = proc;
    const handler = ipcHandlers.get('launch_mission');

    const state = await handler(null, {
      projectPath: '/tmp/proj', prompt: 'Build a thing', description: 'demo',
      model: 'sonnet', executionMode: 'standard', qaHeadedMode: true,
    });
    missionIds.push(state.id);

    expect(state.qa_headed_mode).toBe(true);
    closeProc(proc, 0);
  });

  test('Given qaHeadedMode omitted, Then missionState.qa_headed_mode defaults to false', async () => {
    const proc = makeFakeProc();
    nextFakeProc = proc;
    const handler = ipcHandlers.get('launch_mission');

    const state = await handler(null, {
      projectPath: '/tmp/proj', prompt: 'Build a thing', description: 'demo',
      model: 'sonnet', executionMode: 'standard',
    });
    missionIds.push(state.id);

    expect(state.qa_headed_mode).toBe(false);
    closeProc(proc, 0);
  });
});

describe('qa_headed_mode threading — deploy_mission (Given/When/Then)', () => {
  let mission;
  const missionIds = [];

  beforeEach(() => { mission = freshMission(); });
  afterEach(() => {
    for (const id of missionIds.splice(0)) cleanupSnapshot(id);
    mission.__setMissionStateForTest(null);
  });

  test('Given mission launched with qaHeadedMode=true, When deploy_mission spawns Lead, Then the deploy prompt written to stdin contains the headed instruction', async () => {
    const leadProc = makeFakeProc();
    nextFakeProc = leadProc;
    const launchHandler = ipcHandlers.get('launch_mission');
    const state = await launchHandler(null, {
      projectPath: '/tmp/proj', prompt: 'Build a thing', description: 'demo',
      model: 'sonnet', executionMode: 'standard', qaHeadedMode: true,
    });
    missionIds.push(state.id);
    closeProc(leadProc, 0);

    const deployProc = makeFakeProc();
    const writeSpy = vi.spyOn(deployProc.stdin, 'write');
    nextFakeProc = deployProc;

    const deployHandler = ipcHandlers.get('deploy_mission');
    await deployHandler(null, { agents: [{ name: 'Dev-1', role: 'Dev', model: 'sonnet' }], tasks: [] });

    expect(writeSpy).toHaveBeenCalled();
    const writtenPrompt = writeSpy.mock.calls[0][0];
    expect(writtenPrompt).toContain('--headed');

    closeProc(deployProc, 0);
  });

  test('Given mission launched with qaHeadedMode=false (default), When deploy_mission spawns Lead, Then the deploy prompt does NOT contain the headed instruction', async () => {
    const leadProc = makeFakeProc();
    nextFakeProc = leadProc;
    const launchHandler = ipcHandlers.get('launch_mission');
    const state = await launchHandler(null, {
      projectPath: '/tmp/proj', prompt: 'Build a thing', description: 'demo',
      model: 'sonnet', executionMode: 'standard',
    });
    missionIds.push(state.id);
    closeProc(leadProc, 0);

    const deployProc = makeFakeProc();
    const writeSpy = vi.spyOn(deployProc.stdin, 'write');
    nextFakeProc = deployProc;

    const deployHandler = ipcHandlers.get('deploy_mission');
    await deployHandler(null, { agents: [{ name: 'Dev-1', role: 'Dev', model: 'sonnet' }], tasks: [] });

    expect(writeSpy).toHaveBeenCalled();
    const writtenPrompt = writeSpy.mock.calls[0][0];
    expect(writtenPrompt).not.toContain('--headed');

    closeProc(deployProc, 0);
  });
});

describe('qa_headed_mode threading — continue_mission (Given/When/Then)', () => {
  let mission;
  const missionIds = [];

  beforeEach(() => { mission = freshMission(); });
  afterEach(() => {
    for (const id of missionIds.splice(0)) cleanupSnapshot(id);
    mission.__setMissionStateForTest(null);
  });

  test('Given live mission with qa_headed_mode=true, When continue_mission runs, Then the continue prompt written to stdin contains the headed instruction', async () => {
    mission.__setMissionStateForTest({
      id: 'mission-cont-1', backend: 'claude', project_path: '/tmp/proj',
      status: 'Running', phase: 'Executing', execution_mode: 'standard',
      permission_mode: 'auto', qa_headed_mode: true,
      agents: [{ name: 'Lead', backend: 'claude', model: 'sonnet' }],
      tasks: [], log: [], file_changes: [], raw_output: [], messages: [],
    });

    const proc = makeFakeProc();
    const writeSpy = vi.spyOn(proc.stdin, 'write');
    nextFakeProc = proc;

    const handler = ipcHandlers.get('continue_mission');
    await handler(null, { message: 'please fix the header' });

    expect(writeSpy).toHaveBeenCalled();
    expect(writeSpy.mock.calls[0][0]).toContain('--headed');

    closeProc(proc, 0);
  });

  test('Given fork-from-history context carrying qa_headed_mode=true, When continue_mission runs, Then the new missionState inherits it and the prompt contains the headed instruction', async () => {
    const historyState = {
      id: 'mission-parent-1', description: 'Parent mission', project_path: '/tmp/proj',
      execution_mode: 'standard', permission_mode: 'auto', qa_headed_mode: true,
      backend: 'claude', agents: [{ name: 'Lead', backend: 'claude', model: 'sonnet' }],
      tasks: [], log: [],
    };

    const proc = makeFakeProc();
    const writeSpy = vi.spyOn(proc.stdin, 'write');
    nextFakeProc = proc;

    const handler = ipcHandlers.get('continue_mission');
    await handler(null, { message: 'resume this', contextJson: JSON.stringify(historyState) });

    const newState = mission.__getMissionStateForTest();
    missionIds.push(newState.id);
    expect(newState.qa_headed_mode).toBe(true);

    expect(writeSpy).toHaveBeenCalled();
    expect(writeSpy.mock.calls[0][0]).toContain('--headed');

    closeProc(proc, 0);
  });
});

describe('qa_headed_mode threading — create_qa_fix_mission (Given/When/Then)', () => {
  let mission;
  const missionIds = [];

  beforeEach(() => { mission = freshMission(); });
  afterEach(() => {
    for (const id of missionIds.splice(0)) cleanupSnapshot(id);
    mission.__setMissionStateForTest(null);
  });

  test('Given a stuck mission with qa_headed_mode=true, When create_qa_fix_mission forks it, Then the new missionState inherits it and the fix prompt contains the headed instruction', async () => {
    mission.__setMissionStateForTest({
      id: 'mission-stuck-1', backend: 'claude', project_path: '/tmp/proj',
      status: 'Needs Attention', stuckReason: 'final_qa_retry_exhausted',
      phase: 'AwaitingFinalQA', execution_mode: 'standard',
      permission_mode: 'auto', qa_headed_mode: true,
      description: 'Some mission', agents: [{ name: 'Lead', backend: 'claude', model: 'sonnet' }],
      tasks: [{ id: 't1', title: 'Task 1', status: 'failed_qa', files_written: [] }],
      log: [],
    });

    const proc = makeFakeProc();
    const writeSpy = vi.spyOn(proc.stdin, 'write');
    nextFakeProc = proc;

    const handler = ipcHandlers.get('create_qa_fix_mission');
    await handler();

    const newState = mission.__getMissionStateForTest();
    missionIds.push(newState.id);
    expect(newState.qa_headed_mode).toBe(true);

    expect(writeSpy).toHaveBeenCalled();
    expect(writeSpy.mock.calls[0][0]).toContain('--headed');

    closeProc(proc, 0);
  });
});

describe('qa_headed_mode threading — QC/QA verification prompts (Given/When/Then)', () => {
  let mission;

  beforeEach(() => { mission = freshMission(); });
  afterEach(() => { mission.__setMissionStateForTest(null); });

  test('Given missionState.qa_headed_mode=true, When the real enqueueQcCheck→enqueueQaCheck chain runs, Then both the QC and QA prompts contain the headed instruction', async () => {
    mission.__setMissionStateForTest({
      id: 'mission-qc-1', project_path: '/tmp/proj', qa_headed_mode: true,
      agents: [], tasks: [], log: [],
    });

    const capturedByStage = {};
    let resolveQa;
    const qaSettled = new Promise((r) => { resolveQa = r; });
    mission.__setQcQaRunnerForTest((opts) => {
      capturedByStage[opts.stage] = opts.prompt;
      if (opts.stage === 'QA') resolveQa();
      return Promise.resolve({ verdict: 'PASS' });
    });

    mission.__enqueueQcCheckRealForTest(
      { id: 't1', title: 'Task 1', detail: 'Do the thing', files_written: [] },
      'Dev-1'
    );
    await qaSettled;

    expect(capturedByStage.QC).toContain('--headed');
    expect(capturedByStage.QA).toContain('--headed');
  });

  test('Given missionState.qa_headed_mode=false, When the real enqueueQcCheck→enqueueQaCheck chain runs, Then neither prompt contains the headed instruction', async () => {
    mission.__setMissionStateForTest({
      id: 'mission-qc-2', project_path: '/tmp/proj', qa_headed_mode: false,
      agents: [], tasks: [], log: [],
    });

    const capturedByStage = {};
    let resolveQa;
    const qaSettled = new Promise((r) => { resolveQa = r; });
    mission.__setQcQaRunnerForTest((opts) => {
      capturedByStage[opts.stage] = opts.prompt;
      if (opts.stage === 'QA') resolveQa();
      return Promise.resolve({ verdict: 'PASS' });
    });

    mission.__enqueueQcCheckRealForTest(
      { id: 't1', title: 'Task 1', detail: 'Do the thing', files_written: [] },
      'Dev-1'
    );
    await qaSettled;

    expect(capturedByStage.QC).not.toContain('--headed');
    expect(capturedByStage.QA).not.toContain('--headed');
  });

  test('Given all tasks completed and qa_headed_mode=true, When the real final QA sweep runs, Then its whole-mission prompt contains the headed instruction', async () => {
    mission.__setMissionStateForTest({
      id: 'mission-sweep-1', project_path: '/tmp/proj', qa_headed_mode: true,
      description: 'Build a thing', file_changes: [],
      agents: [], tasks: [{ id: 't1', title: 'Task 1', status: 'completed', assigned_agent: 'Dev-1' }],
      log: [],
    });

    let capturedPrompt = null;
    mission.__setQcQaRunnerForTest((opts) => {
      capturedPrompt = opts.prompt;
      return Promise.resolve({ verdict: 'PASS' });
    });

    await mission.__runFinalQaSweepCoreForTest();

    expect(capturedPrompt).toContain('--headed');
    expect(mission.__getMissionStateForTest().status).toBe('Completed');
  });

  test('Given all tasks completed and qa_headed_mode=false, When the real final QA sweep runs, Then its whole-mission prompt does NOT contain the headed instruction', async () => {
    mission.__setMissionStateForTest({
      id: 'mission-sweep-2', project_path: '/tmp/proj', qa_headed_mode: false,
      description: 'Build a thing', file_changes: [],
      agents: [], tasks: [{ id: 't1', title: 'Task 1', status: 'completed', assigned_agent: 'Dev-1' }],
      log: [],
    });

    let capturedPrompt = null;
    mission.__setQcQaRunnerForTest((opts) => {
      capturedPrompt = opts.prompt;
      return Promise.resolve({ verdict: 'PASS' });
    });

    await mission.__runFinalQaSweepCoreForTest();

    expect(capturedPrompt).not.toContain('--headed');
  });

  test('Given headed=true, When qc_check.md and qa_check.md templates are filled, Then both contain the headed instruction', () => {
    const qcTemplate = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'qc_check.md'), 'utf8');
    const qaTemplate = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'qa_check.md'), 'utf8');
    const section = mission.__buildQaHeadedModeSectionForTest(true);

    const filledQc = mission.__fillTemplateForTest(qcTemplate, { QA_HEADED_MODE: section });
    const filledQa = mission.__fillTemplateForTest(qaTemplate, { QA_HEADED_MODE: section });

    expect(filledQc).toContain('--headed');
    expect(filledQa).toContain('--headed');
  });

  test('Given headed=false, When qc_check.md and qa_check.md templates are filled, Then neither contains the placeholder or the headed instruction', () => {
    const qcTemplate = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'qc_check.md'), 'utf8');
    const qaTemplate = fs.readFileSync(path.join(__dirname, '..', 'prompts', 'qa_check.md'), 'utf8');
    const section = mission.__buildQaHeadedModeSectionForTest(false);

    const filledQc = mission.__fillTemplateForTest(qcTemplate, { QA_HEADED_MODE: section });
    const filledQa = mission.__fillTemplateForTest(qaTemplate, { QA_HEADED_MODE: section });

    expect(filledQc).not.toContain('--headed');
    expect(filledQc).not.toContain('{{QA_HEADED_MODE}}');
    expect(filledQa).not.toContain('--headed');
    expect(filledQa).not.toContain('{{QA_HEADED_MODE}}');
  });
});
