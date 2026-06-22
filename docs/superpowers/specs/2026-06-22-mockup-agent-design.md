# Mockup Agent — Design Spec
Date: 2026-06-22

## Overview

During the planning phase, Lead autonomously detects UI-related missions and spawns a mockup
subagent. The user sees an HTML mockup in their default browser and can approve or send feedback
before planning continues. The loop repeats until the user approves, then Lead outputs the final
plan JSON.

---

## Architecture & Data Flow

```
Lead (planning subprocess)
  │
  ├── Detects UI mission → outputs:
  │     <<<MOCKUP_REQUEST>>>{"title":"...", "spec":"..."}<<<END_MOCKUP_REQUEST>>>
  │     <<<MOCKUP_PAUSE>>>
  │     [Lead exits — same pattern as Question Protocol]
  │
  ▼
readProcessStdout_launch (electron/ipc/mission.cjs)
  │  detects <<<MOCKUP_PAUSE>>> → parses JSON spec
  │
  ├─→ spawnMockupGenerator(title, spec, missionId, sendToWindow)
  │     └── spawn `claude -p "Generate HTML..."` subprocess
  │         collect <<<HTML>>>...<<<END_HTML>>> from stdout
  │
  ├─→ http.createServer → listen(0) → random port
  │     shell.openExternal('http://localhost:PORT')
  │
  └─→ sendToWindow('mission:mockup', { title, spec, url, port })
        │
        ▼
  useMission.js — set mockupInfo state, phase stays = 'Planning'
        │
        ▼
  PlanningStream.jsx — shows MockupApprovalCard
        │
        ├── Approve → invoke('mockup_respond', { decision:'approve' })
        └── Feedback → invoke('mockup_respond', { decision:'revise', feedback })
              │
              ▼
        mission.cjs — closes HTTP server
              restarts Lead, injects result into stdin:
              "MOCKUP APPROVED" or "MOCKUP FEEDBACK: [text]"
              │
              ▼
        Lead reads result → continues plan or outputs new <<<MOCKUP_REQUEST>>>
```

**Phase state machine:**
- `Planning` + Lead running → normal planning stream
- `Planning` + Lead stopped + `mockupInfo` set → MockupApprovalCard shown, waiting
- `Planning` + Lead stopped + plan JSON detected → advance to `ReviewPlan`

---

## Backend (electron/ipc/mission.cjs)

### Marker detection in `readProcessStdout_launch`

Added alongside `<<<QUESTIONS_END>>>` detection:

```js
if (buf.includes('<<<MOCKUP_PAUSE>>>')) {
  const reqMatch = /<<<MOCKUP_REQUEST>>>([\s\S]*?)<<<END_MOCKUP_REQUEST>>>/.exec(buf)
  if (reqMatch) {
    const { title, spec } = JSON.parse(reqMatch[1].trim())
    spawnMockupGenerator(title, spec, missionId, sendToWindow)
  }
  // Lead already exited after outputting the marker — no kill needed
}
```

### `spawnMockupGenerator(title, spec, missionId, sendToWindow)`

Spawns a `claude` subprocess with a focused HTML-generation prompt. Collects
`<<<HTML>>>...<<<END_HTML>>>` from stdout. Starts `http.createServer` on a random port,
calls `shell.openExternal`, sends `mission:mockup` IPC.

```js
async function spawnMockupGenerator(title, spec, missionId, sendToWindow) {
  const prompt = `Generate a self-contained HTML mockup for: "${title}".
Spec: ${spec}
Rules: no external dependencies, inline CSS only, dark VS Code theme (#1e1e1e bg, #d4d4d4 text).
Output ONLY the HTML wrapped in <<<HTML>>> and <<<END_HTML>>> markers.`

  const htmlContent = await runClaudeForHtml(prompt)

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(htmlContent)
  })
  server.listen(0, () => {
    const port = server.address().port
    const url = `http://localhost:${port}`
    mockupServers[missionId] = server
    shell.openExternal(url)
    sendToWindow('mission:mockup', { title, spec, url, port })
  })
}
```

### IPC handler `mockup_respond`

```js
ipcMain.handle('mockup_respond', async (event, { missionId, decision, feedback }) => {
  mockupServers[missionId]?.close()
  delete mockupServers[missionId]

  const injection = decision === 'approve'
    ? 'MOCKUP APPROVED: User approved the mockup. Continue planning and output the final plan JSON.'
    : `MOCKUP FEEDBACK: User rejected the mockup. Feedback: "${feedback}". Revise the spec and output a new <<<MOCKUP_REQUEST>>>.`

  restartLeadWithInjection(missionId, injection, sendToWindow)
})
```

### Module-level state

```js
const mockupServers = {}  // missionId → http.Server
```

Cleanup on `stop_mission` or mission complete:
```js
Object.values(mockupServers).forEach(s => s.close())
```

---

## Planning Prompt (electron/prompts/planning.md + src/data/prompts/planning.md)

New section added before output format:

```markdown
## MOCKUP PROTOCOL (UI Missions Only)

**When to use:** Only if the mission involves creating or significantly modifying
visible UI — new screens, components, layouts, forms, dashboards.
Skip entirely for: backend APIs, CLI tools, config changes, refactoring,
testing, database migrations, or any non-visual work.

**Step 1 — Output mockup request then STOP:**
When you detect a UI mission, output this block BEFORE the plan JSON,
then end your turn immediately:

<<<MOCKUP_REQUEST>>>
{"title": "<short UI name, e.g. Login Screen>", "spec": "<concise description: components, layout, color scheme, interactions, key states>"}
<<<END_MOCKUP_REQUEST>>>
<<<MOCKUP_PAUSE>>>

**Step 2 — After user responds:**
- If you receive `MOCKUP APPROVED` → continue normally, output the final plan JSON.
- If you receive `MOCKUP FEEDBACK: "..."` → output a revised <<<MOCKUP_REQUEST>>>
  with an updated spec, then <<<MOCKUP_PAUSE>>> again.

**Rules:**
- One mockup per planning session (do not spawn multiple unless in a feedback loop).
- Keep spec concise (2-4 sentences) — the mockup generator handles rendering details.
- Never output plan JSON in the same turn as <<<MOCKUP_PAUSE>>>.
```

Both files (`electron/prompts/planning.md` and `src/data/prompts/planning.md`) must be updated identically.

---

## Frontend

### `useMission.js`

New state:
```js
const [mockupInfo, setMockupInfo] = useState(null)  // { title, spec, url, port }
```

New listener:
```js
listen('mission:mockup', (e) => {
  setMockupInfo(e.payload)
}),
```

New callback:
```js
const respondToMockup = useCallback(async (decision, feedback = '') => {
  await invoke('mockup_respond', { missionId: missionState?.id, decision, feedback })
  setMockupInfo(null)
}, [missionState?.id])
```

Reset `mockupInfo` to `null` on `stop_mission` and when `mission:plan-ready` fires.

### `PlanningStream.jsx`

New props: `mockupInfo`, `onMockupRespond`

MockupApprovalCard shown when `!isRunning && mockupInfo`:

```
┌─────────────────────────────────────────────────────┐
│ 🎨  Lead đã tạo mockup: "Login Screen"              │
│     Đang mở trong browser...                        │
│                                                     │
│  [↗ Mở lại]                                        │
│                                                     │
│  ✅ Approve — tiếp tục planning                     │
│                                                     │
│  Hoặc gửi feedback để Lead revise:                  │
│  ┌───────────────────────────────────────────────┐  │
│  │ Thêm dark mode toggle ở góc trên phải...      │  │
│  └───────────────────────────────────────────────┘  │
│  [Send feedback]                                    │
└─────────────────────────────────────────────────────┘
```

Style: `border-purple-500/40`, icon `Palette` from lucide-react.
Distinguishable from QuestionCard (orange border).

### Parent component

Pass `mockupInfo` and `onMockupRespond={respondToMockup}` down to `PlanningStream`.

---

## Files Changed

| File | Change |
|------|--------|
| `electron/ipc/mission.cjs` | `mockupServers` map, detect `<<<MOCKUP_PAUSE>>>` in `readProcessStdout_launch`, `spawnMockupGenerator()`, `runClaudeForHtml()`, `mockup_respond` IPC handler, cleanup on stop |
| `electron/prompts/planning.md` | Add MOCKUP PROTOCOL section |
| `src/data/prompts/planning.md` | Same — kept in sync |
| `src/hooks/useMission.js` | `mockupInfo` state, `mission:mockup` listener, `respondToMockup` callback, reset on stop/plan-ready |
| `src/components/mission/PlanningStream.jsx` | `MockupApprovalCard` component, new props |
| Parent of `PlanningStream` | Pass `mockupInfo` + `onMockupRespond` props |

---

## Edge Cases

- **mockup generator fails** (Claude subprocess errors) → send `mission:log` error entry, skip mockup, restart Lead with `"MOCKUP SKIPPED: generation failed, continue planning normally."`
- **user stops mission while mockup pending** → `stop_mission` closes HTTP server via `mockupServers` cleanup
- **port conflict** → `listen(0)` uses OS-assigned random port, no conflict possible
- **Lead outputs plan JSON before mockup feedback** → impossible by protocol (Lead exits at `<<<MOCKUP_PAUSE>>>` and does not run again until `restartLeadWithInjection`)
- **non-UI mission** → Lead skips the protocol entirely, planning continues unmodified
