# Business Summary Section + Flow Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Nghiệp vụ" (business) panel with a self-rendered SVG Input→steps→Output flow diagram to the top of the Review Plan Document tab, so a non-technical lead can grasp the whole plan and align business steps to agents.

**Architecture:** The Lead emits an extended `mission_context.business` object in the plan JSON. A pure helper `buildFlowModel(business, agents)` turns it into a render model. Two new presentational components (`BusinessFlowDiagram`, `BusinessSummary`) render it read-only above the editable markdown in `PlanDocument`. Nothing is serialized into the plan markdown, so markdown round-trip editing is untouched.

**Tech Stack:** React 19, Vite, self-rendered inline SVG (no new dependency), Vitest.

## Global Constraints

- All new UI copy in Vietnamese.
- Colors follow the VS Code dark palette (Tailwind `vs-*` classes already in the project). Agent colors are assigned deterministically from the agent name (stable hash → palette index): same name → same color.
- No new npm dependency.
- Feature degrades gracefully: missing/partial `mission_context.business` never crashes and never renders an empty panel.
- Do NOT modify `parseMissionPlan` or `planToMarkdown` behavior for existing content — the business object is read directly from `mission_context`, never written into markdown.

---

### Task 1: `buildFlowModel` + `agentColor` pure helper

**Files:**
- Create: `src/utils/businessFlow.js`
- Test: `src/utils/businessFlow.test.js`

**Interfaces:**
- Produces:
  - `agentColor(name: string) → string` — deterministic hex color from a fixed palette; empty/nullish name → the default color.
  - `buildFlowModel(business, agents) → { visible, hasFlow, summary, nodes, edges }` where:
    - `business` = `mission_context.business` object or null/undefined
    - `agents` = array of `{ name, ... }`
    - `summary` = `{ whatItDoes: string, whatYouGet: string, howItWorks: string }` (strings, possibly `''`)
    - `nodes` = ordered array of `{ kind: 'input'|'step'|'output', label: string, agentName: string|null, color: string }`
    - `edges` = array of `{ from: number, to: number }` (indices into `nodes`, linear chain)

- [ ] **Step 1: Write the failing tests**

Create `src/utils/businessFlow.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { buildFlowModel, agentColor } from './businessFlow'

const AGENTS = [{ name: 'backend-api' }, { name: 'frontend-ui' }]

const FULL = {
  what_it_does: 'Cho phép đăng nhập',
  what_you_get: 'Người dùng có phiên đăng nhập',
  how_it_works: 'Nhập email/mật khẩu, hệ thống xác thực, trả về phiên.',
  flow: {
    input: 'Người dùng nhập email + mật khẩu',
    steps: [
      { label: 'Xác thực thông tin', by: 'backend-api' },
      { label: 'Hiển thị màn hình chính', by: 'frontend-ui' },
    ],
    output: 'Người dùng vào được dashboard',
  },
}

describe('agentColor', () => {
  it('is deterministic for the same name', () => {
    expect(agentColor('backend-api')).toBe(agentColor('backend-api'))
  })
  it('returns a default color for empty name', () => {
    expect(typeof agentColor('')).toBe('string')
    expect(agentColor('')).toBe(agentColor(null))
  })
})

describe('buildFlowModel', () => {
  it('builds a full model with input + steps + output nodes', () => {
    const m = buildFlowModel(FULL, AGENTS)
    expect(m.visible).toBe(true)
    expect(m.hasFlow).toBe(true)
    expect(m.summary).toEqual({
      whatItDoes: 'Cho phép đăng nhập',
      whatYouGet: 'Người dùng có phiên đăng nhập',
      howItWorks: 'Nhập email/mật khẩu, hệ thống xác thực, trả về phiên.',
    })
    expect(m.nodes.map(n => n.kind)).toEqual(['input', 'step', 'step', 'output'])
    expect(m.nodes[1].agentName).toBe('backend-api')
    expect(m.nodes[1].color).toBe(agentColor('backend-api'))
    expect(m.edges).toEqual([{ from: 0, to: 1 }, { from: 1, to: 2 }, { from: 2, to: 3 }])
  })

  it('returns hasFlow=false when flow is missing but keeps summary', () => {
    const m = buildFlowModel({ what_it_does: 'X', what_you_get: '', how_it_works: '' }, AGENTS)
    expect(m.visible).toBe(true)
    expect(m.hasFlow).toBe(false)
    expect(m.summary.whatItDoes).toBe('X')
    expect(m.nodes).toEqual([])
  })

  it('keeps agentName but default color when agent is unknown', () => {
    const b = { flow: { input: 'A', steps: [{ label: 'B', by: 'ghost' }], output: 'C' } }
    const m = buildFlowModel(b, AGENTS)
    const step = m.nodes.find(n => n.kind === 'step')
    expect(step.agentName).toBe('ghost')
    expect(step.color).toBe(agentColor(''))
  })

  it('sets agentName null when step.by is missing', () => {
    const b = { flow: { input: 'A', steps: [{ label: 'B' }], output: 'C' } }
    const m = buildFlowModel(b, AGENTS)
    const step = m.nodes.find(n => n.kind === 'step')
    expect(step.agentName).toBe(null)
  })

  it('returns visible=false when business is absent', () => {
    expect(buildFlowModel(null, AGENTS).visible).toBe(false)
    expect(buildFlowModel(undefined, []).visible).toBe(false)
    expect(buildFlowModel({}, []).visible).toBe(false)
  })

  it('builds chain over only the nodes that exist (no input/output)', () => {
    const b = { flow: { steps: [{ label: 'Only step', by: 'backend-api' }] } }
    const m = buildFlowModel(b, AGENTS)
    expect(m.hasFlow).toBe(true)
    expect(m.nodes.map(n => n.kind)).toEqual(['step'])
    expect(m.edges).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/utils/businessFlow.test.js`
Expected: FAIL — `businessFlow` module / exports do not exist yet.

- [ ] **Step 3: Implement `src/utils/businessFlow.js`**

```js
/**
 * businessFlow.js — Build a render model for the read-only "Nghiệp vụ" panel.
 * Pure functions only; no React, no DOM.
 */

// Fixed palette (VS Code dark friendly). Index chosen by a stable hash of the name.
const PALETTE = ['#569cd6', '#4ec9b0', '#c586c0', '#dcdcaa', '#ce9178', '#9cdcfe', '#d7ba7d']
const DEFAULT_COLOR = '#6b7280' // neutral gray for input/output and unknown agents

/**
 * Deterministic color from an agent name.
 * @param {string} name
 * @returns {string} hex color
 */
export function agentColor(name) {
  if (!name || typeof name !== 'string') return DEFAULT_COLOR
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}

function str(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Build the flow render model from mission_context.business.
 *
 * @param {Object|null|undefined} business
 * @param {Array<{name:string}>} agents
 * @returns {{ visible:boolean, hasFlow:boolean, summary:Object, nodes:Array, edges:Array }}
 */
export function buildFlowModel(business, agents = []) {
  const empty = { visible: false, hasFlow: false, summary: { whatItDoes: '', whatYouGet: '', howItWorks: '' }, nodes: [], edges: [] }
  if (!business || typeof business !== 'object') return empty

  const summary = {
    whatItDoes: str(business.what_it_does),
    whatYouGet: str(business.what_you_get),
    howItWorks: str(business.how_it_works),
  }

  const flow = business.flow && typeof business.flow === 'object' ? business.flow : null
  const input = flow ? str(flow.input) : ''
  const output = flow ? str(flow.output) : ''
  const steps = flow && Array.isArray(flow.steps) ? flow.steps : []

  const hasAnySummary = summary.whatItDoes || summary.whatYouGet || summary.howItWorks
  const hasAnyFlow = !!(input || output || steps.some(s => str(s && s.label)))

  const visible = !!(hasAnySummary || hasAnyFlow)
  if (!visible) return empty

  const agentNames = new Set((agents || []).map(a => a && a.name).filter(Boolean))

  const nodes = []
  if (input) nodes.push({ kind: 'input', label: input, agentName: null, color: DEFAULT_COLOR })
  for (const s of steps) {
    const label = str(s && s.label)
    if (!label) continue
    const by = str(s && s.by)
    const agentName = by || null
    const color = by ? (agentNames.has(by) ? agentColor(by) : DEFAULT_COLOR) : DEFAULT_COLOR
    nodes.push({ kind: 'step', label, agentName, color })
  }
  if (output) nodes.push({ kind: 'output', label: output, agentName: null, color: DEFAULT_COLOR })

  const edges = []
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: i, to: i + 1 })

  return { visible, hasFlow: nodes.length > 0, summary, nodes, edges }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/utils/businessFlow.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/utils/businessFlow.js src/utils/businessFlow.test.js
git commit -m "feat: add buildFlowModel + agentColor helper for business summary"
```

---

### Task 2: `BusinessFlowDiagram` SVG component

**Files:**
- Create: `src/components/mission/BusinessFlowDiagram.jsx`

**Interfaces:**
- Consumes: `buildFlowModel(...)` output — specifically `nodes` and `edges`.
- Produces: `export function BusinessFlowDiagram({ nodes, edges, onJumpToAgent })` — a React component rendering the Input→steps→Output flow. `onJumpToAgent(agentName: string)` is called when a step's agent tag is clicked.

**Note:** This is a presentational component with no pure logic to unit-test in isolation (the logic lives in `buildFlowModel`, already tested in Task 1). Verification here is a render smoke check, not a new test file.

- [ ] **Step 1: Implement `src/components/mission/BusinessFlowDiagram.jsx`**

Boxes are laid out with flexbox (wrapping) rather than absolute SVG coordinates, so long flows wrap instead of overflowing. Each box is a div; arrows are small chevrons between boxes. (We keep "SVG-like" visuals with CSS boxes + lucide arrows — simpler and wrap-friendly than a fixed SVG canvas.)

```jsx
import { Bot, ArrowRight, LogIn, Flag } from 'lucide-react'

/**
 * Read-only business flow: Input → steps → Output.
 * Each step box may carry a clickable agent tag that calls onJumpToAgent.
 *
 * @param {{ nodes: Array, edges: Array, onJumpToAgent?: (name:string)=>void }} props
 */
export function BusinessFlowDiagram({ nodes = [], edges = [], onJumpToAgent }) {
  if (!nodes.length) return null

  const kindIcon = (kind) => {
    if (kind === 'input') return <LogIn size={11} className="shrink-0" />
    if (kind === 'output') return <Flag size={11} className="shrink-0" />
    return null
  }

  const kindLabel = (kind) => {
    if (kind === 'input') return 'Input'
    if (kind === 'output') return 'Output'
    return null
  }

  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {nodes.map((node, i) => (
        <div key={i} className="flex items-stretch gap-1.5">
          {/* Node box */}
          <div
            className="flex flex-col justify-between rounded-md border bg-[#252526] px-2.5 py-1.5 min-w-[120px] max-w-[190px]"
            style={{ borderColor: node.color }}
          >
            <div className="flex items-center gap-1 mb-0.5">
              <span style={{ color: node.color }}>{kindIcon(node.kind)}</span>
              {kindLabel(node.kind) && (
                <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: node.color }}>
                  {kindLabel(node.kind)}
                </span>
              )}
            </div>
            <p className="text-[10px] leading-snug text-vs-text/90 break-words">{node.label}</p>
            {node.agentName && (
              <button
                type="button"
                onClick={() => onJumpToAgent?.(node.agentName)}
                className="mt-1 flex items-center gap-1 self-start rounded px-1 py-0.5
                           text-[8px] font-mono text-vs-muted hover:text-white hover:bg-white/10 transition-colors"
                title={`Xem agent: ${node.agentName}`}
                style={{ borderLeft: `2px solid ${node.color}` }}
              >
                <Bot size={8} className="shrink-0" />
                {node.agentName}
              </button>
            )}
          </div>

          {/* Arrow to next node (skip after the last node) */}
          {edges.some(e => e.from === i) && (
            <div className="flex items-center text-vs-muted">
              <ArrowRight size={12} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles (build smoke check)**

Run: `npx vite build --config vite.config.electron.mjs`
Expected: build succeeds with no error referencing `BusinessFlowDiagram` (the component is not yet imported anywhere, so this just confirms the file has no syntax/import error). If the full electron build is slow or unavailable, instead run `npx vitest run` and confirm the existing suite still passes (imports resolve under the test transformer).

- [ ] **Step 3: Commit**

```bash
git add src/components/mission/BusinessFlowDiagram.jsx
git commit -m "feat: add BusinessFlowDiagram read-only SVG-style flow component"
```

---

### Task 3: `BusinessSummary` panel component

**Files:**
- Create: `src/components/mission/BusinessSummary.jsx`

**Interfaces:**
- Consumes: `buildFlowModel(business, agents)` (Task 1), `BusinessFlowDiagram` (Task 2).
- Produces: `export function BusinessSummary({ business, agents, onJumpToAgent })` — the read-only panel. Renders `null` when `buildFlowModel(...).visible` is false.

- [ ] **Step 1: Implement `src/components/mission/BusinessSummary.jsx`**

```jsx
import { useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight } from 'lucide-react'
import { buildFlowModel } from '../../utils/businessFlow'
import { BusinessFlowDiagram } from './BusinessFlowDiagram'

/**
 * Read-only "Nghiệp vụ" panel shown above the editable plan markdown.
 * Written for non-technical leads: what the plan does, what you get, how it works,
 * plus an Input→steps→Output flow diagram.
 *
 * @param {{ business: Object, agents: Array, onJumpToAgent?: (name:string)=>void }} props
 */
export function BusinessSummary({ business, agents = [], onJumpToAgent }) {
  const [collapsed, setCollapsed] = useState(false)
  const model = buildFlowModel(business, agents)

  if (!model.visible) return null

  const { summary, hasFlow, nodes, edges } = model

  const Row = ({ label, value }) =>
    value ? (
      <div className="flex gap-2 text-[11px]">
        <span className="shrink-0 font-semibold text-vs-accent">{label}:</span>
        <span className="text-vs-text/85 leading-snug">{value}</span>
      </div>
    ) : null

  return (
    <div className="shrink-0 border-b border-vs-border bg-[#1b2733]">
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-white/5 transition-colors"
      >
        {collapsed ? <ChevronRight size={12} className="text-vs-accent" /> : <ChevronDown size={12} className="text-vs-accent" />}
        <BookOpen size={12} className="text-vs-accent" />
        <span className="text-[11px] font-bold text-white">Nghiệp vụ</span>
        <span className="ml-2 text-[9px] text-vs-muted font-mono">(cho người review — không kỹ thuật)</span>
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 pt-0.5 space-y-2">
          <div className="space-y-1">
            <Row label="Làm gì" value={summary.whatItDoes} />
            <Row label="Nhận được" value={summary.whatYouGet} />
            <Row label="Cách hoạt động" value={summary.howItWorks} />
          </div>

          {hasFlow && (
            <div className="pt-1">
              <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-vs-muted">Luồng hoạt động</div>
              <BusinessFlowDiagram nodes={nodes} edges={edges} onJumpToAgent={onJumpToAgent} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles (test suite smoke check)**

Run: `npx vitest run`
Expected: existing suite still passes; no import/resolve error from the new component files.

- [ ] **Step 3: Commit**

```bash
git add src/components/mission/BusinessSummary.jsx
git commit -m "feat: add BusinessSummary read-only panel component"
```

---

### Task 4: Wire `BusinessSummary` into `PlanDocument`

**Files:**
- Modify: `src/components/mission/PlanDocument.jsx`

**Interfaces:**
- Consumes: `BusinessSummary` (Task 3). `PlanDocument` already receives `missionContext` prop (see line ~253) and already has `handleOutlineJump(lineNum)` (line ~335), `outline` state (line ~266), and `agents` prop.

- [ ] **Step 1: Add the import**

At the top of `src/components/mission/PlanDocument.jsx`, after the existing `import { ExportDropdown } from './ExportDropdown'` line (line ~12), add:

```jsx
import { BusinessSummary } from './BusinessSummary'
```

- [ ] **Step 2: Add a jump-to-agent handler**

Inside the `PlanDocument` component, immediately after the existing `handleOutlineJump` `useCallback` (ends ~line 342), add:

```jsx
  // Jump from a business-flow agent tag to that agent's heading in the markdown
  const handleJumpToAgent = useCallback((agentName) => {
    const entry = outline.find(o => o.type === 'agent' && o.text === agentName)
    if (entry) handleOutlineJump(entry.line)
  }, [outline, handleOutlineJump])
```

- [ ] **Step 3: Render the panel above the main area**

In the JSX, the toolbar `</div>` is immediately followed by the main-area comment (line ~596: `{/* ── Main area: Outline + Editor/Preview + Version History panel ── */}`). Insert the panel between them:

Find:

```jsx
      {/* ── Main area: Outline + Editor/Preview + Version History panel ── */}
      <div className="flex flex-1 min-h-0">
```

Replace with:

```jsx
      {/* ── Business summary (read-only, for non-tech reviewers) ── */}
      <BusinessSummary
        business={missionContext?.business}
        agents={agents}
        onJumpToAgent={handleJumpToAgent}
      />

      {/* ── Main area: Outline + Editor/Preview + Version History panel ── */}
      <div className="flex flex-1 min-h-0">
```

- [ ] **Step 4: Verify the suite still passes**

Run: `npx vitest run`
Expected: all tests pass (no test depends on PlanDocument layout; this confirms no import/syntax regression).

- [ ] **Step 5: Manual verification**

Run: `npm run electron:dev`. Create or open a mission whose plan JSON includes `mission_context.business` (see Task 5 for the Lead-emitted shape). Confirm at the Review Plan → Document tab:
- The "Nghiệp vụ" panel appears above the editor with the 3 text rows.
- The flow diagram shows Input → step boxes → Output with agent tags.
- Clicking an agent tag jumps/scrolls the markdown to that agent's `## 🤖 Agent: <name>` heading (switches Raw mode if in Preview).
- Collapsing the panel hides its body; the editor still works.
- For an old plan WITHOUT `mission_context.business`, the panel does not appear at all and the screen is unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/mission/PlanDocument.jsx
git commit -m "feat: render BusinessSummary panel atop the plan Document tab"
```

---

### Task 5: Extend the Lead planning prompt to emit `mission_context.business`

**Files:**
- Modify: `electron/prompts/planning.md`

**Interfaces:**
- Produces: the Lead now outputs `mission_context.business` in the plan JSON, matching the shape `buildFlowModel` (Task 1) consumes: `{ what_it_does, what_you_get, how_it_works, flow: { input, steps: [{ label, by }], output } }`.

- [ ] **Step 1: Extend the `mission_context` block in the plan JSON schema**

In `electron/prompts/planning.md`, find the `mission_context` object inside the `=== MISSION PLAN ===` JSON block (lines ~45-49):

```json
  "mission_context": {
    "problem": "<What user problem does this solve — 1-2 sentences>",
    "user_journey": "<How a user uses the finished product end-to-end — describe the full flow from input to outcome>",
    "agent_handoff": "<How agents hand off work to each other — who produces what artifact, who consumes it>"
  },
```

Replace it with:

```json
  "mission_context": {
    "problem": "<What user problem does this solve — 1-2 sentences>",
    "user_journey": "<How a user uses the finished product end-to-end — describe the full flow from input to outcome>",
    "agent_handoff": "<How agents hand off work to each other — who produces what artifact, who consumes it>",
    "business": {
      "what_it_does": "<PLAIN Vietnamese, for a NON-TECHNICAL lead: what this plan does, 1-2 sentences. No jargon, no file names, no framework names.>",
      "what_you_get": "<PLAIN Vietnamese: the concrete outcome/output after this ships, 1-2 sentences>",
      "how_it_works": "<PLAIN Vietnamese: how the new feature behaves overall, 2-3 sentences>",
      "flow": {
        "input": "<What the user/system starts with — plain Vietnamese>",
        "steps": [
          { "label": "<One processing step in plain Vietnamese>", "by": "<the agent name responsible for this step — must match an agent in the agents array>" }
        ],
        "output": "<The final result the user gets — plain Vietnamese>"
      }
    }
  },
```

- [ ] **Step 2: Add authoring rules for the business object**

In `electron/prompts/planning.md`, find the section header `### TASK DETAIL RULES (CRITICAL — do NOT output vague tasks):` (line ~67). Immediately BEFORE that line, insert a new rules block:

```markdown
### BUSINESS SUMMARY RULES (mission_context.business):
The `business` object is read by a NON-TECHNICAL lead to review the plan at a glance. Write it in PLAIN Vietnamese:
- No technical jargon, no file paths, no framework/library names, no code.
- `what_it_does` / `what_you_get` / `how_it_works`: describe outcomes and behavior a non-engineer understands.
- `flow.steps`: 2-5 steps, each a business-level action (not an implementation step). Each step's `by` MUST be one of the agent names in the `agents` array, so the reviewer can see which agent does what.
- `flow.input` is where things start (what the user/system provides); `flow.output` is the end result the user receives.
- Keep every field short — this is a summary, not the full plan.

```

- [ ] **Step 3: Verify the JSON example is still valid**

Read the edited `=== MISSION PLAN ===` block and confirm the JSON is well-formed (balanced braces/brackets, commas between object members, `business` nested inside `mission_context` before its closing `},`).

Run: `node -e "const fs=require('fs'); const s=fs.readFileSync('electron/prompts/planning.md','utf8'); const m=s.match(/=== MISSION PLAN ===([\s\S]*?)=== END PLAN ===/); const json=m[1].trim(); JSON.parse(json.replace(/<[^>]*>/g, '\"x\"')); console.log('JSON template parses OK')"`

Expected: `JSON template parses OK` (the regex swaps `<...>` placeholders for `"x"` so the template can be parsed as real JSON).

- [ ] **Step 4: Commit**

```bash
git add electron/prompts/planning.md
git commit -m "feat: emit plain-language mission_context.business from Lead planning prompt"
```

---

### Task 6: Final spec-coverage verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `businessFlow.test.js`.

- [ ] **Step 2: Confirm no markdown round-trip regression**

Verify `src/utils/planMarkdown.js` was NOT modified in this feature (the business object is read from `mission_context`, never serialized into markdown):

Run: `git log --oneline -5 -- src/utils/planMarkdown.js`
Expected: the most recent commit touching it predates this feature's commits (no commit from this plan appears).

- [ ] **Step 3: Confirm graceful degradation path exists**

Read `src/utils/businessFlow.js` and confirm `buildFlowModel(null, [])` and `buildFlowModel({}, [])` both return `{ visible: false, ... }`, and `BusinessSummary` returns `null` when `!model.visible`. (Already covered by tests + the component guard — this is a final read-through, no code change.)

- [ ] **Step 4: Commit (only if cleanup was needed)**

If Steps 1-3 found nothing to fix, no commit is needed.
