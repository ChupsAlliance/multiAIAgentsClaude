# Playground UI Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the existing Playground UI (`src/pages/PlaygroundPage.jsx`) — translate remaining English labels to Vietnamese, replace the native `alert()` with an inline warning, and add an always-visible line explaining what the Launch button actually does — without changing component structure, the 3-step flow, or any Tauri IPC call.

**Architecture:** Pure copy/text edits plus one extended boolean-derivation inside the existing `PlaygroundPage` function component. No new components, no new files, no new state shape beyond renaming/extending two existing derived values.

**Tech Stack:** React 19 (function components + hooks), Tailwind CSS (utility classes only, no new classes except reusing existing `text-yellow-400`/`text-vs-muted` patterns), Vitest + `@testing-library/react` + `@testing-library/user-event` for tests, `@tauri-apps/api/core` `invoke()` mocked via `vi.mock` in tests (never hits real Tauri backend).

## Global Constraints

- Scope is exactly one file: `src/pages/PlaygroundPage.jsx`. Do not modify `src/data/templates.js`, `src/components/Sidebar.jsx`, `src/components/CodeBlock.jsx`, or any other file.
- Every English UI label must become Vietnamese **except** the page title `"Playground"` itself, which stays as-is (brand name, matches Sidebar's "Mission Control"/"Dashboard" style).
- Do not change the 3-step flow (chọn template → điền field → chọn folder → Khởi chạy), the `TemplateCard`/`FieldInput`/`LaunchStatus` component boundaries, or any of the 7 Tauri `invoke()` call names/signatures (`scaffold_project`, `save_to_history`, `launch_in_terminal`, `pick_folder`, `load_history`, `delete_history_entry`, `open_folder_in_explorer`).
- Do not change History view copy (already Vietnamese) or `templates.js` content (already Vietnamese).
- Do not change Tailwind classes/layout/colors except where the new explanatory text line in Task 3 requires new (but pattern-consistent) classes.
- The `alert('Vui lòng chọn project folder trước!')` call must be deleted entirely (not commented out, not replaced with a different alert) once the disable-condition covers the missing-folder case.

---

### Task 1: Translate remaining English UI labels to Vietnamese

**Files:**
- Modify: `src/pages/PlaygroundPage.jsx:228` (tab switcher labels)
- Modify: `src/pages/PlaygroundPage.jsx:303` (folder picker button)
- Modify: `src/pages/PlaygroundPage.jsx:339` (preview prompt label)
- Modify: `src/pages/PlaygroundPage.jsx:360` (Launch button text — also touched by Task 2/3, translate text now)
- Modify: `src/pages/PlaygroundPage.jsx:374` (Copy button text)
- Modify: `src/pages/PlaygroundPage.jsx:381` (Export button text)
- Test: `src/pages/PlaygroundPage.i18n.test.jsx`

**Interfaces:**
- Consumes: nothing new — this task only changes JSX literal text inside the existing `PlaygroundPage` component.
- Produces: nothing new — no exported names change. Later tasks (2, 3) edit adjacent JSX in the same button block (lines ~351-368) and must preserve the Vietnamese strings this task introduces (`"Khởi chạy — Tạo tệp & Mở terminal"` on the Launch button, `"Sao chép prompt"` / `"Đã sao chép!"` on Copy, `"Xuất .txt"` on Export).

- [ ] **Step 1: Write the failing test for translated labels**

Create `src/pages/PlaygroundPage.i18n.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { PlaygroundPage } from './PlaygroundPage'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd) => {
    if (cmd === 'load_history') return Promise.resolve([])
    return Promise.resolve(null)
  }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <PlaygroundPage />
    </MemoryRouter>
  )
}

test('tab switcher shows Vietnamese labels, not English', async () => {
  renderPage()
  expect(await screen.findByText('Xây dựng')).toBeInTheDocument()
  expect(screen.getByText('Lịch sử (0)')).toBeInTheDocument()
  expect(screen.queryByText('Builder')).not.toBeInTheDocument()
  expect(screen.queryByText(/^History/)).not.toBeInTheDocument()
})

test('folder picker button shows Vietnamese label after selecting a template', async () => {
  const { container } = renderPage()
  const firstTemplateCard = container.querySelector('button.text-left')
  firstTemplateCard.click()
  expect(await screen.findByText('Chọn folder')).toBeInTheDocument()
  expect(screen.queryByText('Browse')).not.toBeInTheDocument()
})

test('preview label, copy button, and export button show Vietnamese text', async () => {
  const { container } = renderPage()
  const firstTemplateCard = container.querySelector('button.text-left')
  firstTemplateCard.click()
  expect(await screen.findByText('Xem trước prompt')).toBeInTheDocument()
  expect(screen.getByText('Sao chép prompt')).toBeInTheDocument()
  expect(screen.getByText('Xuất .txt')).toBeInTheDocument()
  expect(screen.queryByText('Preview prompt')).not.toBeInTheDocument()
  expect(screen.queryByText('Copy prompt')).not.toBeInTheDocument()
  expect(screen.queryByText('Export .txt')).not.toBeInTheDocument()
})

test('launch button shows Vietnamese text', async () => {
  const { container } = renderPage()
  const firstTemplateCard = container.querySelector('button.text-left')
  firstTemplateCard.click()
  expect(await screen.findByText(/Khởi chạy — Tạo tệp & Mở terminal/)).toBeInTheDocument()
  expect(screen.queryByText(/Launch — Tạo files/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/PlaygroundPage.i18n.test.jsx`
Expected: FAIL — `findByText('Xây dựng')` etc. not found, because the current code still renders `"Builder"`, `"Browse"`, `"Preview prompt"`, `"Copy prompt"`, `"Export .txt"`, `"Launch — Tạo files & Mở terminal"`.

- [ ] **Step 3: Translate the tab switcher (line 228)**

In `src/pages/PlaygroundPage.jsx`, find:

```jsx
                  {v === 'builder' ? 'Builder' : `History (${history.length})`}
```

Replace with:

```jsx
                  {v === 'builder' ? 'Xây dựng' : `Lịch sử (${history.length})`}
```

- [ ] **Step 4: Translate the folder picker button (line 303)**

Find:

```jsx
                        <FolderOpen size={13} />Browse
```

Replace with:

```jsx
                        <FolderOpen size={13} />Chọn folder
```

- [ ] **Step 5: Translate the preview label (line 339)**

Find:

```jsx
                  <p className="text-[10px] text-vs-muted font-mono uppercase tracking-widest mb-2">Preview prompt</p>
```

Replace with:

```jsx
                  <p className="text-[10px] text-vs-muted font-mono uppercase tracking-widest mb-2">Xem trước prompt</p>
```

- [ ] **Step 6: Translate the Launch button text (line 360)**

Find:

```jsx
                    Launch — Tạo files &amp; Mở terminal
```

Replace with:

```jsx
                    Khởi chạy — Tạo tệp &amp; Mở terminal
```

- [ ] **Step 7: Translate the Copy button text (line 374)**

Find:

```jsx
                      {copied ? <><Check size={12} />Copied!</> : <><Copy size={12} />Copy prompt</>}
```

Replace with:

```jsx
                      {copied ? <><Check size={12} />Đã sao chép!</> : <><Copy size={12} />Sao chép prompt</>}
```

- [ ] **Step 8: Translate the Export button text (line 381)**

Find:

```jsx
                      <Download size={12} />Export .txt
```

Replace with:

```jsx
                      <Download size={12} />Xuất .txt
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/pages/PlaygroundPage.i18n.test.jsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 10: Run full test suite to check for regressions**

Run: `npm test`
Expected: PASS — all existing tests (110 previously) plus the 4 new ones still pass.

- [ ] **Step 11: Commit**

```bash
git add src/pages/PlaygroundPage.jsx src/pages/PlaygroundPage.i18n.test.jsx
git commit -m "feat(playground): translate remaining English labels to Vietnamese"
```

---

### Task 2: Replace `alert()` with inline warning for missing project folder

**Files:**
- Modify: `src/pages/PlaygroundPage.jsx:134-136` (`handleLaunch` — remove the `alert()` guard)
- Modify: `src/pages/PlaygroundPage.jsx:203-205` (rename/extend `missingRequired` into two named conditions)
- Modify: `src/pages/PlaygroundPage.jsx:353-368` (Launch button `disabled` condition + warning text block)
- Test: `src/pages/PlaygroundPage.launch-validation.test.jsx`

**Interfaces:**
- Consumes: `selectedTpl` (object with `.fields[]`, each `{id, required}`), `fields` (object keyed by field id), `projectPath` (string), `generatedPrompt` (string) — all pre-existing state from `PlaygroundPage`.
- Produces: two new derived boolean constants replacing `missingRequired`:
  - `missingRequiredFields` — `boolean`, true when `selectedTpl` has required fields not yet filled (same logic `missingRequired` had before).
  - `missingProjectFolder` — `boolean`, true when `!projectPath`.
  These two names are used directly in Task 2's own Launch-button JSX; Task 3 reads `missingProjectFolder` again when placing its new always-visible line, so Task 3's implementer must use these exact names (not reintroduce `missingRequired`).

- [ ] **Step 1: Write the failing test for alert-free, disabled-button behavior**

Create `src/pages/PlaygroundPage.launch-validation.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { PlaygroundPage } from './PlaygroundPage'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd) => {
    if (cmd === 'load_history') return Promise.resolve([])
    return Promise.resolve(null)
  }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <PlaygroundPage />
    </MemoryRouter>
  )
}

async function selectFirstTemplateAndFillRequiredFields(container) {
  const firstTemplateCard = container.querySelector('button.text-left')
  await userEvent.click(firstTemplateCard)
  const requiredInput = container.querySelector('input[type="text"], input:not([type])')
  if (requiredInput) await userEvent.type(requiredInput, 'test value')
}

test('does not call window.alert when Launch is clicked without a folder', async () => {
  const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
  const { container } = renderPage()
  await selectFirstTemplateAndFillRequiredFields(container)

  const launchButton = await screen.findByRole('button', { name: /Khởi chạy/ })
  await userEvent.click(launchButton)

  expect(alertSpy).not.toHaveBeenCalled()
  alertSpy.mockRestore()
})

test('Launch button is disabled when project folder is empty', async () => {
  const { container } = renderPage()
  await selectFirstTemplateAndFillRequiredFields(container)

  const launchButton = await screen.findByRole('button', { name: /Khởi chạy/ })
  expect(launchButton).toBeDisabled()
})

test('shows inline warning "Chọn project folder để khởi chạy" when folder missing', async () => {
  const { container } = renderPage()
  await selectFirstTemplateAndFillRequiredFields(container)

  expect(await screen.findByText('Chọn project folder để khởi chạy')).toBeInTheDocument()
})

test('Launch button enables once folder and required fields are filled', async () => {
  const { container } = renderPage()
  await selectFirstTemplateAndFillRequiredFields(container)

  const folderInput = screen.getByPlaceholderText('C:\\Users\\...\\my-project')
  await userEvent.type(folderInput, 'C:\\fake\\project')

  const launchButton = await screen.findByRole('button', { name: /Khởi chạy/ })
  expect(launchButton).not.toBeDisabled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/PlaygroundPage.launch-validation.test.jsx`
Expected: FAIL — clicking Launch without a folder currently triggers `window.alert(...)` (first test fails), and the warning text `"Chọn project folder để khởi chạy"` does not exist yet (third test fails).

- [ ] **Step 3: Remove the `alert()` guard from `handleLaunch`**

Find (lines 134-136):

```jsx
  const handleLaunch = async () => {
    if (!generatedPrompt) return
    if (!projectPath) { alert('Vui lòng chọn project folder trước!'); return }
```

Replace with:

```jsx
  const handleLaunch = async () => {
    if (!generatedPrompt || !projectPath) return
```

- [ ] **Step 4: Rename and extend `missingRequired` into two named conditions**

Find (lines 203-205):

```jsx
  const missingRequired = selectedTpl?.fields
    .filter(f => f.required && !fields[f.id])
    .length > 0
```

Replace with:

```jsx
  const missingRequiredFields = selectedTpl?.fields
    .filter(f => f.required && !fields[f.id])
    .length > 0

  const missingProjectFolder = !projectPath
```

- [ ] **Step 5: Update the Launch button's disabled condition and warning text**

This step runs after Task 1 is complete, so the Launch button text is already `Khởi chạy — Tạo tệp &amp; Mở terminal` (translated in Task 1 Step 6). Only the `disabled` condition, the `className` ternary, and the warning-text block below the button change here — the button's visible text itself is untouched by this step.

Find (lines 353-368):

```jsx
                  <button onClick={handleLaunch}
                    disabled={!generatedPrompt || !projectPath || missingRequired}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-colors
                      ${generatedPrompt && projectPath && !missingRequired
                        ? 'bg-vs-accent hover:bg-vs-accent2 text-white cursor-pointer'
                        : 'bg-vs-border text-vs-muted cursor-not-allowed'}`}>
                    <Terminal size={15} />
                    Khởi chạy — Tạo tệp &amp; Mở terminal
                    <ArrowRight size={14} />
                  </button>

                  {missingRequired && selectedTpl && (
                    <p className="text-[10px] text-yellow-400 text-center">
                      Điền đầy đủ các trường bắt buộc (*) để Launch
                    </p>
                  )}
```

Replace with:

```jsx
                  <button onClick={handleLaunch}
                    disabled={!generatedPrompt || missingProjectFolder || missingRequiredFields}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-colors
                      ${generatedPrompt && !missingProjectFolder && !missingRequiredFields
                        ? 'bg-vs-accent hover:bg-vs-accent2 text-white cursor-pointer'
                        : 'bg-vs-border text-vs-muted cursor-not-allowed'}`}>
                    <Terminal size={15} />
                    Khởi chạy — Tạo tệp &amp; Mở terminal
                    <ArrowRight size={14} />
                  </button>

                  {selectedTpl && missingRequiredFields && (
                    <p className="text-[10px] text-yellow-400 text-center">
                      Điền đầy đủ các trường bắt buộc (*) để khởi chạy
                    </p>
                  )}

                  {selectedTpl && !missingRequiredFields && missingProjectFolder && (
                    <p className="text-[10px] text-yellow-400 text-center">
                      Chọn project folder để khởi chạy
                    </p>
                  )}
```

Note: if Task 2 is somehow executed before Task 1 (out of plan order), the "Find" block's button text will instead read `Launch — Tạo files &amp; Mở terminal` (the pre-Task-1 original) — match on the surrounding `disabled=`/`className=`/warning-paragraph lines rather than the button text in that case, and leave the button text exactly as found (Task 1 will translate it later).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/pages/PlaygroundPage.launch-validation.test.jsx`
Expected: PASS — all 4 tests green.

- [ ] **Step 7: Run full test suite to check for regressions**

Run: `npm test`
Expected: PASS — all tests including Task 1's 4 new tests still pass.

- [ ] **Step 8: Commit**

```bash
git add src/pages/PlaygroundPage.jsx src/pages/PlaygroundPage.launch-validation.test.jsx
git commit -m "fix(playground): replace alert() with inline folder-missing warning"
```

---

### Task 3: Add always-visible Launch-behavior explanation line

**Files:**
- Modify: `src/pages/PlaygroundPage.jsx` (insert new line directly above the Task 2 warning block, inside the same `<div className="space-y-2">` action-buttons container, lines ~352-372 after Task 2's edits)
- Test: `src/pages/PlaygroundPage.launch-explanation.test.jsx`

**Interfaces:**
- Consumes: no new state — this is a static text line with no conditional rendering (always visible whenever the action-buttons block renders, i.e. always, since that block is not itself conditional on `selectedTpl`).
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Write the failing test for the always-visible explanation line**

Create `src/pages/PlaygroundPage.launch-explanation.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { PlaygroundPage } from './PlaygroundPage'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd) => {
    if (cmd === 'load_history') return Promise.resolve([])
    return Promise.resolve(null)
  }),
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <PlaygroundPage />
    </MemoryRouter>
  )
}

const EXPLANATION_TEXT = 'Sẽ tạo tệp .md trong .claude-agent-team/ và mở terminal thật tại folder đã chọn.'

function findExplanationParagraph(container) {
  return Array.from(container.querySelectorAll('p')).find(
    (p) => p.textContent === EXPLANATION_TEXT
  )
}

test('shows Launch-behavior explanation line even with no template selected', () => {
  const { container } = renderPage()
  expect(findExplanationParagraph(container)).toBeTruthy()
})

test('explanation line still visible after selecting a template (button enabled or not)', async () => {
  const { container } = renderPage()
  const firstTemplateCard = container.querySelector('button.text-left')
  firstTemplateCard.click()
  await screen.findByText('Chọn folder')
  expect(findExplanationParagraph(container)).toBeTruthy()
})
```

**Why not `getByText(regex)`:** Step 3's JSX wraps `.claude-agent-team/` in an inline `<code>` element, so the sentence is split across a text node + `<code>` + text node. Testing Library's `getByText`/`findByText` only match a node's *direct* text-node children (`getNodeText`), never recursive `textContent` — so a single-node regex spanning the `<code>` boundary can never match, even though the rendered text is correct. Matching on the `<p>`'s full `textContent` directly sidesteps that limitation without changing the approved JSX/design.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/PlaygroundPage.launch-explanation.test.jsx`
Expected: FAIL — the explanation text does not exist yet anywhere in the component.

- [ ] **Step 3: Insert the always-visible explanation line**

Find the start of the action-buttons block (after Task 2's edits, this is the opening of the `<div className="space-y-2">` block that wraps the Launch button):

```jsx
                {/* Action buttons */}
                <div className="space-y-2">
                  <button onClick={handleLaunch}
                    disabled={!generatedPrompt || missingProjectFolder || missingRequiredFields}
```

Replace with (adding one new `<p>` line immediately before the button, still inside the same `<div className="space-y-2">`):

```jsx
                {/* Action buttons */}
                <div className="space-y-2">
                  <p className="text-[10px] text-vs-muted text-center">
                    Sẽ tạo tệp .md trong <code className="text-vs-string font-mono">.claude-agent-team/</code> và mở terminal thật tại folder đã chọn.
                  </p>

                  <button onClick={handleLaunch}
                    disabled={!generatedPrompt || missingProjectFolder || missingRequiredFields}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/PlaygroundPage.launch-explanation.test.jsx`
Expected: PASS — both tests green.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npm test`
Expected: PASS — all tests from Task 1, Task 2, and Task 3 pass together (should be 110 pre-existing + 10 new = 120 total, exact count may vary slightly if the suite grew elsewhere in the meantime — the key check is zero failures).

- [ ] **Step 6: Commit**

```bash
git add src/pages/PlaygroundPage.jsx src/pages/PlaygroundPage.launch-explanation.test.jsx
git commit -m "feat(playground): add always-visible Launch behavior explanation"
```

---

## Self-Review Notes

**Spec coverage:**
- Design §1 (language sync table, 7 rows) → fully covered by Task 1 (6 rows: tab switcher covers 2 rows in one edit, folder button, preview label, launch text, copy text, export text = 7 total).
- Design §2 (alert → inline warning, `missingRequired` extension, disabled-logic unchanged, delete `alert()`) → fully covered by Task 2.
- Design §3 (always-visible explanation line, positioned above the §2 warning) → fully covered by Task 3, which inserts its line before the button and before Task 2's warning `<p>` blocks (which render below the button), satisfying "đặt phía trên dòng warning điều kiện ở mục 2."
- Acceptance criteria: "no English labels except page title" → Task 1. "No `alert()`, button pre-disabled with explanatory message" → Task 2. "Explanation line visible regardless of validate state" → Task 3 (test explicitly checks with no template selected). "Scaffold → save history → launch terminal flow unchanged" → no task touches `handleLaunch`'s body past the removed alert line; the three `invoke()` calls and their argument shapes are untouched.

**Placeholder scan:** No TBD/TODO, no "add appropriate handling," every step has literal before/after code and literal test code. Confirmed clean.

**Type consistency:** `missingRequired` (old name) is fully retired in Task 2 Step 4 and never reintroduced; Task 3 uses only `missingProjectFolder`/`missingRequiredFields` as established in Task 2's Interfaces block. Button JSX in Task 3 Step 3 shows the exact post-Task-2 `disabled` condition to avoid ambiguity about which version of the line it's inserting before.

---

**Plan complete and saved to `docs/superpowers/plans/2026-07-22-playground-ui-simplification-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
