# QA/Testing Standards Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a condensed "QA/TESTING STANDARDS" block into `electron/prompts/planning.md`, immediately after the existing `qa-tester` agent mandate (lines 143-145), so every Lead-generated plan bakes locator priority, web-first assertions, Page Object Model structure, Given/When/Then scenario writing, correct test-type selection, anti-flaky requirements, and an expanded sign-off requirement into its qa-tester task details.

**Architecture:** This is a single prompt-text change — no runtime logic. `electron/prompts/planning.md` is read and sent verbatim as part of the Lead agent's system/planning prompt (confirmed by its usage as a static instruction file consumed during Phase 2 plan generation). Adding text to this file changes what the Lead LLM is instructed to do when generating a plan's qa-tester agent tasks; it does not require code changes elsewhere.

**Tech Stack:** Plain Markdown prompt file. Verification is manual (triggering a real mission plan generation and inspecting output) since there is no automated way to unit-test an LLM's prompt-following behavior in this repo.

## Global Constraints

- Single file, single insertion point: `electron/prompts/planning.md`, immediately after line 145 (the current last line of the existing `qa-tester` mandate), before the blank line and `### Phase 3: Execute` header currently at lines 146-147.
- The new block must be ~20-25 lines and cover exactly these 7 points (verbatim from the spec): locator priority hierarchy, web-first assertions only, Page Object Model structure, Given/When/Then scenario requirement with priority order (Happy path → Validation → Business error → Permission → Edge case), correct test-type selection per the test pyramid, anti-flaky requirements, and an addition to the existing final sign-off task requiring it to state test-type breakdown and confirm zero `waitForTimeout` usages.
- No other section of `planning.md` may be altered.
- No changes to `docs/qc guide/*.md` — those remain the canonical detailed reference.
- No changes to any other prompt file, agent type, or runtime code (`mission.cjs`, etc).

---

### Task 1: Insert the QA/TESTING STANDARDS block into planning.md

**Files:**
- Modify: `electron/prompts/planning.md:145` (insert new content immediately after this line, before the existing blank line at 146)

**Interfaces:**
- Consumes: nothing (pure text file edit)
- Produces: nothing consumed by other tasks — this is the only task in this plan

- [ ] **Step 1: Confirm the exact current anchor text**

Run this to reprint the exact current lines 143-148 and confirm nothing has shifted since this plan was written:

```bash
awk 'NR==143,NR==148{print NR": "$0}' electron/prompts/planning.md
```

Expected output (must match exactly before proceeding — if it doesn't, stop and re-locate the anchor before editing):

```
143: - **EVERY plan MUST include a dedicated QA/tester agent (name it "qa-tester" or similar). Omitting this agent is a critical error — no exceptions, even for single-agent plans.**
144:   - The QA/tester agent is responsible for: writing automated tests, running tests after each implementation task completes, verifying acceptance criteria end-to-end, and catching regressions.
145:   - The QA/tester agent MUST have a final task titled "Final verification & sign-off" (or equivalent) that: (1) `depends_on` ALL implementation tasks, (2) runs the full test suite end-to-end, (3) verifies every acceptance criterion from every task is met, (4) confirms the feature works from the user's perspective. **Nothing ships until this task passes — it is the gate before the plan is considered complete.**
146: 
147: ### Phase 3: Execute (only after user confirms)
148: After the user confirms, you will receive a follow-up message to spawn teammates with the approved models.
```

- [ ] **Step 2: Insert the new block after line 145**

Using the Edit tool (or equivalent), replace this exact text:

```
  - The QA/tester agent MUST have a final task titled "Final verification & sign-off" (or equivalent) that: (1) `depends_on` ALL implementation tasks, (2) runs the full test suite end-to-end, (3) verifies every acceptance criterion from every task is met, (4) confirms the feature works from the user's perspective. **Nothing ships until this task passes — it is the gate before the plan is considered complete.**

### Phase 3: Execute (only after user confirms)
```

with this text (the old two lines, unchanged, plus the new block inserted between them and the Phase 3 header):

```
  - The QA/tester agent MUST have a final task titled "Final verification & sign-off" (or equivalent) that: (1) `depends_on` ALL implementation tasks, (2) runs the full test suite end-to-end, (3) verifies every acceptance criterion from every task is met, (4) confirms the feature works from the user's perspective. **Nothing ships until this task passes — it is the gate before the plan is considered complete.**

  **QA/TESTING STANDARDS — bake these into every qa-tester task's `detail` field:**
  - **Locators (priority order):** `getByTestId` → `getByRole` → `getByLabel` → `getByPlaceholder` → `getByText` → CSS selector (last resort only). NEVER use `nth-child`, dynamic/generated classes, or complex XPath — these break on minor UI changes.
  - **Assertions:** Use web-first assertions only — `expect(locator).toBeVisible()`, `.toHaveText()`, `.toHaveURL()`, etc. NEVER use `waitForTimeout()` or manually compare `.textContent()`/`.innerText()` — both cause flaky, unreliable tests.
  - **Structure (Page Object Model):** Locators and actions live in `tests/pages/*Page.ts` classes. Spec files (`tests/specs/*.spec.ts`) contain ONLY the Given/When/Then scenario — no raw selectors inline in spec files.
  - **Scenario writing:** Every test case is written as Given/When/Then. When listing scenarios for a feature, prioritize in this order: (1) Happy path, (2) Validation errors, (3) Business-logic errors, (4) Permission/access-control cases (if applicable), (5) Edge cases.
  - **Test-type selection:** Follow the test pyramid — most coverage should be unit and integration tests; reserve E2E (Playwright) tests for critical user flows only. Don't default to E2E for everything a task touches.
  - **Anti-flaky requirements:** Every test must be independent (no ordering dependency on other tests), self-seed and clean up its own data (`beforeEach`/`afterEach`), and be deterministic — same input always produces the same result.
  - **Sign-off task requirement (in addition to the requirements above):** The "Final verification & sign-off" task's `detail` must also state which test types were written (unit/integration/E2E breakdown) and confirm zero `waitForTimeout` usages remain anywhere in the test suite.

### Phase 3: Execute (only after user confirms)
```

- [ ] **Step 3: Verify the edit landed correctly**

Run:

```bash
awk 'NR==143,NR==165{print NR": "$0}' electron/prompts/planning.md
```

Expected: lines 143-145 unchanged, followed by a blank line, the new `**QA/TESTING STANDARDS ...**` block (7 bullet points as shown above), a blank line, then `### Phase 3: Execute (only after user confirms)` — confirm no stray duplicate lines and no missing bullets.

- [ ] **Step 4: Confirm no other part of the file changed**

```bash
git diff --stat electron/prompts/planning.md
```

Expected: exactly 1 file changed, insertions only (no deletions beyond the two lines that were replaced-and-restored verbatim in Step 2, which should net to 0 deletions since the old text reappears unchanged in the new text — if `git diff` shows any deletion, re-check Step 2 was a pure insertion).

- [ ] **Step 5: Commit**

```bash
git add electron/prompts/planning.md
git commit -m "feat: add QA/testing standards block to qa-tester planning prompt"
```

---

## Manual Verification (post-implementation, not part of Task 1's automated steps)

Since this change affects LLM prompt-following behavior rather than deterministic code, verify by triggering a real mission plan in the running app after this change is merged:

1. Start the app (`npm run electron:dev` or equivalent existing dev script) and kick off a mission that reaches Phase 2 plan generation.
2. Inspect the generated plan's `qa-tester` agent tasks.
3. Confirm the task `detail` fields reference at least some of: `getByTestId`, Given/When/Then structure, Page Object Model file layout (`tests/pages/`), or the test pyramid — this indicates the Lead is reading and applying the new block.
4. Confirm the "Final verification & sign-off" task's `detail` mentions test-type breakdown and zero `waitForTimeout`.

This step is manual because there is no automated harness in this repo for asserting on LLM planning output; note this limitation explicitly rather than skipping verification silently.
