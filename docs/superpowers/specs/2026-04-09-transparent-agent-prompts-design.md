# Design: Transparent Sub-Agent Prompts

**Date:** 2026-04-09  
**Status:** Approved  
**Scope:** `agent-teams-guide` — Plan Review UI + Deploy backend

---

## Problem

Currently the sub-agent prompts are a blackbox: `deploy_agent_teams.md` instructs the Lead LLM to *build* each sub-agent's prompt dynamically. The user cannot see or edit what each sub-agent will receive before execution. This creates unpredictable behavior and breaks transparency.

---

## Solution

Move sub-agent prompt construction **out of the Lead LLM** and into the **app** (deterministic, template-based). Pre-build each agent's full prompt before deploy, display them in a new **"Prompts" tab** inside `PlanDocument`, and pass them verbatim to Lead for spawning.

---

## Sub-Agent Prompt Template

Each agent receives a prompt with this structure:

```
You are '{name}', a {role} in team 'mission'.
Working directory: {projectPath}

{skillContent — if agent has a skill file, inject verbatim here}

## Tasks

### 1. [{PRIORITY}] {task.title}
{task.detail}

### 2. [{PRIORITY}] {task.title}
{task.detail}

## Execution Protocol

A) SETUP      — cd into {projectPath}. Read existing files before writing anything.
B) IMPLEMENT  — Write ALL files completely. No stubs, no TODOs, no placeholder functions.
C) BUILD      — Run: {buildCommand}
                Read ENTIRE output. Fix errors, retry until 0 errors.
D) EVIDENCE   — Print these exact lines when done:
                [{name}] BUILD_RESULT: PASS  (or FAIL: <summary>)
                [{name}] FILES_WRITTEN: <comma-separated list>
                [{name}] Completed: <task>  (one line per task)
E) COMMUNICATE — Use SendMessage to ask Lead BEFORE guessing on anything unclear.
                 Report completion to Lead via SendMessage when all tasks done.

{customInstructions — if agent has custom prompt, append here}

## Critical Rules
- Do NOT report done if build fails. Fix it first.
- Do NOT write empty files or stub functions.
- If unsure about ANYTHING, ask Lead via SendMessage first.
{viRule — if project is Vietnamese, add Vietnamese language rule here}
```

**Design rationale:**
- `## Tasks` — directly from plan data, no interpretation by LLM
- `## Execution Protocol` — standardized; user can overwrite entirely if needed (e.g., doc-only agents can remove BUILD step)
- `## Critical Rules` — safety invariants at the bottom; visible, not hidden
- Skill content injected verbatim above Tasks (same as current behavior but now user can see it)

---

## Architecture Changes

### 1. New utility: `buildAgentPrompt(agent, tasks, meta)` in `planMarkdown.js`

Pure function. Takes agent object + their tasks + project metadata → returns full prompt string.

```js
export function buildAgentPrompt(agent, tasks, meta) {
  // agent: { name, role, model, customPrompt, skillFile }
  // tasks: [{ title, detail, priority }] — only tasks for this agent
  // meta: { projectPath, buildCommand, viRule }
  // returns: string (the full prompt)
}
```

### 2. New tab "Prompts" in `PlanDocument.jsx`

**Tab bar:** `[Plan] [Prompts]`

**Prompts tab layout:**
- Left sidebar: list of agent names (same style as current outline sidebar)
- Right: textarea with the selected agent's full prompt (editable)

**State per agent:**
- `prompt: string` — current prompt content
- `isDirty: boolean` — true if user has manually edited this prompt

**Sync behavior:**
- On mount (switching to Prompts tab for first time): generate all prompts from plan data
- When plan data changes (agents/tasks updated via Apply in Plan tab):
  - For agents where `isDirty === false`: auto-regenerate prompt silently
  - For agents where `isDirty === true`: show inline warning banner:
    ```
    ⚠ Plan changed — [Regenerate ↺]  [Keep my edits]
    ```
- When user edits textarea: set `isDirty = true` for that agent

**Toolbar actions:**
- `Regenerate All ↺` — regenerate all prompts from current plan (confirm if any are dirty)
- `Reset Agent ↺` — regenerate current agent's prompt (clears dirty flag)
- `Copy` — copy current agent's prompt to clipboard

### 3. `deploy_mission` handler in `mission.cjs`

Accept pre-built prompts from frontend:

```js
// Current
ipcMain.handle('deploy_mission', async (_event, { agents, tasks }) => { ... })

// New
ipcMain.handle('deploy_mission', async (_event, { agents, tasks, agentPrompts }) => {
  // agentPrompts: { [agentName]: string } — pre-built, verbatim
  ...
})
```

When building `AGENT_BLOCKS` for `deploy_agent_teams.md`, inject the pre-built prompt instead of task list:

```js
// Current agent block:
`### Agent: "${name}"\n- Role: ${role}\n- Model: ${model}\n- Tasks:\n${tasksStr}`

// New agent block (with pre-built prompt):
`### Agent: "${name}"\n- Model: ${model}\n- Prompt:\n\`\`\`\n${agentPrompts[name]}\n\`\`\``
```

### 4. Update `deploy_agent_teams.md`

Change instruction from "build prompts using this format" → "spawn each agent using EXACTLY the prompt provided, do not modify or summarize it":

```
For EACH agent listed above, call the Agent tool with:
- name: the agent's exact name
- model: the model specified for that agent  
- prompt: use the EXACT content inside the ```prompt``` block — verbatim, no changes
```

### 5. State ownership for `agentPrompts`

`agentPrompts` state (`{ [agentName]: string }`) lives in **`MissionControlPage`** (the parent that owns the Deploy button). `PlanDocument` receives an `onPromptsChange(agentPrompts)` prop and calls it whenever any prompt changes. This mirrors how `onApply` already works for plan data.

If user deploys without ever visiting the Prompts tab, `MissionControlPage` generates prompts at deploy-click time via `buildAgentPrompt()` as a fallback.

### 6. `useMission.js` — pass agentPrompts in deploy call

```js
const deploy = useCallback(async (agents, tasks, agentPrompts) => {
  await invoke('deploy_mission', {
    agents: agents.map(...),
    tasks: tasks.map(...),
    agentPrompts,  // { agentName: promptString }
  })
  ...
}, [])
```

---

## Data Flow (after this change)

```
Lead LLM (planning.md)
    │ outputs JSON plan
    ▼
App parses JSON → planToMarkdown()
    │
    ▼
[User edits Plan tab in PlanDocument]
    │ click Apply
    ▼
parseMissionPlan(markdown) → {agents[], tasks[]}
    │
    ▼
[User switches to Prompts tab]
    │ buildAgentPrompt() called for each agent
    ▼
[User reads/edits per-agent prompts]
    │ click Deploy
    ▼
deploy_mission({ agents, tasks, agentPrompts })
    │
    ▼
deploy_agent_teams.md with verbatim prompt blocks
    │
    ▼
Lead LLM reads prompt blocks → spawns sub-agents verbatim
    │
    ▼
Sub-agents receive EXACTLY what user saw and approved
```

---

## Files Changed

| File | Change |
|---|---|
| `src/utils/planMarkdown.js` | Add `buildAgentPrompt()` function |
| `src/components/mission/PlanDocument.jsx` | Add Prompts tab; add `onPromptsChange(agentPrompts)` prop callback |
| `electron/ipc/mission.cjs` | Accept `agentPrompts` in `deploy_mission`, inject verbatim |
| `electron/prompts/deploy_agent_teams.md` | Update spawning instructions to use verbatim prompt blocks |
| `electron/prompts/deploy_standard.md` | Same update as deploy_agent_teams.md |
| `src/hooks/useMission.js` | Pass `agentPrompts` in `deploy()` call |
| `src/pages/MissionControlPage.jsx` | Store `agentPrompts` state; pass `onPromptsChange` to PlanDocument; pass `agentPrompts` to `deploy()` |

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Agent has no tasks | Prompt shows empty Tasks section with note "(No tasks assigned)" |
| Agent has skill file | Skill content injected verbatim above Tasks (same as today) |
| User deploys without visiting Prompts tab | Prompts auto-generated from plan data at deploy time (no regression) |
| Standard mode (not agent_teams) | Same change applies — `deploy_standard.md` updated too |
| Plan changes after prompts edited | Per-agent dirty flag → warning banner on dirty agents |

---

## Out of Scope

- Prompt versioning / history
- Diff view between original and edited prompt  
- Saving custom prompts as reusable templates
