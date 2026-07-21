# QA/Testing Standards Block — Design

## Problem

`electron/prompts/planning.md` already mandates that every plan include a dedicated `qa-tester` agent (lines 143-145), including a final "Final verification & sign-off" task gated on all implementation tasks. But the mandate only requires the agent to *exist* — it carries no quality bar for what "good" automated tests look like. As a result, Lead-generated plans can produce a qa-tester agent whose tasks are vague ("write tests for the above") or whose eventual test code (written by whichever teammate agent implements it) uses brittle locators, flaky waits, or skips proper test structure.

The user maintains three QC knowledge-base documents at `docs/qc guide/`:
- `AI_Playwright_Testing_Rules.md` — locator priority, web-first assertions, Page Object Model structure, AI-prompting workflow for generating tests
- `Checklist_Review_Automation_Test.md` — a 26-item PASS/FAIL acceptance checklist across structure, locators, assertions, flakiness, data/security, and actual test runs
- `Test_Definition_and_Scenario_Guide.md` — test pyramid ratios, test-type definitions, Given/When/Then scenario-writing, test-case naming, and flaky-test root causes

These represent validated team standards that are not currently reflected anywhere in the Lead's planning prompt, so nothing forces generated plans (or the qa-tester agent's resulting task detail) to follow them.

## Goal

Distill the 3 QC guide documents into a condensed, actionable standards block embedded directly in the existing `qa-tester` agent mandate in `electron/prompts/planning.md`, so that every plan's QA tasks are generated with these standards already baked into their `detail` fields.

## Approach

Embed a new "QA/TESTING STANDARDS" block in `electron/prompts/planning.md`, inserted immediately after the existing lines 143-145 (the current `qa-tester` mandate). This keeps the standard scoped to the one place plans are generated, rather than requiring a new agent type or copying the full guide files into every project's context.

The block condenses to ~20-25 lines, covering only the operative rules a plan-generation LLM needs to bake into qa-tester task `detail` fields — not the full rationale, background, or tooling reference sections from the source docs.

## Content of the New Block

Inserted after the current line 145, the new block covers:

1. **Locator priority** — same hierarchy as the guide: `getByTestId → getByRole → getByLabel → getByPlaceholder → getByText → css` (css only as last resort). Explicitly bans `nth-child`, dynamic classes, and complex XPath.
2. **Web-first assertions only** — `expect(locator).toBeVisible()` / `toHaveText()` / `toHaveURL()` etc. Bans `waitForTimeout()` and manual `.textContent()`/`.innerText()` comparison.
3. **Page Object Model structure** — locators/actions in `tests/pages/`, spec files contain only Given/When/Then scenarios, no raw selectors in spec files.
4. **Scenario-writing requirement** — every test case is written as Given/When/Then, and scenario coverage must be prioritized in this order: Happy path → Validation → Business error → Permission (if applicable) → Edge case.
5. **Correct test-type selection** — favor the test pyramid (mostly unit/integration, E2E only for critical user flows); don't default to E2E for everything.
6. **Anti-flaky requirements** — tests must be independent (no inter-test ordering dependency), self-seed/clean their own data, and be deterministic (same input → same result every run).
7. **Final sign-off task addition** — the existing "Final verification & sign-off" task (already required by line 145) must additionally state which test types were written (unit/integration/E2E breakdown) and confirm zero `waitForTimeout` usages remain in the suite.

## Scope

Single file, single insertion point: `electron/prompts/planning.md`, immediately after line 145. No changes to any other prompt file, no new agent type, no changes to `mission.cjs` or any runtime code. The 3 source `docs/qc guide/*.md` files are not modified — they remain the canonical detailed reference; the new block is a condensed operational summary derived from them for use inside the planning prompt.

## Acceptance Criteria

- The new block appears in `electron/prompts/planning.md` directly after the existing line 145 qa-tester mandate, before the "Phase 3: Execute" section.
- All 7 content points above are present in the block, condensed to roughly 20-25 lines.
- No other section of `planning.md` is altered.
- Plans generated after this change should show qa-tester task `detail` fields reflecting these standards (e.g., mentioning `getByTestId`, Given/When/Then structure, POM file layout) — verified by manually triggering a mission plan and inspecting the qa-tester agent's task details.
