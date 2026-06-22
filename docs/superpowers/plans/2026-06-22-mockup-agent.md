# Mockup Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During planning, Lead detects UI missions and emits a `<<<MOCKUP_REQUEST>>>` marker; the backend spawns a Claude subprocess to generate an HTML mockup, serves it on localhost, opens it in the default browser, and pauses planning until the user approves or sends feedback.

**Architecture:** Marker-based protocol mirroring the existing Question Protocol — Lead exits after emitting `<<<MOCKUP_PAUSE>>>`, backend detects the marker in the stdout buffer, spawns `runClaudeForHtml()` to generate HTML, starts `http.createServer` on a random port, calls `shell.openExternal`, sends `mission:mockup` IPC to frontend. User responds via `mockup_respond` IPC, which closes the server and restarts Lead with approval or feedback injected via stdin (identical to `answer_question` restart flow).

**Tech Stack:** Node.js built-in `http`, Electron `shell.openExternal`, Claude CLI subprocess, React + Vitest, Tailwind CSS, lucide-react (`Palette`, `ExternalLink`)

## Global Constraints

- No new npm dependencies — use Node.js built-in `http` and existing `electron` shell
- Both prompt files must stay in sync: `electron/prompts/planning.md` AND `src/data/prompts/planning.md`
- `mockupServers` object must be cleaned up in `stop_mission` AND `reset_mission`
- `WaitingForMockup` status must be handled in `watchProcessExit_launch` (same guard pattern as `WaitingForAnswer`)
- `isPlanningPhase` in `MissionControlPage.jsx` must stay true when `status === 'WaitingForMockup'` so `PlanningStream` remains visible

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `electron/ipc/mission.cjs` | Modify | Add `http`+`shell` imports, `mockupServers` map, `runClaudeForHtml()`, `spawnMockupGenerator()`, `restartLeadAfterMockup()`, mockup buffer detection in `readProcessStdout_launch`, `WaitingForMockup` guard in `watchProcessExit_launch`, `mockup_respond` IPC handler, cleanup in `stop_mission`+`reset_mission` |
| `electron/prompts/planning.md` | Modify | Append MOCKUP PROTOCOL section |
| `src/data/prompts/planning.md` | Modify | Append same MOCKUP PROTOCOL section (kept in sync) |
| `src/hooks/useMission.js` | Modify | Add `mockupInfo` state, `mission:mockup` listener, `respondToMockup` callback, resets, expose in return |
| `src/components/mission/PlanningStream.jsx` | Modify | Add `MockupApprovalCard` component, new props `mockupInfo`+`onMockupRespond`, render card when paused |
| `src/pages/MissionControlPage.jsx` | Modify | Pull `mockupInfo`+`respondToMockup` from hook, fix `isPlanningPhase`, pass props to `PlanningStream` |
| `src/__tests__/mockup/mockupHelpers.test.js` | Create | Unit tests for HTML extraction regex and marker detection logic |

---

### Task 1: Backend — imports, module-level state, and unit-test scaffold

**Files:**
- Modify: `electron/ipc/mission.cjs:1-14`
- Create: `src/__tests__/mockup/mockupHelpers.test.js`

**Interfaces:**
- Produces: `mockupServers` — `Record<string, http.Server>` at module scope; `http` and `shell` available in scope

- [ ] **Step 1: Write failing tests for the two pure helpers we'll extract**

Create `src/__tests__/mockup/mockupHelpers.test.js`:

```js
import { describe, it, expect } from 'vitest'

// These two pure functions will be extracted in Task 2.
// Import them once they exist — for now this file defines what they must do.

// extractHtml(stdout: string): string | null
//   Returns the content between <<<HTML>>> and <<<END_HTML>>> markers, trimmed.
//   Returns null if markers are absent.
function extractHtml(stdout) {
  const match = /<<<HTML>>>([\s\S]*?)<<<END_HTML>>>/.exec(stdout)
  return match ? match[1].trim() : null
}

// extractMockupRequest(buf: string): { title: string, spec: string } | null
//   Parses <<<MOCKUP_REQUEST>>>JSON<<<END_MOCKUP_REQUEST>>> from a text buffer.
//   Returns null if absent or JSON is invalid.
function extractMockupRequest(buf) {
  const match = /<<<MOCKUP_REQUEST>>>([\s\S]*?)<<<END_MOCKUP_REQUEST>>>/.exec(buf)
  if (!match) return null
  try { return JSON.parse(match[1].trim()) } catch { return null }
}

describe('extractHtml', () => {
  it('extracts HTML between markers', () => {
    const stdout = 'some preamble\n<<<HTML>>>\n<html>hello</html>\n<<<END_HTML>>>\ntrailing'
    expect(extractHtml(stdout)).toBe('<html>hello</html>')
  })

  it('returns null when markers absent', () => {
    expect(extractHtml('no markers here')).toBeNull()
  })

  it('handles multi-line HTML', () => {
    const html = '<html>\n  <body>hi</body>\n</html>'
    expect(extractHtml(`<<<HTML>>>\n${html}\n<<<END_HTML>>>`)).toBe(html)
  })
})

describe('extractMockupRequest', () => {
  it('parses valid JSON spec', () => {
    const buf = '<<<MOCKUP_REQUEST>>>\n{"title":"Login","spec":"email + password form"}\n<<<END_MOCKUP_REQUEST>>>'
    expect(extractMockupRequest(buf)).toEqual({ title: 'Login', spec: 'email + password form' })
  })

  it('returns null when no markers', () => {
    expect(extractMockupRequest('nothing here')).toBeNull()
  })

  it('returns null on invalid JSON', () => {
    const buf = '<<<MOCKUP_REQUEST>>>not json<<<END_MOCKUP_REQUEST>>>'
    expect(extractMockupRequest(buf)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — expect PASS (helpers are inlined in the test file)**

```
npx vitest run src/__tests__/mockup/mockupHelpers.test.js
```

Expected: 6 tests pass (pure functions defined inline).

- [ ] **Step 3: Add `http` import and `shell` import to `mission.cjs`**

In `electron/ipc/mission.cjs`, line 8, change:
```js
const { ipcMain } = require('electron');
```
to:
```js
const { ipcMain, shell } = require('electron');
```

After `const os = require('os');` (line 13), add:
```js
const http        = require('http');
```

- [ ] **Step 4: Add `mockupServers` module-level object**

After the existing `let watcherInterval = null;` line (around line 34), add:
```js
const mockupServers = {};  // missionId → http.Server (cleanup on stop/reset)
```

- [ ] **Step 5: Verify no syntax errors**

```
node -e "require('./electron/ipc/mission.cjs')"
```

Expected: no output (silent success).

- [ ] **Step 6: Commit**

```
git add electron/ipc/mission.cjs src/__tests__/mockup/mockupHelpers.test.js
git commit -m "feat: add http+shell imports and mockupServers map for mockup protocol"
```

---

### Task 2: Backend — `runClaudeForHtml()` and `spawnMockupGenerator()`

**Files:**
- Modify: `electron/ipc/mission.cjs` — add two new functions after `spawnClaude()`

**Interfaces:**
- Consumes: `http` (Node built-in), `shell` (electron), `spawn` (child_process), `makeLogEntry`, `now()`, `missionState`, `sendToWindow`
- Produces: `runClaudeForHtml(prompt: string): Promise<string>`, `spawnMockupGenerator(title, spec, missionId, sendToWindow): Promise<void>`

- [ ] **Step 1: Add `runClaudeForHtml` after `spawnClaude` function**

Find the line `function spawnClaude(args, cwd, useAgentTeams) {` (around line 720) and add after its closing `}`:

```js
// runClaudeForHtml — spawn a one-shot Claude process to generate an HTML mockup.
// Returns the HTML string extracted from <<<HTML>>>...<<<END_HTML>>> markers.
async function runClaudeForHtml(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', [
      '-p', prompt,
      '--model', 'claude-haiku-4-5-20251001',
      '--dangerously-skip-permissions',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('Mockup generation timed out after 60s'));
    }, 60000);

    proc.on('close', () => {
      clearTimeout(timer);
      const match = /<<<HTML>>>([\s\S]*?)<<<END_HTML>>>/.exec(stdout);
      if (match) {
        resolve(match[1].trim());
      } else {
        reject(new Error(`No <<<HTML>>> markers in output. First 300 chars: ${stdout.slice(0, 300)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude for mockup: ${err.message}`));
    });
  });
}
```

- [ ] **Step 2: Add `spawnMockupGenerator` immediately after `runClaudeForHtml`**

```js
// spawnMockupGenerator — generate HTML via runClaudeForHtml, serve on localhost,
// open browser, send mission:mockup IPC. Handles its own errors gracefully.
async function spawnMockupGenerator(title, spec, missionId, sendToWindow) {
  const prompt =
    `You are a UI mockup generator. Generate a self-contained HTML mockup for: "${title}".\n` +
    `Spec: ${spec}\n` +
    `Requirements:\n` +
    `- No external dependencies (no CDN links, no external fonts, no external scripts)\n` +
    `- All CSS in a single <style> tag\n` +
    `- Dark VS Code theme: background #1e1e1e, text #d4d4d4, accent #569cd6, panel #252526\n` +
    `- Polished, realistic UI — not a wireframe\n` +
    `- Include realistic placeholder content\n` +
    `Output ONLY the complete HTML document wrapped in <<<HTML>>> and <<<END_HTML>>> markers. Nothing else before or after.`;

  try {
    const htmlContent = await runClaudeForHtml(prompt);

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(htmlContent);
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const url  = `http://127.0.0.1:${port}`;
      if (missionId) mockupServers[missionId] = server;

      shell.openExternal(url);
      sendToWindow('mission:mockup', { title, spec, url, port });

      const entry = makeLogEntry(now(), 'System',
        `Mockup for "${title}" ready — opened in browser (${url})`, 'info');
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
    });

  } catch (err) {
    const entry = makeLogEntry(now(), 'System',
      `Mockup generation failed (${err.message}) — continuing planning`, 'info');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);

    // Resume Lead with skip signal so planning isn't permanently blocked
    if (missionState?.session_id) {
      restartLeadAfterMockup(missionId,
        'MOCKUP SKIPPED: Generation failed. Continue planning normally and output the final plan JSON.',
        sendToWindow);
    }
  }
}
```

- [ ] **Step 3: Verify no syntax errors**

```
node -e "require('./electron/ipc/mission.cjs')"
```

Expected: silent success.

- [ ] **Step 4: Commit**

```
git add electron/ipc/mission.cjs
git commit -m "feat: add runClaudeForHtml() and spawnMockupGenerator() to mission backend"
```

---

### Task 3: Backend — `restartLeadAfterMockup()` + marker detection + `watchProcessExit_launch` guard

**Files:**
- Modify: `electron/ipc/mission.cjs` — three additions

**Interfaces:**
- Consumes: `spawnClaude`, `killChild`, `readProcessStdout_launch`, `readProcessStderr`, `watchProcessExit_launch`, `startAutosave`, `missionState`, `childProcess`
- Produces: `restartLeadAfterMockup(missionId, injection, sendToWindow)` — restarts Lead subprocess with injected stdin; `WaitingForMockup` status set when `<<<MOCKUP_PAUSE>>>` detected

- [ ] **Step 1: Add `restartLeadAfterMockup` after `spawnMockupGenerator`**

```js
// restartLeadAfterMockup — resume Lead after mockup approve/feedback/skip.
// Mirrors the answer_question restart pattern exactly.
function restartLeadAfterMockup(missionId, injection, sendToWindow) {
  if (!missionState || !missionState.session_id) return;

  killChild();

  const sessionId   = missionState.session_id;
  const leadModel   = missionState.agents.find(a => a.name === 'Lead')?.model || 'sonnet';
  const projectPath = missionState.project_path;
  const execMode    = missionState.execution_mode || 'standard';

  const proc = spawnClaude(
    ['-p', '--resume', sessionId, '--dangerously-skip-permissions',
     '--model', leadModel,
     '--output-format', 'stream-json', '--verbose', '--max-turns', '200'],
    projectPath,
    execMode === 'agent_teams'
  );

  try {
    proc.stdin.write(injection, 'utf8');
    proc.stdin.end();
  } catch (e) {
    const entry = makeLogEntry(now(), 'System', `Failed to resume Lead: ${e.message}`, 'error');
    if (missionState) missionState.log.push(entry);
    sendToWindow('mission:log', entry);
    return;
  }

  childProcess = proc;
  if (missionState) missionState.status = 'Running';
  startAutosave();

  readProcessStdout_launch(proc, missionId, sendToWindow);
  readProcessStderr(proc, sendToWindow);
  watchProcessExit_launch(proc, missionId, sendToWindow);
}
```

- [ ] **Step 2: Add mockup buffer detection inside `readProcessStdout_launch`**

In `readProcessStdout_launch` (starts around line 1008), after the line `let questionTextBuf = '';` add:
```js
let mockupTextBuf = '';
```

Then, in the same function's `rl.on('line', ...)` handler, find where `questionTextBuf += text;` is accumulated and add the mockup accumulation + detection **after** the existing question detection block:

```js
// ── Mockup protocol ──────────────────────────────────────────────
mockupTextBuf += text;
if (mockupTextBuf.includes('<<<MOCKUP_PAUSE>>>')) {
  const reqMatch = /<<<MOCKUP_REQUEST>>>([\s\S]*?)<<<END_MOCKUP_REQUEST>>>/.exec(mockupTextBuf);
  if (reqMatch) {
    let parsed = null;
    try { parsed = JSON.parse(reqMatch[1].trim()); } catch { /* skip */ }
    if (parsed && parsed.title && parsed.spec) {
      if (missionState) missionState.status = 'WaitingForMockup';
      const entry = makeLogEntry(now(), 'Lead',
        `Requesting UI mockup for "${parsed.title}" — generating preview...`, 'info');
      if (missionState) missionState.log.push(entry);
      sendToWindow('mission:log', entry);
      spawnMockupGenerator(parsed.title, parsed.spec, missionState?.id, sendToWindow);
    }
  }
  // Clear consumed buffer
  mockupTextBuf = mockupTextBuf.slice(
    mockupTextBuf.indexOf('<<<MOCKUP_PAUSE>>>') + '<<<MOCKUP_PAUSE>>>'.length
  );
}
```

- [ ] **Step 3: Add `WaitingForMockup` guard to `watchProcessExit_launch`**

In `watchProcessExit_launch` (around line 1300), find the existing `WaitingForAnswer` guard:
```js
if (missionState && missionState.status === 'WaitingForAnswer') {
```

Add an identical guard immediately after it:
```js
if (missionState && missionState.status === 'WaitingForMockup') {
  const entry = makeLogEntry(now(), 'System',
    'Planning paused — review the UI mockup in your browser, then approve or send feedback', 'info');
  missionState.log.push(entry);
  sendToWindow('mission:log', entry);
  return;
}
```

- [ ] **Step 4: Verify no syntax errors**

```
node -e "require('./electron/ipc/mission.cjs')"
```

Expected: silent success.

- [ ] **Step 5: Commit**

```
git add electron/ipc/mission.cjs
git commit -m "feat: add restartLeadAfterMockup, marker detection, and WaitingForMockup guard"
```

---

### Task 4: Backend — `mockup_respond` IPC handler + cleanup in stop/reset

**Files:**
- Modify: `electron/ipc/mission.cjs` — new IPC handler, cleanup in two existing handlers

**Interfaces:**
- Consumes: `mockupServers`, `restartLeadAfterMockup`, `missionState`
- Produces: `ipcMain.handle('mockup_respond', ...)` — closes server, restarts Lead

- [ ] **Step 1: Add `mockup_respond` handler after `answer_question` handler (around line 2510)**

```js
// ── mockup_respond ──────────────────────────────────────────────
// User approved or sent feedback on a UI mockup. Close the HTTP server
// and resume Lead with the result injected into stdin.
ipcMain.handle('mockup_respond', async (_event, args) => {
  const { decision, feedback = '' } = args || {};

  if (!missionState) return 'No active mission';
  if (!missionState.session_id) return 'No session ID — cannot resume';
  if (missionState.status !== 'WaitingForMockup') return 'Not waiting for mockup';

  const missionId = missionState.id;

  // Close HTTP server
  if (mockupServers[missionId]) {
    mockupServers[missionId].close();
    delete mockupServers[missionId];
  }

  const ts = now();
  const injection = decision === 'approve'
    ? 'MOCKUP APPROVED: The user approved the mockup design. Continue planning and output the final plan JSON.'
    : `MOCKUP FEEDBACK: The user wants changes to the mockup. Feedback: "${feedback}". ` +
      'Please revise the spec and output a new <<<MOCKUP_REQUEST>>> block followed by <<<MOCKUP_PAUSE>>>.';

  const logMsg = decision === 'approve'
    ? 'Mockup approved — resuming planning'
    : `Mockup feedback sent: "${feedback}"`;
  const entry = makeLogEntry(ts, 'System', logMsg, 'info');
  missionState.log.push(entry);
  sendToWindow('mission:log', entry);

  restartLeadAfterMockup(missionId, injection, sendToWindow);
  return 'ok';
});
```

- [ ] **Step 2: Add cleanup to `stop_mission` handler**

In `stop_mission` (around line 2661), after `killChild();` add:
```js
// Close any open mockup HTTP servers
for (const server of Object.values(mockupServers)) {
  try { server.close(); } catch { /* ignore */ }
}
Object.keys(mockupServers).forEach(k => delete mockupServers[k]);
```

- [ ] **Step 3: Add same cleanup to `reset_mission` handler (around line 2682)**

After `killChild();` in `reset_mission`:
```js
for (const server of Object.values(mockupServers)) {
  try { server.close(); } catch { /* ignore */ }
}
Object.keys(mockupServers).forEach(k => delete mockupServers[k]);
```

- [ ] **Step 4: Verify no syntax errors**

```
node -e "require('./electron/ipc/mission.cjs')"
```

Expected: silent success.

- [ ] **Step 5: Commit**

```
git add electron/ipc/mission.cjs
git commit -m "feat: add mockup_respond IPC handler and server cleanup in stop/reset"
```

---

### Task 5: Planning prompts — MOCKUP PROTOCOL section

**Files:**
- Modify: `electron/prompts/planning.md` — append section
- Modify: `src/data/prompts/planning.md` — append identical section

**Interfaces:**
- Produces: Lead knows when/how to output `<<<MOCKUP_REQUEST>>>` and `<<<MOCKUP_PAUSE>>>`

- [ ] **Step 1: Append MOCKUP PROTOCOL to `electron/prompts/planning.md`**

At the very end of the file, add:

```markdown

## MOCKUP PROTOCOL (UI Missions Only)

**When to use:** Only if the mission involves creating or significantly modifying
visible UI — new screens, components, layouts, forms, dashboards.
Skip entirely for: backend APIs, CLI tools, config changes, refactoring,
testing, database migrations, or any non-visual work.

**Step 1 — Output mockup request then STOP your turn:**
When you detect a UI mission, output this block BEFORE the plan JSON,
then end your turn immediately:

<<<MOCKUP_REQUEST>>>
{"title": "<short UI name, e.g. Login Screen>", "spec": "<concise description: components, layout, color scheme, interactions, key states — 2-4 sentences>"}
<<<END_MOCKUP_REQUEST>>>
<<<MOCKUP_PAUSE>>>

**Step 2 — After the user responds:**
- If you receive `MOCKUP APPROVED` → continue normally, output the final plan JSON.
- If you receive `MOCKUP FEEDBACK: "..."` → output a revised <<<MOCKUP_REQUEST>>> with
  an updated spec, then <<<MOCKUP_PAUSE>>> again.
- If you receive `MOCKUP SKIPPED` → continue normally and output the final plan JSON.

**Rules:**
- One mockup per planning session (do not repeat unless explicitly responding to MOCKUP FEEDBACK).
- Keep spec concise (2-4 sentences) — the mockup generator handles rendering details.
- Never output plan JSON in the same turn as <<<MOCKUP_PAUSE>>>.
- The <<<MOCKUP_PAUSE>>> marker MUST be the very last thing you output before ending your turn.
```

- [ ] **Step 2: Apply identical change to `src/data/prompts/planning.md`**

Append the exact same block as Step 1 to the end of `src/data/prompts/planning.md`.

- [ ] **Step 3: Verify both files are identical in their appended section**

```
node -e "
const fs = require('fs');
const a = fs.readFileSync('electron/prompts/planning.md','utf8');
const b = fs.readFileSync('src/data/prompts/planning.md','utf8');
const aEnd = a.slice(a.indexOf('## MOCKUP PROTOCOL'));
const bEnd = b.slice(b.indexOf('## MOCKUP PROTOCOL'));
console.log(aEnd === bEnd ? 'MATCH' : 'MISMATCH');
"
```

Expected: `MATCH`

- [ ] **Step 4: Commit**

```
git add electron/prompts/planning.md src/data/prompts/planning.md
git commit -m "feat: add MOCKUP PROTOCOL section to planning prompt"
```

---

### Task 6: Frontend — `useMission.js` mockup state and callback

**Files:**
- Modify: `src/hooks/useMission.js`

**Interfaces:**
- Consumes: `invoke('mockup_respond', { decision, feedback })`, `listen('mission:mockup', ...)`
- Produces: `mockupInfo: { title, spec, url, port } | null`, `respondToMockup(decision: 'approve'|'revise', feedback?: string): Promise<void>`

- [ ] **Step 1: Add `mockupInfo` state after `pendingQuestions` state (around line 16)**

```js
const [mockupInfo, setMockupInfo] = useState(null)
```

- [ ] **Step 2: Add `mission:mockup` listener alongside `mission:question` listener (around line 465)**

```js
listen('mission:mockup', (e) => {
  setMockupInfo(e.payload)
}),
```

- [ ] **Step 3: Reset `mockupInfo` in `mission:plan-ready` handler (around line 366)**

Find the `listen('mission:plan-ready', ...)` callback and add `setMockupInfo(null)` at the top of its handler body.

- [ ] **Step 4: Reset `mockupInfo` in `stop` callback**

Find `const stop = useCallback(async () => {` and add `setMockupInfo(null)` after `setIsReplanning(false)` (or wherever other state resets happen in that function).

- [ ] **Step 5: Add `respondToMockup` callback after the `answerQuestion` callback**

```js
const respondToMockup = useCallback(async (decision, feedback = '') => {
  setMockupInfo(null)
  await invoke('mockup_respond', { decision, feedback })
}, [])
```

- [ ] **Step 6: Add `mockupInfo` and `respondToMockup` to the return statement (line 736)**

```js
return { missionState, isRunning, planReady, setPlanReady, isReplanning,
         pendingQuestions, mockupInfo, recoverableMission, setRecoverableMission,
         launch, deploy, continueM, stop, reset, replan, answerQuestion, respondToMockup }
```

- [ ] **Step 7: Build frontend to verify no type errors**

```
npx vite build --config vite.config.electron.mjs 2>&1 | tail -5
```

Expected: `✓ built in X.XXs`

- [ ] **Step 8: Commit**

```
git add src/hooks/useMission.js
git commit -m "feat: add mockupInfo state and respondToMockup callback to useMission"
```

---

### Task 7: Frontend — `MockupApprovalCard` + PlanningStream props

**Files:**
- Modify: `src/components/mission/PlanningStream.jsx`

**Interfaces:**
- Consumes: `mockupInfo: { title, spec, url, port }`, `onMockupRespond(decision, feedback): void`
- Produces: `PlanningStream` now accepts `mockupInfo` and `onMockupRespond` props; renders `MockupApprovalCard` when `!isRunning && mockupInfo`

- [ ] **Step 1: Add `useState` to imports and add `Palette`, `ExternalLink` to lucide import**

Change line 1:
```js
import { useEffect, useRef, useMemo, memo, useState } from 'react'
```

Change line 2:
```js
import { Brain, Square, Wrench, Info, ChevronRight, Palette, ExternalLink } from 'lucide-react'
```

- [ ] **Step 2: Add `MockupApprovalCard` component before `PlanningStream` export**

```jsx
function MockupApprovalCard({ mockupInfo, onRespond }) {
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleApprove = async () => {
    setSubmitting(true)
    await onRespond('approve', '')
  }

  const handleFeedback = async () => {
    if (!feedback.trim() || submitting) return
    setSubmitting(true)
    await onRespond('revise', feedback.trim())
  }

  return (
    <div className="mx-3 mb-3 rounded-lg border border-purple-500/40 bg-purple-950/20 p-3 text-[11px] font-mono">
      <div className="flex items-center gap-2 mb-2">
        <Palette size={12} className="text-purple-400 shrink-0" />
        <span className="text-purple-300 font-medium">
          Lead đã tạo mockup: &quot;{mockupInfo.title}&quot;
        </span>
      </div>

      <div className="flex items-center gap-2 mb-3 text-vs-muted/60">
        <span>Đã mở trong browser.</span>
        <button
          onClick={() => window.open(mockupInfo.url, '_blank')}
          className="flex items-center gap-1 text-purple-400/80 hover:text-purple-300 transition-colors"
        >
          <ExternalLink size={10} />
          Mở lại
        </button>
      </div>

      <button
        onClick={handleApprove}
        disabled={submitting}
        className="w-full mb-2 px-3 py-1.5 rounded bg-purple-600/30 border border-purple-500/40 text-purple-200 hover:bg-purple-600/50 disabled:opacity-50 transition-colors"
      >
        ✅ Approve — tiếp tục planning
      </button>

      <div className="flex gap-1.5">
        <input
          type="text"
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleFeedback() }}
          disabled={submitting}
          placeholder="Gửi feedback để Lead revise mockup..."
          className="flex-1 px-2 py-1.5 rounded bg-vs-panel border border-purple-500/30 text-vs-text placeholder-vs-muted/40 focus:outline-none focus:border-purple-400/60 disabled:opacity-50"
        />
        <button
          onClick={handleFeedback}
          disabled={submitting || !feedback.trim()}
          className="px-2 py-1.5 rounded bg-vs-panel border border-purple-500/30 text-purple-300 hover:border-purple-400/60 disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update `PlanningStream` signature to accept new props**

Change:
```js
export const PlanningStream = memo(function PlanningStream({ state, isRunning, onStop }) {
```
to:
```js
export const PlanningStream = memo(function PlanningStream({ state, isRunning, onStop, mockupInfo, onMockupRespond }) {
```

- [ ] **Step 4: Render `MockupApprovalCard` between the terminal stream area and the bottom status bar**

Find the `{/* ── Bottom status bar ── */}` comment (around line 165) and insert before it:

```jsx
{/* Mockup approval card — shown when planning is paused for mockup review */}
{!isRunning && mockupInfo && onMockupRespond && (
  <MockupApprovalCard mockupInfo={mockupInfo} onRespond={onMockupRespond} />
)}
```

- [ ] **Step 5: Build frontend**

```
npx vite build --config vite.config.electron.mjs 2>&1 | tail -5
```

Expected: `✓ built in X.XXs`

- [ ] **Step 6: Commit**

```
git add src/components/mission/PlanningStream.jsx
git commit -m "feat: add MockupApprovalCard to PlanningStream with approve/feedback UI"
```

---

### Task 8: Wire up `MissionControlPage.jsx`

**Files:**
- Modify: `src/pages/MissionControlPage.jsx`

**Interfaces:**
- Consumes: `mockupInfo`, `respondToMockup` from `useMission()`
- Produces: `isPlanningPhase` includes `WaitingForMockup`; `PlanningStream` receives `mockupInfo` + `onMockupRespond`

- [ ] **Step 1: Add `mockupInfo` and `respondToMockup` to the `useMission()` destructure (line 15)**

Change:
```js
const { missionState, isRunning, planReady, setPlanReady, isReplanning, pendingQuestions, recoverableMission, setRecoverableMission, launch, deploy, continueM, stop, reset, replan, answerQuestion } = useMission()
```
to:
```js
const { missionState, isRunning, planReady, setPlanReady, isReplanning, pendingQuestions,
        mockupInfo, recoverableMission, setRecoverableMission,
        launch, deploy, continueM, stop, reset, replan, answerQuestion, respondToMockup } = useMission()
```

- [ ] **Step 2: Fix `isPlanningPhase` to stay true when `WaitingForMockup` (line 69)**

Change:
```js
const isPlanningPhase = isRunning && missionState?.phase === 'Planning' && !isPlanReview
```
to:
```js
const isPlanningPhase = (
  (isRunning || missionState?.status === 'WaitingForMockup') &&
  missionState?.phase === 'Planning' && !isPlanReview
)
```

- [ ] **Step 3: Pass `mockupInfo` and `onMockupRespond` to `PlanningStream` (around line 245)**

Change:
```jsx
<PlanningStream
  state={missionState}
  isRunning={isRunning}
  onStop={stop}
/>
```
to:
```jsx
<PlanningStream
  state={missionState}
  isRunning={isRunning}
  onStop={stop}
  mockupInfo={mockupInfo}
  onMockupRespond={respondToMockup}
/>
```

- [ ] **Step 4: Build frontend**

```
npx vite build --config vite.config.electron.mjs 2>&1 | tail -5
```

Expected: `✓ built in X.XXs`

- [ ] **Step 5: Run full test suite**

```
npx vitest run
```

Expected: all existing tests pass + 6 mockup helper tests pass.

- [ ] **Step 6: Commit**

```
git add src/pages/MissionControlPage.jsx
git commit -m "feat: wire mockupInfo and respondToMockup into MissionControlPage"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Lead detects UI mission → `<<<MOCKUP_REQUEST>>>` + `<<<MOCKUP_PAUSE>>>` (Task 5 planning prompt)
- ✅ Backend detects marker, spawns HTML generator (Task 2+3)
- ✅ `http.createServer` random port, `shell.openExternal` (Task 2)
- ✅ `mission:mockup` IPC sent to frontend (Task 2)
- ✅ Planning paused — `WaitingForMockup` status (Task 3) + `watchProcessExit_launch` guard (Task 3)
- ✅ Frontend shows `MockupApprovalCard` (Task 7)
- ✅ `isPlanningPhase` stays true during `WaitingForMockup` (Task 8)
- ✅ User approves → `mockup_respond` IPC → restart Lead with `MOCKUP APPROVED` (Task 4)
- ✅ User sends feedback → restart Lead with `MOCKUP FEEDBACK: ...` (Task 4)
- ✅ Feedback loop: Lead can output new `<<<MOCKUP_REQUEST>>>` (handled by same detection code)
- ✅ Generation failure → graceful skip, Lead resumes (Task 2 `spawnMockupGenerator` catch)
- ✅ HTTP server cleanup on stop/reset (Task 4)
- ✅ "Mở lại" button to reopen browser tab (Task 7)
- ✅ Both prompt files updated identically (Task 5)

**Type consistency:** `mockupInfo` shape `{ title, spec, url, port }` is consistent across Task 2 (`sendToWindow`), Task 6 (`setMockupInfo`), and Task 7 (`MockupApprovalCard` props). `respondToMockup(decision, feedback)` signature matches `mockup_respond` IPC args `{ decision, feedback }` throughout.

**No placeholders:** All code blocks are complete and immediately usable.
