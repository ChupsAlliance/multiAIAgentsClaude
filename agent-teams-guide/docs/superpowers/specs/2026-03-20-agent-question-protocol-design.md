# Agent Question Protocol — Design Spec

**Date:** 2026-03-20
**Status:** Draft
**Author:** Brainstorming session

---

## Problem

During mission execution, the Lead agent (and indirectly, subagents) may encounter situations where the provided documentation, reference materials, or project context is insufficient to make a confident decision. Currently there is **no mechanism** for the Claude CLI process to ask the user a question and wait for a response — stdin is closed after the initial prompt is written.

This leads to:
- Agents making incorrect assumptions → wasted work
- Users having to stop missions, provide context via Intervention Panel, and restart
- No structured Q&A history for future reference

## Solution Overview

Add a **Question Protocol** that enables the Lead agent to pause the mission and ask the user for input via structured markers in stdout. The app parses these markers, presents questions in the UI, collects answers, and writes them back to the Claude process via stdin.

### Permission Modes

Three permission modes, selectable by the user before deploying a mission:

| Mode | Display Name | Behavior | Default |
|------|-------------|----------|---------|
| `auto` | Auto-pilot | Agents run autonomously. If Lead outputs a question marker, the app auto-answers with `__AUTO__` and logs the event. No pause. | **Yes** |
| `interactive` | Interactive | Lead can ask questions. Mission pauses, UI shows question cards, user answers, mission resumes. | No |
| `plan-only` | Plan Only | Only runs Planning phase. Stops at ReviewPlan. No execution. | No |

**Default is `auto`** to preserve current behavior — existing users see no change unless they opt into Interactive.

### Who Can Ask

- **Subagents → Lead**: Subagents ask Lead via `SendMessage`. This is handled entirely within the Claude CLI process (no UI involvement).
- **Lead → User**: Only Lead can trigger the Question Protocol. Lead decides whether to answer a subagent's question from its own knowledge or escalate to the user.
- **Subagents → User**: Not allowed. Subagents have no direct channel to the user.

---

## Technical Design

### 1. Stdin Pipe (Backend)

**Current:** `child_process.spawn` with `stdio: ['pipe', 'pipe', 'pipe']`. After writing the prompt, `proc.stdin.end()` is called immediately.

**Change:** When `permissionMode === 'interactive'`, keep stdin open:

```js
proc.stdin.write(prompt + '\n')
if (permissionMode === 'interactive') {
  missionState.stdinOpen = true
  // Do NOT call proc.stdin.end()
} else {
  proc.stdin.end()  // current behavior
}
```

### 2. Question Markers (Output Protocol)

Lead outputs structured markers that the app's stream parser detects:

```
<<<QUESTION>>>
{
  "from": "Lead",
  "type": "clarification",
  "question": "API authentication nên dùng JWT hay session-based?",
  "options": ["JWT", "Session-based", "OAuth2"],
  "context": "Backend API is stateless, frontend is SPA. Need to decide before implementing auth module."
}
<<<END_QUESTION>>>
```

**Fields:**
- `from` (string): Always "Lead" (subagents cannot ask user directly)
- `type` (string): `"clarification"` | `"decision"` | `"credentials"` | `"information"`
- `question` (string): The question text
- `options` (string[], optional): Predefined options for quick selection
- `context` (string, optional): Why the agent needs this answered

**Multiple questions:** Lead can output multiple `<<<QUESTION>>>` blocks. The app collects them all before presenting to the user.

### 3. Answer Markers (Input Protocol)

App writes answers back to stdin:

```
<<<ANSWER>>>
{
  "answers": [
    { "question_index": 0, "answer": "JWT", "note": "Stateless API, frontend SPA" },
    { "question_index": 1, "answer": "PostgreSQL", "note": "" }
  ]
}
<<<END_ANSWER>>>
```

**Special answers:**
- Skip: `{"answer": "__SKIP__", "note": "User skipped. Choose the most optimal approach that best fits the current architecture."}`
- Auto-mode: `{"answer": "__AUTO__", "note": "Auto mode — choose the most optimal approach that best fits the current architecture."}`

### 4. Stream Parser Changes (Backend)

In `readProcessStdout_deploy()`, add marker detection:

```
State machine:
  NORMAL → detect "<<<QUESTION>>>" → COLLECTING_QUESTION
  COLLECTING_QUESTION → detect "<<<END_QUESTION>>>" → parse JSON → emit event → NORMAL (or collect more)

  Detect end of question batch: if no new <<<QUESTION>>> within 500ms after last <<<END_QUESTION>>>, treat batch as complete.
```

**Events emitted:**
- `mission:question` — `{ questions: [...], timestamp }` — batch of questions
- `mission:answer-sent` — `{ answers: [...] }` — confirmation after writing to stdin

### 5. IPC Handler (Backend)

New IPC command:

```js
ipcMain.handle('answer_question', async (_, { answers }) => {
  if (!missionState?.stdinOpen || !missionState?.process?.stdin?.writable) {
    throw new Error('No writable stdin — mission may have ended')
  }

  const payload = JSON.stringify({ answers })
  missionState.process.stdin.write(`<<<ANSWER>>>\n${payload}\n<<<END_ANSWER>>>\n`)

  missionState.pendingQuestions = null
  missionState.status = 'Running'

  mainWindow.webContents.send('mission:answer-sent', { answers })

  // Log Q&A for history
  missionState.questionHistory = missionState.questionHistory || []
  for (const a of answers) {
    missionState.questionHistory.push({
      question: missionState._lastQuestions?.[a.question_index]?.question,
      answer: a.answer,
      note: a.note,
      timestamp: Date.now(),
    })
  }
})
```

### 6. Auto Mode Handler (Backend)

When `permissionMode === 'auto'` and question markers are detected:

```js
if (permissionMode === 'auto') {
  const autoAnswers = questions.map((q, i) => ({
    question_index: i,
    answer: '__AUTO__',
    note: 'Auto mode — choose the most optimal approach that best fits the current architecture.',
  }))
  proc.stdin.write(`<<<ANSWER>>>\n${JSON.stringify({ answers: autoAnswers })}\n<<<END_ANSWER>>>\n`)

  // Log
  mainWindow.webContents.send('mission:log', {
    agent: 'System',
    text: `Question auto-resolved (auto mode): "${questions.map(q => q.question).join('"; "')}"`,
  })
  return  // No pause, no UI
}
```

---

## Frontend Design

### 1. Permission Mode Selector (MissionLauncher)

Add to launcher form, next to Execution Mode:

```
Permission Mode
┌──────────────┐ ┌─────────────┐ ┌──────────────┐
│ ● Auto-pilot │ │ Interactive │ │  Plan only   │
│   (default)  │ │             │ │              │
└──────────────┘ └─────────────┘ └──────────────┘
Description text below based on selection
```

- Persisted in `localStorage` key `permission_mode`
- Passed to `launch()` and then to backend `launch_mission`/`deploy_mission`

### 2. QuestionCard Component (NEW)

Multi-question UI similar to Claude Code's `AskUserQuestion`:

```
┌──────────────────────────────────────────────────┐
│ ⏸ Lead has 3 questions               2/3 answered│
│                                                    │
│ ┌────────┐ ┌────────┐ ┌────────┐                 │
│ │ Q1 ✓  │ │ Q2 ●  │ │ Q3     │  ← Tab switcher  │
│ └────────┘ └────────┘ └────────┘                 │
│                                                    │
│ Q2: Database engine nào cho analytics module?      │
│                                                    │
│ Context: Need OLAP-friendly DB for time-series     │
│ aggregations on transaction data.                  │
│                                                    │
│ ┌───────────┐ ┌──────────┐ ┌───────────────┐     │
│ │ PostgreSQL│ │ ClickHouse│ │ TimescaleDB   │     │
│ └───────────┘ └──────────┘ └───────────────┘     │
│                                                    │
│ ┌────────────────────────────────────────────────┐│
│ │ Custom answer or additional notes...           ││
│ └────────────────────────────────────────────────┘│
│                                                    │
│ [Skip this question]                               │
│                                                    │
│ ═══════════════════════════════════════════════════│
│ [Submit All Answers ▶]                             │
└──────────────────────────────────────────────────┘
```

**Features:**
- Tab switcher to navigate between questions freely
- Badge: `✓` answered, `●` current, empty = unanswered
- Counter: `2/3 answered`
- Each question: options (if any) + free text textarea
- Skip per question: fills `__SKIP__` answer
- **Submit All Answers**: enabled when all questions answered or skipped. Sends batch to backend.
- Browser notification if app tab not focused

### 3. Dashboard Integration

- **Status bar**: When `pendingQuestions` exists → amber background, `"⏸ Waiting for your answer"`, pulse animation
- **QuestionCard**: Rendered prominently above the log stream
- **InterventionPanel**: Disabled while waiting for answer. Tooltip: `"Trả lời câu hỏi trước khi gửi intervention"`
- **Elapsed timer**: Continues counting (shows total mission time including wait time)

### 4. State Management (useMission hook)

New state fields:

```js
pendingQuestions: null,    // [{ from, type, question, options?, context? }] or null
permissionMode: 'auto',   // 'auto' | 'interactive' | 'plan-only'
questionHistory: [],       // [{ question, answer, note, timestamp }]
```

New event listeners:

```js
listen('mission:question', ({ questions }) => {
  setPendingQuestions(questions)
  setStatus('WaitingForAnswer')
})

listen('mission:answer-sent', () => {
  setPendingQuestions(null)
  setStatus('Running')
})
```

New action:

```js
const answerQuestion = async (answers) => {
  await invoke('answer_question', { answers })
}
```

---

## Prompt Template Changes

### deploy_agent_teams.md / deploy_standard.md

Add conditional section based on permission mode:

**When `interactive`:**

```markdown
## QUESTION PROTOCOL (Interactive Mode)

When you genuinely cannot proceed without user input — missing critical information
that is not available in the provided documents, reference materials, or project files:

1. Output this EXACT format:
<<<QUESTION>>>
{"from":"Lead","type":"clarification","question":"...","options":["A","B"],"context":"..."}
<<<END_QUESTION>>>

2. You may output multiple <<<QUESTION>>> blocks if you have several questions.

3. After all questions, STOP and WAIT for:
<<<ANSWER>>>
{"answers":[{"question_index":0,"answer":"...","note":"..."}]}
<<<END_ANSWER>>>

4. Continue based on the answers.

RULES:
- Only YOU (Lead) can ask the user. Subagents ask you via SendMessage.
- You decide whether to answer subagents from your knowledge or escalate to the user.
- Only ask when you truly lack critical information that would lead to wrong decisions.
- Prefer making informed decisions autonomously when possible.
- If you've already asked multiple questions, strongly consider deciding on your own.
```

**When `auto`:**

```markdown
## AUTONOMOUS MODE
You are running in autonomous mode. Make all decisions independently.
Choose the most optimal approach that best fits the current project architecture.
Do NOT output <<<QUESTION>>> markers. If you receive an auto-answer, proceed with your best judgment.
```

### continue_agent_teams.md / continue_standard.md

Same conditional injection for continue prompts.

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| User clicks Stop while WaitingForAnswer | Kill process normally, clear pendingQuestions |
| Process crashes while waiting | Detect exit code, status → Failed, clear pendingQuestions |
| User closes app while waiting | On reopen, pendingQuestions lost → mission treated as stopped |
| Intervention while WaitingForAnswer | InterventionPanel disabled with tooltip |
| auto mode but Lead outputs question marker | Auto-answer with `__AUTO__`, log event, no pause |
| plan-only mode | Mission stops at ReviewPlan, question protocol never reached |
| Question during Planning phase | Same mechanism — Planning also spawns Claude CLI with stdout stream |
| stdin becomes unwritable | Catch error, show "Mission ended unexpectedly", set status to Failed |
| Lead asks question but process exits before answer | Detect exit, show "Mission ended while waiting for your answer" |

---

## History Persistence

When saving mission to history, include Q&A log:

```json
{
  "question_history": [
    {
      "question": "API auth method?",
      "answer": "JWT",
      "note": "Stateless API",
      "timestamp": 1234567890
    }
  ],
  "permission_mode": "interactive"
}
```

When forking from history, inject Q&A into planning prompt so Lead knows previous decisions:

```markdown
## Previous Q&A Decisions
- Q: "API auth method?" → A: "JWT" (Note: Stateless API)
- Q: "Database engine?" → A: "PostgreSQL"
```

---

## Files to Create/Modify

| File | Change |
|------|--------|
| `electron/ipc/mission.cjs` | Stdin open logic, question marker parser, `answer_question` IPC, auto-answer handler |
| `electron/prompts/deploy_agent_teams.md` | Add `QUESTION PROTOCOL` conditional section |
| `electron/prompts/deploy_standard.md` | Same |
| `electron/prompts/continue_agent_teams.md` | Same |
| `electron/prompts/continue_standard.md` | Same |
| `src/hooks/useMission.js` | `pendingQuestions`, `permissionMode`, `questionHistory`, `answerQuestion()`, event listeners |
| `src/components/mission/QuestionCard.jsx` | **NEW** — Multi-question UI with tabs, options, free text, skip, submit |
| `src/components/mission/MissionDashboard.jsx` | Render QuestionCard, disable Intervention, status bar changes |
| `src/components/mission/MissionLauncher.jsx` | Permission Mode selector |
| `src/components/mission/InterventionPanel.jsx` | Disable when pendingQuestions, show tooltip |
| `src/data/changelog.js` | Add to Unreleased section |
| `tests/run_all.cjs` | New test suites for question protocol |
