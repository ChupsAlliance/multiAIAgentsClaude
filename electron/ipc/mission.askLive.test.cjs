// electron/ipc/mission.askLive.test.cjs
import { describe, test, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
const require = createRequire(import.meta.url);

function makeFakeProc() {
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };
  proc.kill = () => { proc.killed = true; };
  return proc;
}

describe('ask_mission_live', () => {
  let missionModule;
  let fakeRealProc;

  beforeEach(() => {
    delete require.cache[require.resolve('./mission.cjs')];
    missionModule = require('./mission.cjs');
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

  test('resolves with a null answer instead of throwing when pre-spawn setup fails', async () => {
    // Regression guard for the gap flagged in review: agentBackendOf/
    // buildMissionSummary/queryIndex all run BEFORE the spawn's try/catch.
    // Force a throw in that pre-spawn section (here: missionState.agents is
    // not an array, so `.find` throws) and confirm askMissionLive still
    // resolves with { answer: null, error } instead of rejecting.
    missionModule.__setMissionStateForTest({
      id: 'mission-live-2',
      status: 'Running',
      phase: 'Executing',
      project_path: '/tmp/proj',
      agents: 'not-an-array', // .find() on a string throws TypeError
      log: [], tasks: [], file_changes: [], messages: [],
    });
    missionModule.__setSpawnAgentProcessForTest(() => ({ proc: fakeRealProc, adapter: null, backendId: 'claude', resumeDropped: false, promptViaStdin: true }));

    const result = await missionModule.__askMissionLiveForTest({ question: 'anything' });

    expect(result.answer).toBeNull();
    expect(typeof result.error).toBe('string');
  });
});
