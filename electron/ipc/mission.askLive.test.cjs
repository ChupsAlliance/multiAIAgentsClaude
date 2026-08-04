'use strict';
// describe/test/expect/beforeEach are provided as globals by vitest.config.mjs
// (test.globals = true) — mirrors the convention used by the other .cjs test
// files in this directory (e.g. mission.backend.test.cjs), which do not
// require('vitest') either.
const { EventEmitter } = require('events');
const missionModule = require('./mission.cjs');

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  proc.kill = () => { proc.killed = true; };
  return proc;
}

describe('ask_mission_live', () => {
  let fakeRealProc;

  beforeEach(() => {
    fakeRealProc = makeFakeProc();
    missionModule.__setMissionStateForTest({
      id: 'mission-live-1',
      status: 'Running',
      phase: 'Executing',
      project_path: '/tmp/proj',
      agents: [{ name: 'Lead', model: 'sonnet', backend: 'claude' }],
      log: [], tasks: [], file_changes: [], messages: [],
    });
  });

  test('spawns a second process and leaves the driving childProcess untouched', async () => {
    const drivingProc = makeFakeProc();
    missionModule.__setChildProcessForTest(drivingProc);

    const askProcPromise = new Promise(resolve => {
      missionModule.__setSpawnAgentProcessForTest((spec) => {
        resolve(spec);
        return { proc: fakeRealProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true };
      });
    });

    const answerPromise = missionModule.__askMissionLiveForTest({ question: 'what is the Lead doing right now?' });

    await askProcPromise;
    fakeRealProc.stdout.emit('data', Buffer.from(
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Lead is writing tests.' }] } }) + '\n'
    ));
    fakeRealProc.emit('close', 0);

    const result = await answerPromise;
    expect(result.answer).toMatch(/writing tests/);
    expect(missionModule.__getChildProcessForTest()).toBe(drivingProc);
  });

  test('resolves with a null answer instead of throwing on process error', async () => {
    // Synchronize on the spawn callback firing (same pattern as the test
    // above) before emitting 'error' — askMissionLive awaits queryIndex()
    // before spawning/attaching listeners, so emitting synchronously right
    // after calling __askMissionLiveForTest would race ahead of the
    // proc.on('error', ...) subscription (a real child_process would never
    // emit 'error' that early either — Node guarantees at least a tick).
    const askProcPromise = new Promise(resolve => {
      missionModule.__setSpawnAgentProcessForTest((spec) => {
        resolve(spec);
        return { proc: fakeRealProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true };
      });
    });

    const answerPromise = missionModule.__askMissionLiveForTest({ question: 'anything' });

    await askProcPromise;
    fakeRealProc.emit('error', new Error('spawn failed'));

    const result = await answerPromise;
    expect(result.answer).toBeNull();
    expect(result.error).toMatch(/spawn failed/);
  });
});
