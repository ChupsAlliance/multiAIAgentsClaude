# Business Summary Section + Flow Diagram — Design Spec

**Date:** 2026-07-18
**Feature:** Add a plain-language "Nghiệp vụ" (business) section with a simple flow diagram to the Review Plan screen, so a non-technical lead can read it and quickly grasp what the plan does, what it outputs, and how the new feature works — aligning the business flow with the tasks assigned to agents.

---

## Goal

At the Review Plan phase, after the **Tổng quan** section, present a read-only **Nghiệp vụ** panel written for non-technical lead users. It answers three questions in plain Vietnamese — what the plan does, what you get out of it, how the new feature works — and shows a simple **Input → processing steps → Output** flow diagram where each processing step is tagged with the agent responsible for it. The lead should be able to read the business text + diagram alone and understand the whole plan, aligning it to the agent tasks.

## Non-Goals

- No change to how technical agents/tasks are authored, parsed, or executed.
- The business content is NOT serialized into the editable plan markdown; it is read directly from `mission_context`. Markdown round-trip editing (`planToMarkdown` ↔ `parseMissionPlan`) is unaffected.
- No new runtime dependency (the flow diagram is self-rendered SVG, matching the existing `PlanDependencyGraph` approach).
- Not reusing `PlanDependencyGraph` — that graph shows technical task dependencies; this is a business Input→Output flow.

## Tech Stack

- React 19 + Vite (existing)
- Self-rendered SVG (no mermaid, no new deps)
- Vitest for unit tests
- Vietnamese UI copy, VS Code dark theme (existing conventions)

## Global Constraints

- All new UI copy in Vietnamese.
- Colors follow the existing VS Code dark palette. Agent colors are assigned deterministically from the agent name (a stable hash → palette index) so the same agent name always maps to the same color within this feature.
- No new npm dependency.
- The feature must degrade gracefully: missing/partial `mission_context.business` never crashes and never renders an empty panel.
- Do not modify `parseMissionPlan` or `planToMarkdown` behavior for existing content.

---

## Architecture

### 1. Data source — Lead output (`electron/prompts/planning.md`)

The Lead already emits a `mission_context` object with `problem`, `user_journey`, `agent_handoff`. Extend it with a `business` object (plain-language Vietnamese, for non-tech readers):

```json
"mission_context": {
  "problem": "...",
  "user_journey": "...",
  "agent_handoff": "...",
  "business": {
    "what_it_does": "1-2 câu: plan này làm gì, nói theo ngôn ngữ nghiệp vụ",
    "what_you_get": "1-2 câu: sau khi xong, user/hệ thống có thêm được gì (output cụ thể)",
    "how_it_works": "2-3 câu tổng quan: chức năng mới vận hành ra sao",
    "flow": {
      "input": "Người dùng/hệ thống bắt đầu bằng gì",
      "steps": [
        { "label": "Bước xử lý (ngôn ngữ nghiệp vụ)", "by": "agent-name" }
      ],
      "output": "Kết quả cuối cùng người dùng nhận được"
    }
  }
}
```

- `flow.steps[].by` links each business step to the agent responsible → the bridge between business language and technical tasks.
- The existing `problem` / `user_journey` / `agent_handoff` fields are kept unchanged (Tổng quan still renders them).
- The prompt instructs the Lead that `business` is written for a non-technical reader: no jargon, no file names, no framework names — describe outcomes and behavior.

### 2. Flow model helper (pure, testable)

`src/utils/businessFlow.js` exports `buildFlowModel(business, agents)`:

```
buildFlowModel(business, agents) → {
  visible: boolean,          // false when business is absent/empty
  hasFlow: boolean,          // false when flow or its parts are missing
  summary: { whatItDoes, whatYouGet, howItWorks },  // strings (may be '')
  nodes: [                   // ordered: input, ...steps, output
    { kind: 'input'|'step'|'output', label: string, agentName: string|null, color: string }
  ],
  edges: [ { from: index, to: index } ]  // linear chain
}
```

Rules:
- `visible` is `false` when `business` is null/undefined or all of `what_it_does`, `what_you_get`, `how_it_works`, and `flow` are empty.
- `hasFlow` is `false` when `flow` is missing, or `flow` has no `input`, no `output`, and no non-empty `steps`.
- Each step node's `agentName` = `step.by` if that agent exists in `agents`, else the raw `step.by` string is kept as `agentName` but `color` falls back to the default (so the tag shows but is not linkable). If `step.by` is empty/missing, `agentName` is `null`.
- `color` for a step whose agent exists = `agentColor(agentName)` — a deterministic hash of the agent name into a fixed palette (same name → same color, stable across renders). `input` and `output` nodes use fixed neutral colors.
- `edges` form a single linear chain input → step1 → … → stepN → output over whatever nodes exist.

`agentColor(name)` is a new helper in `businessFlow.js` (small string-hash → palette index). Note: `PlanDependencyGraph` colors nodes by priority/status, not by agent, so there is no existing per-agent scheme to reuse — this helper is self-contained to this feature.

### 3. Presentation components

**`src/components/mission/BusinessFlowDiagram.jsx`** — renders the SVG flow from `buildFlowModel(...).nodes/edges`:
- Horizontal chain of boxes: Input → steps → Output, connected by arrows.
- Each step box shows its `label` and, when `agentName` is set, a small `🤖 <agentName>` tag. Clicking the tag calls `onJumpToAgent(agentName)`.
- Boxes wrap to the next row when they exceed the container width (no horizontal overflow).
- Step box border/accent uses the node `color`.

**`src/components/mission/BusinessSummary.jsx`** — the read-only panel:
- Header "📖 Nghiệp vụ" with a collapse/expand toggle (collapsed state lets the lead hide it to read the technical markdown).
- Three labeled lines: "Làm gì", "Nhận được", "Cách hoạt động" (each omitted if its string is empty).
- Renders `<BusinessFlowDiagram>` below the text when `hasFlow` is true.
- Renders nothing at all when `visible` is false.
- Props: `business` (the `mission_context.business` object), `agents` (array), `onJumpToAgent(agentName)`.

### 4. Integration — `src/components/mission/PlanDocument.jsx`

- Render `<BusinessSummary>` at the top of the Document tab, after the plan header/stats and before/above the editable markdown region (outside the textarea/preview edit area).
- `business` comes from `plan.mission_context?.business` (already threaded into `PlanDocument`; if `mission_context` is not currently passed down, thread it through from the existing plan object).
- `onJumpToAgent(agentName)`: locate the `## 🤖 Agent: <name>` heading using the existing `extractOutline(markdown)` (find the entry of `type: 'agent'` whose `text` matches), then scroll the markdown preview to that line's element.

---

## Data Flow

```
planning.md (Lead)
  → plan JSON with mission_context.business
  → electron/ipc/mission.cjs (parses & stores mission_context — already does this)
  → useMission (state)
  → PlanReview
  → PlanDocument
      → buildFlowModel(plan.mission_context.business, agents)
      → <BusinessSummary business agents onJumpToAgent>
          → <BusinessFlowDiagram nodes edges onJumpToAgent>
```

No new IPC. No change to plan persistence. The business object rides along inside the already-persisted `mission_context`.

## Error Handling

| Condition | Behavior |
|---|---|
| No `mission_context.business` | `visible=false` → panel not rendered at all |
| `business` present, no `flow` | Show the 3 text lines, hide diagram (`hasFlow=false`) |
| `flow.steps` empty | Draw Input → Output only (if both present); else hide diagram |
| `step.by` points to unknown agent | Draw step box, show `🤖 <name>` tag with default color, tag not clickable/linkable |
| `step.by` empty/missing | Draw step box with no agent tag |
| Very long text / many steps | Text clamps/wraps; boxes wrap to new rows — no overflow |
| Old plan (Lead didn't emit `business`) | Same as "no business" → panel hidden, zero regression |

## Testing

Vitest unit tests for `buildFlowModel` (pure function — no DOM render, matching the existing lightweight suite):

1. Full data → `visible=true`, `hasFlow=true`, node count = input + N steps + output, edges form the linear chain, step colors match agent colors.
2. `business` present but no `flow` → `visible=true`, `hasFlow=false`, `summary` populated.
3. `step.by` references an unknown agent → node `agentName` set, `color` = default, and (documented) not linkable.
4. No `business` → `visible=false`.
5. `flow` with steps but missing `input`/`output` → chain built over the nodes that exist.
6. `agentColor(name)` is deterministic: same name → same color across calls; different names generally differ.

No heavy render tests. Existing tests must continue to pass unchanged.

## Files

- **Modify:** `electron/prompts/planning.md` — add `business` object to the `mission_context` schema + authoring rules (non-tech language).
- **Create:** `src/utils/businessFlow.js` — `buildFlowModel`, `agentColor`.
- **Create:** `src/utils/businessFlow.test.js` — unit tests.
- **Create:** `src/components/mission/BusinessFlowDiagram.jsx` — SVG flow renderer.
- **Create:** `src/components/mission/BusinessSummary.jsx` — read-only panel.
- **Modify:** `src/components/mission/PlanDocument.jsx` — render `<BusinessSummary>` at top of Document tab; wire `onJumpToAgent`.
