# Transparent Sub-Agent Prompts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move sub-agent prompt construction from the Lead LLM (blackbox) into the app, display them in `PromptPreview` for user review/edit, and pass them verbatim to Lead for spawning.

**Architecture:** `buildAgentPrompt()` in `planMarkdown.js` is the single source of truth for the prompt template. `PromptPreview.jsx` calls it to initialize each agent's prompt, lets the user edit, then passes the final `agentPrompts` dict separately (not as `customPrompt`) through `useMission.deploy()` to `mission.cjs`. The IPC handler builds an agent block with a verbatim `prompt` fenced block. Both deploy prompt templates tell Lead to use that block character-for-character.

**Tech Stack:** React (JSX), Node.js/Electron IPC (CJS), Markdown prompt templates

---

## File Map

| File | What changes |
|---|---|
| `src/utils/planMarkdown.js` | Add `buildAgentPrompt(agent, agentTasks, meta)` export |
| `src/components/mission/PromptPreview.jsx` | Replace local `generateAgentPrompt()` with `buildAgentPrompt()`; change `onConfirm` to pass `(agents, tasks, agentPrompts)` |
| `src/pages/MissionControlPage.jsx` | Update `handlePromptConfirmed` signature to `(agents, tasks, agentPrompts)` |
| `src/hooks/useMission.js` | Add `agentPrompts` param to `deploy()`; forward to `invoke('deploy_mission')` |
| `electron/ipc/mission.cjs` | Accept `agentPrompts` in `deploy_mission`; inject verbatim when present |
| `electron/prompts/deploy_agent_teams.md` | Replace "build prompt using format" with "use verbatim `prompt` block" |
| `electron/prompts/deploy_standard.md` | Same change as `deploy_agent_teams.md` |

---

## Task 1: Add `buildAgentPrompt()` to `planMarkdown.js`

**Files:**
- Modify: `agent-teams-guide/src/utils/planMarkdown.js` (append after existing exports)

- [ ] **Step 1: Add the export at the bottom of `planMarkdown.js`**

Open `src/utils/planMarkdown.js`. After the `escapeRegex` helper at the bottom of the file, add:

```js
// ─── buildAgentPrompt ─────────────────────────────────────────────────────

/**
 * Build a complete, verbatim sub-agent prompt from plan data.
 * This is the single source of truth for what each sub-agent receives.
 *
 * @param {Object} agent      - { name, role, customPrompt, skillFile }
 * @param {Array}  agentTasks - [{ title, detail, priority }] — only this agent's tasks
 * @param {Object} meta       - { projectPath }
 * @returns {string} full prompt string
 */
export function buildAgentPrompt(agent, agentTasks, meta = {}) {
  const name = agent.name || 'agent'
  const role = agent.role || 'Developer'
  const proj = (meta.projectPath || '').replace(/\\/g, '/')

  // Separate skill content (loaded from skillFile) from short custom instructions
  const hasSkill = !!(agent.skillFile && agent.customPrompt)
  const skillContent = hasSkill ? agent.customPrompt : ''
  const customInstructions = (!hasSkill && agent.customPrompt) ? agent.customPrompt : ''

  const lines = []

  // ── Identity ──
  lines.push(`You are '${name}', a ${role} in team 'mission'.`)
  lines.push(`Working directory: ${proj}`)

  // ── Skill injection (verbatim, before tasks) ──
  if (skillContent) {
    lines.push('')
    lines.push(skillContent)
  }

  // ── Tasks ──
  lines.push('')
  lines.push('## Tasks')
  lines.push('')
  if (agentTasks.length === 0) {
    lines.push('(No tasks assigned)')
    lines.push('')
  } else {
    agentTasks.forEach((task, i) => {
      const pri = (task.priority || 'medium').toUpperCase()
      lines.push(`### ${i + 1}. [${pri}] ${task.title}`)
      if (task.detail && task.detail.trim()) {
        lines.push(task.detail.trim())
      }
      lines.push('')
    })
  }

  // ── Execution Protocol ──
  lines.push('## Execution Protocol')
  lines.push('')
  lines.push(`A) SETUP      — cd into ${proj}. Read existing files before writing anything.`)
  lines.push( 'B) IMPLEMENT  — Write ALL files completely. No stubs, no TODOs, no placeholder functions.')
  lines.push( 'C) BUILD      — Run the project\'s build/verify command (npm run build, cargo build, pytest…).')
  lines.push( '                Read ENTIRE output. Fix errors and retry until 0 errors.')
  lines.push(`D) EVIDENCE   — Print these exact lines when done:`)
  lines.push(`                [${name}] BUILD_RESULT: PASS  (or FAIL: <error summary>)`)
  lines.push(`                [${name}] FILES_WRITTEN: <comma-separated list>`)
  lines.push(`                [${name}] Completed: <task>  (one line per task)`)
  lines.push( 'E) COMMUNICATE — Use SendMessage to ask Lead BEFORE guessing on anything unclear.')
  lines.push( '                 Report completion to Lead via SendMessage when all tasks are done.')

  // ── Additional instructions (short, user-supplied) ──
  if (customInstructions) {
    lines.push('')
    lines.push('## Additional Instructions')
    lines.push(customInstructions)
  }

  // ── Critical Rules ──
  lines.push('')
  lines.push('## Critical Rules')
  lines.push('- Do NOT report done if build fails. Fix it first.')
  lines.push('- Do NOT write empty files or stub functions.')
  lines.push('- If unsure about ANYTHING, ask Lead via SendMessage first.')

  return lines.join('\n')
}
```

- [ ] **Step 2: Verify the export exists**

Run in `agent-teams-guide/`:
```bash
node -e "const { buildAgentPrompt } = require('./src/utils/planMarkdown.js'); console.log(typeof buildAgentPrompt)"
```
Expected output: `function`

> Note: If the above fails because planMarkdown.js uses ES module syntax (`export function`), instead verify by checking the file was saved correctly — the function will be tested through the React app in Task 2.

- [ ] **Step 3: Commit**

```bash
git add agent-teams-guide/src/utils/planMarkdown.js
git commit -m "feat: add buildAgentPrompt() to planMarkdown.js"
```

---

## Task 2: Update `PromptPreview.jsx` — use `buildAgentPrompt()`, fix confirm signature

**Files:**
- Modify: `agent-teams-guide/src/components/mission/PromptPreview.jsx`

This file currently has a local `generateAgentPrompt(agent, tasks, projectPath)` function (lines 4–42). We replace it with `buildAgentPrompt` from planMarkdown.js, and fix `onConfirm` to pass `agentPrompts` as a separate dict instead of merging it into the agent objects.

- [ ] **Step 1: Replace the import and local function**

At the top of `PromptPreview.jsx`, add the import:

```js
import { buildAgentPrompt } from '../../utils/planMarkdown'
```

Then **delete** the entire `generateAgentPrompt` function (lines 4–42):
```js
// DELETE this entire function:
function generateAgentPrompt(agent, tasks, projectPath) {
  ...
}
```

- [ ] **Step 2: Update the `PromptPreview` component's initial state**

Find this block (around line 128–133):

```js
export function PromptPreview({ agents, tasks, projectPath, onConfirm, onBack }) {
  const [prompts, setPrompts] = useState(() =>
    Object.fromEntries(
      agents.map(a => [a.name, generateAgentPrompt(a, tasks, projectPath)])
    )
  )
```

Replace with:

```js
export function PromptPreview({ agents, tasks, projectPath, onConfirm, onBack }) {
  const [prompts, setPrompts] = useState(() =>
    Object.fromEntries(
      agents.map(a => [
        a.name,
        buildAgentPrompt(
          a,
          tasks.filter(t => (t.assigned_agent || t.agent) === a.name),
          { projectPath }
        )
      ])
    )
  )
```

- [ ] **Step 3: Update `handleConfirm` to pass `agentPrompts` separately**

Find (around line 138–145):

```js
  const handleConfirm = () => {
    // Pass the (possibly edited) prompts along with agents/tasks
    const agentsWithPrompts = agents.map(a => ({
      ...a,
      customPrompt: prompts[a.name] || '',
    }))
    onConfirm(agentsWithPrompts, tasks)
  }
```

Replace with:

```js
  const handleConfirm = () => {
    // Pass agentPrompts as a separate dict — agents are unchanged
    onConfirm(agents, tasks, prompts)
  }
```

- [ ] **Step 4: Verify the UI renders correctly**

Start the Electron app (`npm run dev` in `agent-teams-guide/`). Create a mission, wait for plan, click Deploy. The PromptPreview should appear with the new template format — each agent prompt should now show `## Tasks`, `## Execution Protocol`, `## Critical Rules` sections with full task details.

- [ ] **Step 5: Commit**

```bash
git add agent-teams-guide/src/components/mission/PromptPreview.jsx
git commit -m "feat: PromptPreview uses buildAgentPrompt(), passes agentPrompts separately"
```

---

## Task 3: Update `MissionControlPage.jsx` — fix `handlePromptConfirmed` signature

**Files:**
- Modify: `agent-teams-guide/src/pages/MissionControlPage.jsx`

- [ ] **Step 1: Update the handler**

Find (around line 51–54):

```js
  const handlePromptConfirmed = useCallback(async (agentsWithPrompts, tasks) => {
    setPromptPreview(null)
    deploy(agentsWithPrompts, tasks)
  }, [deploy])
```

Replace with:

```js
  const handlePromptConfirmed = useCallback(async (agents, tasks, agentPrompts) => {
    setPromptPreview(null)
    deploy(agents, tasks, agentPrompts)
  }, [deploy])
```

- [ ] **Step 2: Commit**

```bash
git add agent-teams-guide/src/pages/MissionControlPage.jsx
git commit -m "feat: MissionControlPage passes agentPrompts to deploy()"
```

---

## Task 4: Update `useMission.js` — forward `agentPrompts` to IPC

**Files:**
- Modify: `agent-teams-guide/src/hooks/useMission.js`

- [ ] **Step 1: Update `deploy` callback**

Find (around line 524):

```js
  const deploy = useCallback(async (agents, tasks) => {
    setPlanReady(null)
    try {
      await invoke('deploy_mission', {
        agents: agents.map(a => ({
          name: a.name,
          role: a.role,
          model: a.model || 'sonnet',
          customPrompt: a.customPrompt || '',
          skillFile: a.skillFile || null,
        })),
        tasks: tasks.map(t => ({
          title: t.title,
          detail: t.detail || '',
          assigned_agent: t.assigned_agent || t.agent,
          priority: t.priority || 'medium',
        })),
      })
```

Replace with:

```js
  const deploy = useCallback(async (agents, tasks, agentPrompts = {}) => {
    setPlanReady(null)
    try {
      await invoke('deploy_mission', {
        agents: agents.map(a => ({
          name: a.name,
          role: a.role,
          model: a.model || 'sonnet',
          customPrompt: a.customPrompt || '',
          skillFile: a.skillFile || null,
        })),
        tasks: tasks.map(t => ({
          title: t.title,
          detail: t.detail || '',
          assigned_agent: t.assigned_agent || t.agent,
          priority: t.priority || 'medium',
        })),
        agentPrompts,
      })
```

- [ ] **Step 2: Commit**

```bash
git add agent-teams-guide/src/hooks/useMission.js
git commit -m "feat: useMission.deploy() forwards agentPrompts to IPC"
```

---

## Task 5: Update `mission.cjs` — use verbatim prompts in agent blocks

**Files:**
- Modify: `agent-teams-guide/electron/ipc/mission.cjs` (the `deploy_mission` IPC handler, around line 1916)

- [ ] **Step 1: Extract `agentPrompts` from args**

Find (around line 1916–1917):

```js
  ipcMain.handle('deploy_mission', async (_event, args) => {
    const { agents = [], tasks = [] } = args || {};
```

Replace with:

```js
  ipcMain.handle('deploy_mission', async (_event, args) => {
    const { agents = [], tasks = [], agentPrompts = {} } = args || {};
```

- [ ] **Step 2: Update the agent block builder**

Find the `agentBlocks` map (around line 1939–1976):

```js
    // Build agent blocks
    const agentBlocks = agents.map(a => {
      const name      = a.name       || '';
      const role      = a.role       || '';
      const agentModel = a.model     || 'sonnet';
      const custom    = a.customPrompt || '';
      const skillName = a.skillFile && a.skillFile.name;
      const skillFileCount = a.skillFile && a.skillFile.fileCount;

      if (skillName) {
        // Log skill injection
        const desc = skillFileCount
          ? `Skill folder "${skillName}" loaded for agent "${name}" (${skillFileCount} files, ${custom.length} chars)`
          : `Skill file "${skillName}" loaded for agent "${name}" (${custom.length} chars)`;
        const skillEntry = makeLogEntry(now(), 'System', desc, 'info');
        missionState.log.push(skillEntry);
        sendToWindow('mission:log', skillEntry);
      }

      const agentTasks = tasks
        .filter(t => (t.assigned_agent || t.agent || '') === name)
        .map(t => ({ title: t.title || '', detail: t.detail || '' }));

      const tasksStr  = agentTasks.map((t, i) => {
        const line = `   ${i + 1}. ${t.title}`;
        return t.detail ? `${line}\n      Detail: ${t.detail}` : line;
      }).join('\n');

      // Separate skill content from custom instructions for clarity
      let skillSection = '';
      let customSection = '';
      if (skillName && custom) {
        skillSection = `\n- SKILL (MANDATORY — inject this VERBATIM into agent prompt):\n\`\`\`skill\n${custom}\n\`\`\``;
      } else if (custom) {
        customSection = `\n- Custom instructions: ${custom}`;
      }

      return `### Agent: "${name}"\n- Role: ${role}\n- Model: ${agentModel}\n- Tasks:\n${tasksStr}${customSection}${skillSection}`;
    });
```

Replace with:

```js
    // Build agent blocks
    const agentBlocks = agents.map(a => {
      const name       = a.name        || '';
      const role       = a.role        || '';
      const agentModel = a.model       || 'sonnet';
      const custom     = a.customPrompt || '';
      const skillName  = a.skillFile && a.skillFile.name;
      const skillFileCount = a.skillFile && a.skillFile.fileCount;

      // Log skill injection (unchanged)
      if (skillName) {
        const desc = skillFileCount
          ? `Skill folder "${skillName}" loaded for agent "${name}" (${skillFileCount} files, ${custom.length} chars)`
          : `Skill file "${skillName}" loaded for agent "${name}" (${custom.length} chars)`;
        const skillEntry = makeLogEntry(now(), 'System', desc, 'info');
        missionState.log.push(skillEntry);
        sendToWindow('mission:log', skillEntry);
      }

      // ── NEW: verbatim prompt path ──────────────────────────────
      const verbatimPrompt = agentPrompts[name];
      if (verbatimPrompt) {
        // Append viRule at end if Vietnamese project (global requirement)
        const finalPrompt = viRule
          ? verbatimPrompt + '\n' + viRule
          : verbatimPrompt;
        return `### Agent: "${name}"\n- Model: ${agentModel}\n- Prompt:\n\`\`\`prompt\n${finalPrompt}\n\`\`\``;
      }

      // ── FALLBACK: old task-list path (no PromptPreview used) ──
      const agentTasks = tasks
        .filter(t => (t.assigned_agent || t.agent || '') === name)
        .map(t => ({ title: t.title || '', detail: t.detail || '' }));

      const tasksStr = agentTasks.map((t, i) => {
        const line = `   ${i + 1}. ${t.title}`;
        return t.detail ? `${line}\n      Detail: ${t.detail}` : line;
      }).join('\n');

      let skillSection = '';
      let customSection = '';
      if (skillName && custom) {
        skillSection = `\n- SKILL (MANDATORY — inject this VERBATIM into agent prompt):\n\`\`\`skill\n${custom}\n\`\`\``;
      } else if (custom) {
        customSection = `\n- Custom instructions: ${custom}`;
      }

      return `### Agent: "${name}"\n- Role: ${role}\n- Model: ${agentModel}\n- Tasks:\n${tasksStr}${customSection}${skillSection}`;
    });
```

- [ ] **Step 3: Commit**

```bash
git add agent-teams-guide/electron/ipc/mission.cjs
git commit -m "feat: deploy_mission uses verbatim agentPrompts when provided"
```

---

## Task 6: Update `deploy_agent_teams.md` — verbatim prompt instruction

**Files:**
- Modify: `agent-teams-guide/electron/prompts/deploy_agent_teams.md`

The current Phase 2 "Spawn All Agents" section (lines 22–71) tells Lead to BUILD each sub-agent prompt from scratch using a format template. We replace this with: if an agent block has a ` ```prompt ``` ` section, use it verbatim.

- [ ] **Step 1: Replace the prompt-building instruction**

Find and replace this block (lines 22–33 approx):

```
- prompt: Build EACH agent's prompt using this EXACT structure:
  "You are '<name>', a specialized developer in team 'mission'.
  Working directory: {{PROJECT_PATH}}

  <IF the agent block has a SKILL section (inside ```skill``` fences):
   Copy-paste the ENTIRE content between the ```skill``` fences here.
   This is a mandatory operational skill — it defines HOW this agent works.
   Do NOT summarize, truncate, or omit any part of it. Paste it VERBATIM.>

  Tasks:
  <list ALL tasks for this agent>

  <IF the agent block has 'Custom instructions:', include that text here as well.>
```

Replace with:

```
- prompt:
  IF the agent block contains a ```prompt``` section:
    Use the EXACT content between the ```prompt``` fences — character-for-character.
    Do NOT add, remove, rephrase, or summarize anything. Paste it VERBATIM.
  OTHERWISE (no ```prompt``` section — legacy fallback):
    Build the prompt using this structure:
    "You are '<name>', a specialized developer in team 'mission'.
    Working directory: {{PROJECT_PATH}}

    <IF the agent block has a SKILL section (inside ```skill``` fences):
     Copy-paste the ENTIRE content between the ```skill``` fences here. VERBATIM.>

    Tasks:
    <list ALL tasks for this agent>

    <IF the agent block has 'Custom instructions:', include that text here as well.>
```

- [ ] **Step 2: Update the SKILL INJECTION warning** to account for the new verbatim path

Find (around line 73):

```
⚠ SKILL INJECTION (CRITICAL — agents will NOT follow their skill if you skip this):
- If an agent block contains a ```skill``` section, you MUST paste that ENTIRE content into the agent's prompt BEFORE the task list.
- The skill content is typically 500-5000 chars. Do NOT truncate it.
- To verify: after building each prompt, check that it contains the skill text. If it doesn't, you did it wrong.
```

Replace with:

```
⚠ PROMPT INJECTION (CRITICAL):
- If an agent block has a ```prompt``` section: use it verbatim — skill content is already included inside.
- If an agent block has a ```skill``` section (legacy): paste skill content verbatim into the prompt BEFORE the task list.
- Do NOT truncate any injected content.
```

- [ ] **Step 3: Commit**

```bash
git add agent-teams-guide/electron/prompts/deploy_agent_teams.md
git commit -m "feat: deploy_agent_teams uses verbatim prompt block when provided"
```

---

## Task 7: Update `deploy_standard.md` — same verbatim instruction

**Files:**
- Modify: `agent-teams-guide/electron/prompts/deploy_standard.md`

- [ ] **Step 1: Replace the prompt-building instruction**

Find (lines 20–31 approx):

```
- prompt: Build EACH agent's prompt using this EXACT structure:
  "You are a specialized developer. Working directory: {{PROJECT_PATH}}.

  <IF the agent block has a SKILL section (inside ```skill``` fences):
   Copy-paste the ENTIRE content between the ```skill``` fences here.
   This is a mandatory operational skill — it defines HOW this agent works.
   Do NOT summarize, truncate, or omit any part of it. Paste it VERBATIM.>

  Tasks:
  <list ALL tasks for this agent>

  <IF the agent block has 'Custom instructions:', include that text here as well.>
```

Replace with:

```
- prompt:
  IF the agent block contains a ```prompt``` section:
    Use the EXACT content between the ```prompt``` fences — character-for-character.
    Do NOT add, remove, rephrase, or summarize anything. Paste it VERBATIM.
  OTHERWISE (no ```prompt``` section — legacy fallback):
    Build the prompt using this structure:
    "You are a specialized developer. Working directory: {{PROJECT_PATH}}.

    <IF the agent block has a SKILL section (inside ```skill``` fences):
     Copy-paste the ENTIRE content between the ```skill``` fences here. VERBATIM.>

    Tasks:
    <list ALL tasks for this agent>

    <IF the agent block has 'Custom instructions:', include that text here as well.>
```

- [ ] **Step 2: Update the SKILL INJECTION warning**

Find (around line 70):

```
⚠ SKILL INJECTION (CRITICAL — agents will NOT follow their skill if you skip this):
- If an agent block contains a ```skill``` section, you MUST paste that ENTIRE content into the agent's prompt BEFORE the task list.
- The skill content is typically 500-5000 chars. Do NOT truncate it.
- To verify: after building each prompt, check that it contains the skill text. If it doesn't, you did it wrong.
```

Replace with:

```
⚠ PROMPT INJECTION (CRITICAL):
- If an agent block has a ```prompt``` section: use it verbatim — skill content is already included inside.
- If an agent block has a ```skill``` section (legacy): paste skill content verbatim into the prompt BEFORE the task list.
- Do NOT truncate any injected content.
```

- [ ] **Step 3: Commit**

```bash
git add agent-teams-guide/electron/prompts/deploy_standard.md
git commit -m "feat: deploy_standard uses verbatim prompt block when provided"
```

---

## Task 8: End-to-End Verification

**Files:** No code changes — manual test only.

- [ ] **Step 1: Run the app**

```bash
cd agent-teams-guide
npm run dev
```

- [ ] **Step 2: Create a test mission**

Set project path to any Node.js project (e.g. the `agent-teams-guide` folder itself). Enter requirement: "Add a hello.txt file with content 'hello world'". Launch.

- [ ] **Step 3: Verify PromptPreview shows new template**

After Lead outputs the plan and you click Deploy, the PromptPreview screen should show each agent's prompt with:
- `You are '<name>', a <role> in team 'mission'.`
- `Working directory: <path>`
- `## Tasks` section with task titles AND full detail text
- `## Execution Protocol` with A–E steps
- `## Critical Rules`

- [ ] **Step 4: Edit one prompt and deploy**

In PromptPreview, expand an agent, click Edit, change one word, save. Click Deploy Mission.

- [ ] **Step 5: Verify agent block in raw output**

In the mission dashboard Raw Output tab, look for the deploy prompt that Lead receives. You should see the agent block format:
```
### Agent: "agent-name"
- Model: sonnet
- Prompt:
```prompt
You are 'agent-name'...
## Tasks
...
```
```

And Lead should spawn the sub-agent with that exact content, not a reconstructed prompt.

- [ ] **Step 6: Final commit (if any fixes were needed)**

```bash
git add -p
git commit -m "fix: transparent agent prompts — post-test fixes"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Implemented in |
|---|---|
| `buildAgentPrompt()` pure function in `planMarkdown.js` | Task 1 |
| Template: Identity, Skill, Tasks (with detail), Execution Protocol, Critical Rules | Task 1 |
| PromptPreview uses `buildAgentPrompt()` | Task 2 |
| `onConfirm` passes `agentPrompts` separately | Task 2 |
| `MissionControlPage` updated signature | Task 3 |
| `useMission.deploy()` forwards `agentPrompts` | Task 4 |
| `mission.cjs` uses verbatim prompt when `agentPrompts[name]` present | Task 5 |
| viRule appended to verbatim prompt (not lost) | Task 5 |
| Fallback to old task-list behavior when no `agentPrompts` | Task 5 |
| `deploy_agent_teams.md` verbatim instruction | Task 6 |
| `deploy_standard.md` verbatim instruction | Task 7 |
| Agent has no tasks → shows "(No tasks assigned)" | Task 1 (`buildAgentPrompt`) |
| Agent has skill file → skill injected verbatim above Tasks | Task 1 (`buildAgentPrompt`) |

**Type consistency check:**
- `buildAgentPrompt(agent, agentTasks, meta)` — `agentTasks` used in Task 1 and Task 2 (`tasks.filter(...)`)
- `agentPrompts` — `{ [agentName: string]: string }` used consistently in Tasks 2, 3, 4, 5
- `onConfirm(agents, tasks, agentPrompts)` — 3-arg signature consistent between Task 2 (caller) and Task 3 (receiver)
- `deploy(agents, tasks, agentPrompts)` — consistent between Task 3 (caller) and Task 4 (receiver)
- `invoke('deploy_mission', { agents, tasks, agentPrompts })` — consistent between Task 4 (caller) and Task 5 (handler)

**Placeholder scan:** No TBDs or TODOs in plan steps. All code blocks are complete.
