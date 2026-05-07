# Deep Plan Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Deep Plan" as a 4th Permission Mode that injects the superpowers brainstorming skill into the planning prompt, so Lead asks clarifying questions before generating the mission plan.

**Architecture:** When the user selects "Deep Plan" and launches, `promptWrapper.js` reads the brainstorming skill content via a new IPC handler, prepends a Phase 0 wrapper around the skill content to the planning prompt, and enables the interactive Q&A protocol. Lead asks questions one-at-a-time via the existing `<<<QUESTION>>>` / `--resume` mechanism; the rest of the flow (PlanReview → PromptPreview → Deploy) is unchanged.

**Tech Stack:** Electron (Node.js CJS), React + Vite, Tauri IPC invoke pattern (`@tauri-apps/api/core`), `lucide-react` icons, existing `<<<QUESTION>>>` protocol in `mission.cjs`.

**Spec:** `docs/superpowers/specs/2026-04-14-deep-plan-mode-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `electron/ipc/mission.cjs` | Modify | Add `read_superpowers_skill` IPC handler after `read_planning_template` |
| `src/data/promptWrapper.js` | Modify | Handle `permissionMode === 'deep_plan'` — read skill, build Phase 0 prompt |
| `src/components/mission/MissionLauncher.jsx` | Modify | Add Deep Plan as 4th permission mode with Brain icon + info note |

---

## Task 1: IPC handler — `read_superpowers_skill`

**Files:**
- Modify: `electron/ipc/mission.cjs` at line ~2522 (after `read_planning_template` handler)

This handler discovers the latest installed superpowers version and reads a named skill's `SKILL.md`.

- [ ] **Step 1: Add the handler after `read_planning_template`**

In `electron/ipc/mission.cjs`, find this block (around line 2517):

```js
  // ── read_planning_template ─────────────────────────────────────
  // Load planning.md from disk at RUNTIME so users can edit it
  ipcMain.handle('read_planning_template', async () => {
    const templatePath = promptPath('planning.md');
    return fs.readFileSync(templatePath, 'utf8');
  });
```

Insert the new handler immediately after the closing `});` of `read_planning_template`:

```js
  // ── read_superpowers_skill ─────────────────────────────────────
  // Reads a superpowers skill SKILL.md from the user's Claude plugins cache.
  // Discovers the latest installed version automatically via semver sort.
  // Returns the file content as a string, or null if not found.
  ipcMain.handle('read_superpowers_skill', async (_event, args) => {
    const { skillName } = args || {};
    if (!skillName) return null;

    const superpowersBase = path.join(
      os.homedir(),
      '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers'
    );

    // Find all semver-formatted subdirectories (e.g. "5.0.7")
    let versions = [];
    try {
      versions = fs.readdirSync(superpowersBase)
        .filter(d => /^\d+\.\d+\.\d+$/.test(d))
        .sort((a, b) => {
          const [aMaj, aMin, aPatch] = a.split('.').map(Number);
          const [bMaj, bMin, bPatch] = b.split('.').map(Number);
          return bMaj - aMaj || bMin - aMin || bPatch - aPatch;
        });
    } catch {
      // superpowers not installed — directory doesn't exist
      return null;
    }

    if (versions.length === 0) return null;

    const skillPath = path.join(superpowersBase, versions[0], 'skills', skillName, 'SKILL.md');
    try {
      return fs.readFileSync(skillPath, 'utf8');
    } catch {
      return null;
    }
  });
```

- [ ] **Step 2: Verify the handler is registered correctly**

Open a terminal in `agent-teams-guide/` and run the Electron app:

```bash
npm run electron:dev
```

Open DevTools (Ctrl+Shift+I) → Console tab. In the console, test the IPC call by pasting:

```js
window.__electronIPC?.invoke?.('read_superpowers_skill', { skillName: 'brainstorming' })
  .then(r => console.log('[TEST] skill content length:', r ? r.length : 'null'))
  .catch(e => console.error('[TEST] error:', e))
```

Expected output: `[TEST] skill content length: <number>` (e.g. 5800). If you see `null`, superpowers isn't installed at the expected path — check `~/.claude/plugins/cache/claude-plugins-official/superpowers/`.

> Note: If DevTools console IPC invocation isn't available directly, you can add a temporary `console.log` at the top of the handler: `console.log('[read_superpowers_skill] called, skillName:', skillName)` and watch the main process output in the terminal.

- [ ] **Step 3: Commit**

```bash
git add electron/ipc/mission.cjs
git commit -m "feat: add read_superpowers_skill IPC handler with semver version discovery"
```

---

## Task 2: `promptWrapper.js` — Deep Plan prompt building

**Files:**
- Modify: `src/data/promptWrapper.js`

When `permissionMode === 'deep_plan'`, the prompt is: `[Phase0Wrapper + skillContent] + [planning.md content]` with a custom permission section that encourages questions rather than discouraging them.

- [ ] **Step 1: Update the `buildMissionPrompt` function signature and extract `deep_plan`**

In `src/data/promptWrapper.js`, find the start of `buildMissionPrompt` (line 54):

```js
export async function buildMissionPrompt(requirement, options = {}) {
  const { projectPath, teamHint, references = [], permissionMode = 'auto' } = options
```

No change needed here — `deep_plan` is already a valid value for `permissionMode`.

- [ ] **Step 2: Add the Phase 0 wrapper builder function**

Add this pure function **before** `buildMissionPrompt` (after `detectLanguageHint`):

```js
/**
 * Build the Phase 0 wrapper that prepends brainstorming skill to planning prompt.
 * @param {string} skillContent - Raw content of brainstorming/SKILL.md
 * @returns {string} Phase 0 section to prepend to the planning template
 */
function buildPhase0Wrapper(skillContent) {
  return `## PHASE 0: DEEP PLANNING — Execute NOW Before Planning

You have been given the Brainstorming skill below. Execute it NOW before proceeding to Phase 1.

### ADAPTATION RULES (these override any conflicting instructions inside the skill):
1. "Write design doc" → output a \`## MISSION UNDERSTANDING\` section instead (brief summary)
2. "Invoke writing-plans skill" → proceed directly to Phase 1 (output MISSION PLAN JSON below)
3. "AskUserQuestion tool" → use the <<<QUESTION>>> protocol defined at the end of this prompt
4. "Visual Companion" → skip entirely (not available in this context)
5. "EnterPlanMode" / "ExitPlanMode" → skip
6. Limit questions to 3–5 maximum — focus only on decisions critical to correct planning

=== BRAINSTORMING SKILL (execute this) ===
${skillContent}
=== END BRAINSTORMING SKILL ===

After completing the brainstorming process above:
- Output a \`## MISSION UNDERSTANDING\` section (1–3 paragraphs summarising key decisions)
- Then proceed to Phase 1 below to output the MISSION PLAN JSON

---

`
}
```

- [ ] **Step 3: Add the `deep_plan` permissionSection and Phase 0 injection**

In `buildMissionPrompt`, find the permission section building block (around line 114):

```js
  // Build permission mode section for planning phase
  let permissionSection = ''
  if (permissionMode === 'interactive') {
```

Add the `deep_plan` branch **before** the `interactive` branch:

```js
  // Build permission mode section for planning phase
  let permissionSection = ''
  let phase0Section = ''

  if (permissionMode === 'deep_plan') {
    // Read brainstorming skill from superpowers installation
    let skillContent = null
    try {
      skillContent = await invoke('read_superpowers_skill', { skillName: 'brainstorming' })
    } catch {
      // IPC not available (Tauri mode or handler missing) — fall back gracefully
    }

    if (skillContent) {
      phase0Section = buildPhase0Wrapper(skillContent)
      // Custom permissionSection: actively encourages questions (brainstorming mode)
      permissionSection = `The brainstorming skill above requires you to ask clarifying questions before planning.
Use the <<<QUESTION>>> protocol:

1. Output ONE <<<QUESTION>>> block (one question only per turn):
<<<QUESTION>>>
{"from":"Lead","type":"clarification","question":"your question here","options":["Option A","Option B"],"context":"why you need this answered"}
<<<END_QUESTION>>>

2. Immediately after, output:
<<<QUESTIONS_END>>>

3. Then STOP. The user will answer and you will be resumed with their answer.
   Ask your next question in the next turn, or proceed to Phase 1 if you have enough information.

When you have gathered enough context (maximum 5 questions), output:
- \`## MISSION UNDERSTANDING\` section summarising key decisions
- Then the MISSION PLAN JSON (Phase 1)`
    } else {
      // Skill not found — fall back to standard interactive section
      console.warn('[deep_plan] superpowers brainstorming skill not found — falling back to interactive mode')
      permissionSection = `Use the <<<QUESTION>>> protocol below. The app will show your questions to the user and resume the session with their answers.

1. Output this EXACT format (one block per question):
<<<QUESTION>>>
{"from":"Lead","type":"clarification","question":"Your specific question here","options":["Option A","Option B"],"context":"Why you need this answered"}
<<<END_QUESTION>>>

2. You may output multiple <<<QUESTION>>> blocks if you have several questions.

3. After ALL questions, output the terminal marker:
<<<QUESTIONS_END>>>

4. Then STOP. End your turn immediately after <<<QUESTIONS_END>>>.
   The user will answer your questions and a new turn will begin with their answers.
   After receiving answers, continue with Phase 1 analysis and output the plan.

RULES:
- Only ask when you truly lack critical information that would lead to wrong decisions.
- Prefer making informed decisions autonomously when possible.
- ALWAYS end your question batch with <<<QUESTIONS_END>>> marker.`
    }
  } else if (permissionMode === 'interactive') {
```

- [ ] **Step 4: Inject `phase0Section` into the returned prompt**

Find the return statement at the bottom of `buildMissionPrompt` (around line 141):

```js
  // Apply template replacements
  return planningTemplate
    .replace('{{REQUIREMENT}}', requirement)
    .replace('{{PROJECT_PATH}}', projectPath || '(current directory)')
    .replace('{{LANG_HINT}}', langSection)
    .replace('{{REFERENCES_SECTION}}', referencesSection)
    .replace('{{TEAM_HINT}}', teamHint || 'Use 3-4 teammates for this task')
    .replace('{{PERMISSION_MODE}}', permissionSection)
```

Replace this with:

```js
  // Apply template replacements
  const filledTemplate = planningTemplate
    .replace('{{REQUIREMENT}}', requirement)
    .replace('{{PROJECT_PATH}}', projectPath || '(current directory)')
    .replace('{{LANG_HINT}}', langSection)
    .replace('{{REFERENCES_SECTION}}', referencesSection)
    .replace('{{TEAM_HINT}}', teamHint || 'Use 3-4 teammates for this task')
    .replace('{{PERMISSION_MODE}}', permissionSection)

  // Prepend Phase 0 (Deep Plan mode only) — empty string otherwise
  return phase0Section + filledTemplate
```

- [ ] **Step 5: Verify prompt preview in the app**

Run `npm run electron:dev`, open MissionLauncher, set Permission Mode to "Deep Plan" (we'll add it in Task 3 — for now you can temporarily hardcode `permissionMode: 'deep_plan'` in the `handleLaunch` call to test). Type any requirement and expand "Xem System Prompt". Verify:
- The prompt starts with `## PHASE 0: DEEP PLANNING`
- The brainstorming skill content appears between the `=== BRAINSTORMING SKILL ===` fences
- The permission section at the end contains the `<<<QUESTION>>>` protocol with "The brainstorming skill above requires..." text

If `phase0Section` is empty (skill not found), the prompt should look identical to interactive mode.

- [ ] **Step 6: Commit**

```bash
git add src/data/promptWrapper.js
git commit -m "feat: promptWrapper handles deep_plan mode — injects brainstorming skill as Phase 0"
```

---

## Task 3: MissionLauncher — "Deep Plan" UI

**Files:**
- Modify: `src/components/mission/MissionLauncher.jsx`

Add "Deep Plan" as the 4th permission mode with a Brain icon and descriptive info note.

- [ ] **Step 1: Import Brain icon**

In `MissionLauncher.jsx`, find the existing lucide-react import (line 3):

```js
import { Rocket, FolderOpen, Zap, History, Trash2, Cpu, Eye, EyeOff, Users, FlaskConical, Paperclip, FileText, Image, Folder, Upload, X, AtSign, Shield, ShieldCheck, ShieldQuestion } from 'lucide-react'
```

Add `Brain` to the import list:

```js
import { Rocket, FolderOpen, Zap, History, Trash2, Cpu, Eye, EyeOff, Users, FlaskConical, Paperclip, FileText, Image, Folder, Upload, X, AtSign, Shield, ShieldCheck, ShieldQuestion, Brain } from 'lucide-react'
```

- [ ] **Step 2: Add Deep Plan to `PERMISSION_MODES`**

Find the `PERMISSION_MODES` array (around line 30):

```js
const PERMISSION_MODES = [
  {
    id: 'auto',
    label: 'Auto-pilot',
    desc: 'Agents tự quyết mọi thứ, chạy liên tục',
    icon: Shield,
  },
  {
    id: 'interactive',
    label: 'Interactive',
    desc: 'Lead có thể hỏi bạn khi cần input',
    icon: ShieldQuestion,
  },
  {
    id: 'plan-only',
    label: 'Plan Only',
    desc: 'Chỉ lên plan, dừng ở PlanReview',
    icon: ShieldCheck,
  },
]
```

Add the 4th entry:

```js
const PERMISSION_MODES = [
  {
    id: 'auto',
    label: 'Auto-pilot',
    desc: 'Agents tự quyết mọi thứ, chạy liên tục',
    icon: Shield,
  },
  {
    id: 'interactive',
    label: 'Interactive',
    desc: 'Lead có thể hỏi bạn khi cần input',
    icon: ShieldQuestion,
  },
  {
    id: 'plan-only',
    label: 'Plan Only',
    desc: 'Chỉ lên plan, dừng ở PlanReview',
    icon: ShieldCheck,
  },
  {
    id: 'deep_plan',
    label: 'Deep Plan',
    desc: 'Lead hỏi clarifying questions trước khi lên plan',
    icon: Brain,
  },
]
```

- [ ] **Step 3: Update the permission mode grid from `grid-cols-3` to `grid-cols-2 grid-rows-2`**

The existing grid is `grid-cols-3` (3 modes fit in one row). With 4 modes, change to a 2×2 grid.

Find:

```js
          <div className="grid grid-cols-3 gap-2">
            {PERMISSION_MODES.map(mode => {
```

Replace with:

```js
          <div className="grid grid-cols-2 gap-2">
            {PERMISSION_MODES.map(mode => {
```

- [ ] **Step 4: Add the Deep Plan info note (similar to interactive's amber note)**

Find the existing Interactive info note (around line 628):

```js
          {permissionMode === 'interactive' && (
            <p className="text-[10px] text-amber-400/80 font-mono bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1.5 leading-relaxed">
              ⏸ Lead agent có thể pause mission và hỏi bạn khi thiếu thông tin.
              Bạn trả lời qua UI, mission tiếp tục tự động.
            </p>
          )}
```

Add a Deep Plan note immediately after:

```js
          {permissionMode === 'deep_plan' && (
            <p className="text-[10px] text-purple-400/80 font-mono bg-purple-500/5 border border-purple-500/20 rounded px-2 py-1.5 leading-relaxed">
              🧠 Lead sẽ hỏi 3–5 câu clarifying questions trước khi lên plan. Mỗi câu hỏi hiện trong QuestionCard — bạn trả lời, Lead hỏi tiếp hoặc lên plan ngay. Tốn thêm ~1–2 phút nhưng plan và sub-agent prompts sẽ chính xác hơn.
            </p>
          )}
```

- [ ] **Step 5: Verify in the app**

Run `npm run electron:dev`. In MissionLauncher:
- Confirm you see 4 permission mode cards in a 2×2 grid
- Click "Deep Plan" — the card highlights, and the purple info note appears below
- Expand "Xem System Prompt" with any requirement typed — the prompt should start with `## PHASE 0: DEEP PLANNING`
- Switch to "Auto-pilot" — prompt returns to normal (no Phase 0)

- [ ] **Step 6: Commit**

```bash
git add src/components/mission/MissionLauncher.jsx
git commit -m "feat: add Deep Plan as 4th permission mode in MissionLauncher"
```

---

## Task 4: End-to-end smoke test

**No new files** — manual verification of the full flow.

- [ ] **Step 1: Launch a Deep Plan mission**

In the running app:
1. Set project path to any existing project directory
2. Type a requirement (e.g. "Add a dark mode toggle to the settings page")
3. Select model: Sonnet, Execution: Standard, Permission: **Deep Plan**
4. Click Launch

- [ ] **Step 2: Verify Lead asks a question**

Expected: Within 30–60 seconds, a QuestionCard appears in the MissionDashboard with a question from Lead. The Activity Log should show `Planning paused — Lead is waiting for your answers`.

- [ ] **Step 3: Answer and verify continuation**

Answer the question in the QuestionCard UI. Expected: Mission resumes, Lead either asks another question or (after ≤5 questions) outputs `## MISSION UNDERSTANDING` text in the activity log followed by the plan JSON. PlanReview screen appears normally.

- [ ] **Step 4: Verify fallback (optional — only if you want to test graceful degradation)**

Temporarily rename the superpowers directory to break discovery:
```bash
mv ~/.claude/plugins/cache/claude-plugins-official/superpowers ~/.claude/plugins/cache/claude-plugins-official/superpowers_backup
```
Launch a Deep Plan mission. Expected: No `## PHASE 0` in activity log, but Lead still asks questions (interactive fallback active). No crash.

Restore:
```bash
mv ~/.claude/plugins/cache/claude-plugins-official/superpowers_backup ~/.claude/plugins/cache/claude-plugins-official/superpowers
```

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: Deep Plan permission mode — complete implementation"
```
