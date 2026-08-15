// electron/ipc/mission.runMockupHtml.test.cjs
//
// Regression test for the "mockup shows literal \n and unstyled HTML" bug.
//
// Root cause: runMockupHtml() accumulated raw child-process stdout and ran
// the <<<HTML>>>...<<<END_HTML>>> marker regex directly against it. But the
// adapter always launches Claude with `--output-format stream-json`
// (claudeAdapter.cjs buildLaunchArgs), so stdout is JSONL — the real HTML
// text lives inside each line's JSON string, where actual newlines are
// serialized as the two literal characters `\` + `n`, and `"` in attributes
// as `\"`. Matching against raw stdout captured that JSON-escaped form
// verbatim, so the browser rendered literal "\n" text and every
// class="..."/id="..." attribute was corrupted into class=\"...\" (a
// backslash + quote are not a valid attribute delimiter), which is also why
// the <style> rules never matched anything and the page fell back to
// unstyled default browser fonts.
//
// The fix decodes via the existing extractAssistantText() helper (already
// used the same way for askMissionLive/generateDebriefSummary) before
// running the marker regex.
//
// Mocking approach mirrors mission.backend.test.cjs: fake `electron` (so
// mission.cjs's top-level `require('electron')` resolves) and fake
// `cross-spawn` (so the claude adapter's spawn() hands back a deterministic
// fake ChildProcess instead of launching a real `claude` binary).

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { Readable } from 'stream';

const require = createRequire(import.meta.url);

const ELECTRON_PATH = require.resolve('electron');
function installFakeElectron() {
  require.cache[ELECTRON_PATH] = {
    id: ELECTRON_PATH,
    filename: ELECTRON_PATH,
    loaded: true,
    exports: {
      ipcMain: { handle: () => {}, on: () => {} },
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
  return mission;
}

describe('runMockupHtml — decodes stream-json stdout instead of matching it raw', () => {
  let mission;

  beforeEach(() => {
    mission = freshMission();
  });

  afterEach(() => {
    mission.__setMissionStateForTest(null);
  });

  test('Given Claude stdout as stream-json JSONL, When runMockupHtml chạy, Then HTML trả về có newline/quote thật, không còn escape literal', async () => {
    const proc = makeFakeProc();
    nextFakeProc = proc;

    const rawHtml =
      '<!DOCTYPE html>\n<html>\n<head><style>.card { color: #fff; }</style></head>\n' +
      '<body><div class="card">Hello</div></body>\n</html>';
    const wrapped = `<<<HTML>>>\n${rawHtml}\n<<<END_HTML>>>`;

    // Exactly the shape the real `claude -p ... --output-format stream-json`
    // CLI emits: one JSON line whose message.content[0].text is the assistant's
    // full reply. JSON.stringify here does to `wrapped` exactly what the real
    // CLI's own JSON encoder does — turns real "\n" into the two-char escape
    // and real '"' into \" — reproducing the bug's input faithfully.
    const streamJsonLine = JSON.stringify({
      type: 'assistant',
      session_id: 'sess-mockup-1',
      message: { content: [{ type: 'text', text: wrapped }] },
    });

    const resultPromise = mission.__runMockupHtmlForTest('generate a mockup');
    proc.stdout.push(streamJsonLine + '\n');
    await new Promise((r) => setImmediate(r));
    closeProc(proc, 0);

    const html = await resultPromise;

    expect(spawnCalls.length).toBe(1);
    // Before the fix, html.includes('\\n') (the literal 2-char sequence) was
    // true, and this class attribute was corrupted to class=\"card\".
    expect(html).not.toMatch(/\\n/);
    expect(html).not.toMatch(/\\"/);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<div class="card">Hello</div>');
  });
});
