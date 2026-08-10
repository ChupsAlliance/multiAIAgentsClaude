# CI pipeline — design

**Tracked issue:** #7 in `docs/critical-issues-review-2026-08-08.md` — "No CI pipeline at all"

## Problem

`.github/` contains only `copilot-instructions.md` — no `workflows/`. Nothing runs `npm test`, `npm run test:e2e`, or a build check automatically on PRs or pushes to `main`. `playwright.config.ts:21-22` already reads `process.env.CI` (`forbidOnly`, `retries`) as if CI exists, but it's dead code today — no workflow ever sets that variable.

**Prerequisite bug discovered during design:** `npx vitest run` currently reports **3 failed test files** even though all 403 real unit tests pass. Vitest's default include glob (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) sweeps up Playwright's `.spec.ts` files under `tests/specs/` — files that only make sense loaded through `playwright.config.ts`, not through Vitest. Running them under Vitest throws `Playwright Test did not expect test.describe() to be called here` for each one. This is the same failure signature previously investigated and closed as Issue #8 ("upstream Vite race, not reproducible") — that closure was wrong: it's a deterministic config gap in this repo, not a flaky upstream race. Wiring `npm test` into CI unchanged would make the `unit-test` job permanently red, so fixing this is a prerequisite task in this plan, not a separate future issue.

## Fix

### 1. Vitest test-discovery fix (prerequisite)

**`vitest.config.ts`** — add a `test.exclude` array so the Playwright spec directory is never swept into Vitest's run:

```ts
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    passWithNoTests: true,
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-electron/**',
      '**/release/**',
      'tests/specs/**',
    ],
  },
})
```

The first four entries restore Vitest's own built-in defaults explicitly (setting `exclude` overrides the built-in list rather than extending it), so nothing already excluded becomes newly included. `tests/specs/**` is the new entry that fixes the bug.

### 2. ESLint (new — no config exists today)

- **Add** `eslint.config.js` (flat config, matching ESLint's current default format) at the repo root:
  - `@eslint/js` recommended rules as the base.
  - `eslint-plugin-react` + `eslint-plugin-react-hooks` for JSX/hooks-specific rules (project is React 19 function components + hooks throughout).
  - Scope: lint `src/**`, `electron/**`, `scripts/**`. Exclude `node_modules`, `dist`, `dist-electron`, `release`, `tests/specs` (Playwright specs use their own conventions, e.g. `test.describe`, that a React-focused config would misflag).
  - `languageOptions.ecmaVersion: 'latest'`, `sourceType: 'module'` for `src/`; a separate override block for `electron/**/*.cjs` files with CommonJS `sourceType: 'commonjs'` and Node globals, since the Electron main-process code is `.cjs`.
- **Add** `"lint": "eslint ."` to `package.json` scripts.
- **Run it, fix every violation surfaced on the existing codebase** (exact count unknown until run — this is a plan task, not estimated here). No suppression comments to force a clean run; real violations get fixed. If a rule proves too noisy/opinionated for this codebase's existing style (e.g. prop-types, which this codebase doesn't use), it gets turned off deliberately in the config with the reasoning visible in the config file itself, not silenced per-line.
- Once clean, `npm run lint` becomes a blocking CI job.

### 3. CI workflow

**New file: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint

  unit-test:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test

  build-check:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - run: npx vite build --config vite.config.electron.mjs

  e2e:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:e2e
      - name: Upload Playwright report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/
          retention-days: 7
```

Notes:
- All four jobs run on `windows-latest` — this matches production (the app is Windows-only; `electron-builder`'s `build.win`/`nsis` config has no other platform target) and lets the `e2e` job launch a real Electron process without any Xvfb/headless workaround a Linux runner would need.
- Jobs run in parallel (no `needs:`) — a lint failure doesn't block the unit-test job from reporting, so a PR's checks list shows exactly which category broke independently.
- `pretest:e2e` (already in `package.json`, runs `vite build --config vite.config.electron.mjs`) means the `e2e` job's `npm run test:e2e` call builds its own Electron bundle — no separate build step needed in that job.
- `build-check` deliberately does **not** run `npm run electron:build` (the full `electron-builder --win` installer packaging step) — that produces a distributable `.exe` and is minutes slower than needed just to catch compile/bundle breaks. The two `vite build` invocations catch the same class of failure (syntax errors, broken imports, failed transforms) far faster.
- No secrets required — nothing in this workflow talks to an external service.
- `actions/upload-artifact` only runs `if: failure()` so passing runs don't spend storage on traces/screenshots nobody will look at.

### 4. Branch protection (separate final step, applied only after the workflow proves itself on a real PR)

Using `gh api`, set branch protection on `main` requiring status checks `lint`, `unit-test`, `build-check`, `e2e` to pass before merging. This is the step that actually closes Issue #7's complaint ("nothing gates merges") — the workflow file alone only reports status, it doesn't block anything until branch protection requires it.

This step is **not automated as part of the plan's task loop** — GitHub requires a check to have reported at least once on the target branch before it can be marked "required," and it's an admin-level change to repo settings with a real effect on how every future PR merges. The plan's last task pushes the workflow on a real PR, waits for all four jobs to report, and only then applies branch protection — with explicit confirmation before that `gh api` call runs, per this project's standing "confirm before actions that affect shared state" practice.

## Alternatives considered and rejected

**Separate workflow file per job** (`ci-lint.yml`, `ci-unit.yml`, etc.) instead of one file with four jobs: rejected. GitHub Actions already exposes each job as its own named status check within a single workflow file — branch protection can require `lint`, `unit-test`, `build-check`, `e2e` individually either way. Four files means four copies of the same trigger/concurrency boilerplate for zero additional capability.

**Composite action for the shared checkout/setup-node/npm ci steps**: rejected as premature. Four jobs repeating three steps each is 12 lines of duplication total — a composite action adds an indirection layer (a separate file to open to understand what a job actually does) that doesn't pay for itself at this scale. Revisit if a fifth or sixth job is added later.

**`ubuntu-latest` for lint/unit-test/build-check, `windows-latest` only for `e2e`**: considered (this was one of the options presented during design) but not chosen — the human partner picked uniform `windows-latest` for simplicity: one OS to reason about, no risk of a Linux-only build-check false-negative that Windows would have caught (or vice versa), at the cost of somewhat slower/costlier runners than Linux would give the three non-E2E jobs.

**Deferring the vitest `exclude` fix to a separate issue**: rejected. Wiring `npm test` into a gating CI job while it's known to report 3 false failures on every single run would make the CI pipeline useless from day one (either permanently red, or someone marks `unit-test` non-required to work around it — defeating Issue #7's actual goal). The fix is one array in one config file; deferring it serves no one.

## Testing

- **Vitest fix**: run `npx vitest run` locally after the `exclude` change; expect 0 failed files (down from 3), same 403 passed / 1 skipped real test count as before — proving the fix only removed the false positives, not real coverage.
- **ESLint**: run `npm run lint` locally after config + fixes are in; expect exit code 0.
- **Build check commands**: run `npm run build` and `npx vite build --config vite.config.electron.mjs` locally; expect both to exit 0 before trusting the CI job to.
- **E2E**: not practical to fully dry-run locally in this design phase (minutes-long, launches real Electron windows) — validated for real when the workflow runs on its first actual PR, which is the plan's final task before branch protection.
- **The workflow file itself**: no local GitHub Actions emulation (no `act` dependency introduced) — validated by pushing a real branch, opening a real PR, and watching all four jobs report in the Actions tab, which is also the prerequisite GitHub imposes before those checks can be marked required.

## Global constraints

- No new external services or secrets — workflow authenticates with nothing beyond the default `GITHUB_TOKEN` GitHub Actions provides automatically (only needed implicitly by `actions/checkout`, not referenced explicitly).
- No change to `electron:build` (the real installer-producing script) or to `electron-builder` config — CI's `build-check` job only compiles, it never packages a release artifact.
- Branch protection is applied only after explicit confirmation, as its own final step, never bundled silently into an earlier task.
- ESLint config additions must not introduce `eslint-disable` blanket suppressions to force a clean run — every flagged violation gets a real fix or a deliberate, visible rule-level decision in the config.
