# Design: "Deep Plan" Permission Mode

**Date:** 2026-04-14  
**Status:** Approved  
**Feature name:** Khổ trước sướng sau / Deep Plan mode

---

## Problem

When a user submits a mission requirement, Lead immediately analyzes the codebase and generates a plan. This works well for clear, well-scoped requirements. For ambiguous or complex requirements, Lead makes assumptions that may produce a plan misaligned with what the user actually needs — wasting tokens and requiring replanning.

## Solution

Add a **"Deep Plan"** Permission Mode (the 4th, alongside Auto-pilot, Interactive, Plan Only). When selected, Lead executes the Brainstorming skill before generating the mission plan. Lead asks 3-5 targeted clarifying questions, gathers answers, then outputs a MISSION UNDERSTANDING summary followed by the plan JSON.

This is "khổ trước sướng sau" — invest effort upfront in clarification to get a better plan and better sub-agent prompts downstream.

---

## Architecture

### Data Flow

```
User selects "Deep Plan" → clicks Launch
  → promptWrapper.js calls IPC: read_superpowers_skill('brainstorming')
     → Electron main process searches ~/.claude/plugins/cache/claude-plugins-official/superpowers/
     → Semver-sorts subdirectories, picks the latest version
     → Reads <latest>/skills/brainstorming/SKILL.md
     → Returns file content string, or null if not found

  → If null (superpowers not installed):
       Fall back to Interactive mode, log warning to console
  → If found:
       Build prompt = [Phase 0 wrapper + SKILL.md verbatim] + [planning.md content]
       Use interactive permission section (<<<QUESTION>>> protocol enabled)

Lead receives prompt:
  Phase 0: Execute brainstorming skill
    → Asks questions one at a time via <<<QUESTION>>> protocol
    → QuestionCard UI presents each question to user
    → User answers → new turn → Lead asks next question or proceeds
    → After Q&A complete: outputs "## MISSION UNDERSTANDING" summary

  Phase 1–3 (unchanged): Outputs MISSION PLAN JSON
  
PlanReview → PromptPreview → Deploy (unchanged)
```

### Phase 0 Prompt Wrapper

The following is prepended to the planning.md content when Deep Plan mode is active:

```markdown
## PHASE 0: DEEP PLANNING — Execute NOW Before Planning

You have been given the Brainstorming skill below. Execute it NOW.

### ADAPTATION RULES (override conflicting skill instructions):
1. "Write design doc" → output a `## MISSION UNDERSTANDING` section instead
2. "Invoke writing-plans skill" → proceed directly to Phase 1 (plan JSON output)
3. "AskUserQuestion tool" → use the <<<QUESTION>>> protocol (see end of prompt)
4. "Visual Companion" → skip entirely (not available)
5. "EnterPlanMode" / "ExitPlanMode" → skip
6. Limit questions to 3-5 maximum — focus only on decisions critical to correct planning

=== BRAINSTORMING SKILL ===
{{BRAINSTORMING_SKILL_CONTENT}}
=== END BRAINSTORMING SKILL ===

After completing the brainstorming process above:
- Output `## MISSION UNDERSTANDING` section (brief summary of key decisions)
- Then proceed to Phase 1 below

---
```

---

## Files to Change

### 1. `electron/ipc/mission.cjs` — New IPC handler

Add `read_superpowers_skill` handler:

```js
'read_superpowers_skill': async ({ skillName }) => {
  const os = require('os')
  const fs = require('fs')
  const path = require('path')
  
  const superpowersBase = path.join(
    os.homedir(),
    '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers'
  )
  
  // Find latest version (semver sort)
  let versions = []
  try {
    versions = fs.readdirSync(superpowersBase)
      .filter(d => /^\d+\.\d+\.\d+$/.test(d))
      .sort((a, b) => {
        const [aMaj, aMin, aPatch] = a.split('.').map(Number)
        const [bMaj, bMin, bPatch] = b.split('.').map(Number)
        return bMaj - aMaj || bMin - aMin || bPatch - aPatch
      })
  } catch {
    return null
  }
  
  if (versions.length === 0) return null
  
  const skillPath = path.join(superpowersBase, versions[0], 'skills', skillName, 'SKILL.md')
  try {
    return fs.readFileSync(skillPath, 'utf8')
  } catch {
    return null
  }
}
```

### 2. `src/data/promptWrapper.js` — Handle `deep_plan` mode

In `buildMissionPrompt()`:
- When `permissionMode === 'deep_plan'`: call `invoke('read_superpowers_skill', { skillName: 'brainstorming' })`
- If content returned: prepend Phase 0 wrapper with skill content injected
- Use interactive `permissionSection` (questions enabled)
- If null returned: use interactive mode without Phase 0, console.warn

The `permissionSection` for `deep_plan` uses the <<<QUESTION>>> protocol mechanics but with different guidance — it actively encourages questions (unlike interactive which discourages them):

```
The brainstorming skill above requires you to ask clarifying questions before planning.
Use the <<<QUESTION>>> protocol:

1. Output ONE <<<QUESTION>>> block (one question only per turn):
<<<QUESTION>>>
{"from":"Lead","type":"clarification","question":"...","options":[...],"context":"..."}
<<<END_QUESTION>>>

2. After the question block, output:
<<<QUESTIONS_END>>>

3. Then STOP. The user will answer and you will be resumed with their answer.
   Ask your next question in the next turn if needed.

When you have gathered enough information (max 5 questions), proceed:
- Output ## MISSION UNDERSTANDING (summary of key decisions from the Q&A)
- Then proceed to Phase 1 (output MISSION PLAN JSON)
```

### 3. `src/components/mission/MissionLauncher.jsx` — New permission mode

Add to `PERMISSION_MODES` array:
```js
{
  id: 'deep_plan',
  label: 'Deep Plan',
  desc: 'Lead hỏi clarifying questions trước khi lên plan — plan chất lượng cao hơn',
  icon: Brain,  // import from lucide-react
}
```

Display note when selected:
```
🧠 Lead sẽ hỏi 3–5 câu clarifying questions trước khi lên plan. Mỗi câu hỏi hiện trong QuestionCard — bạn trả lời, Lead tiếp tục. Tốn thêm ~1–2 phút nhưng plan và sub-agent prompts sẽ chính xác hơn nhiều.
```

---

## Graceful Degradation

If `read_superpowers_skill` returns `null` (superpowers not installed or path not found):
- Deep Plan mode silently falls back to Interactive mode
- `console.warn('[deep_plan] superpowers brainstorming skill not found, falling back to interactive mode')`
- No user-visible error — Q&A still available, just without the structured brainstorming behavior

---

## Non-Goals

- No new UI screens or steps
- No changes to PlanReview, PromptPreview, or Deploy flow
- No new planning template files (Phase 0 is dynamically prepended in `promptWrapper.js`)
- No auto-detection of when Deep Plan is needed — user opts in explicitly

---

## Success Criteria

- Selecting "Deep Plan" and launching shows ≥1 clarifying question from Lead via QuestionCard
- After user answers, Lead outputs `## MISSION UNDERSTANDING` section followed by plan JSON
- Plan is parsed and PlanReview shown as usual
- If superpowers not installed, behavior is identical to Interactive mode (no crash)
- No regression to existing permission modes (Auto-pilot, Interactive, Plan Only)
