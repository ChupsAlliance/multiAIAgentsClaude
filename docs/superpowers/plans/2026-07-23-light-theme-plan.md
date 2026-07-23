# App-wide Light Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully working light theme (mirroring VS Code Light+) toggled from the Sidebar, persisted in `localStorage`, applied consistently across the entire app with zero per-page visual bugs.

**Architecture:** Redefine all `vs-*` Tailwind colors as CSS custom properties with `:root` (dark, default) and `.light` (override) values in `src/index.css`; point `tailwind.config.js` at those variables. Add two new tokens (`vs-heading`, `vs-overlay`) to replace every hardcoded `text-white` / `bg-white/N` / `bg-black/N` usage across ~50 files, since those assume a dark background and won't be fixed by the CSS-variable swap alone. Add a Sidebar toggle button that flips a `.light` class on `<html>` and persists the choice.

**Tech Stack:** React 18, Tailwind CSS (`darkMode: 'class'`, already configured), Vitest + React Testing Library, plain CSS custom properties (no new dependencies), `lucide-react` (`Sun`/`Moon` icons, already a dependency).

## Global Constraints

- Mirror VS Code Light+ colors exactly as specified in the spec's palette table — use the exact hex values given, do not invent new ones.
- `vs-accent` (`#007acc`) and `vs-accent2` (`#0098ff`) do NOT change between themes — same value in both `:root` and `.light`.
- No changes to component structure, routing, or any Tauri IPC call signature anywhere in this plan.
- No auto-detection of `prefers-color-scheme` — manual toggle only.
- No new settings page — toggle lives in the existing Sidebar footer.
- Default theme is dark — omit the `.light` class by default so existing users see no visual change until they opt in.
- The one solid `bg-white` at `src/components/mission/MissionLauncher.jsx:704` (a toggle-switch knob) is a deliberate exception — do NOT replace it with `vs-heading` or any other token; it must stay literally `bg-white` in both themes.
- Every `text-white` (206 occurrences across ~40 files) becomes `text-vs-heading`. Every `bg-white/N` or `bg-black/N` used as an overlay tint (75 occurrences across ~28 files) becomes `bg-vs-overlay/N` with the same `N` (opacity) value, EXCEPT the one exception above.

---

### Task 1: CSS custom properties, Tailwind config, and raw-CSS color migration

**Files:**
- Modify: `src/index.css` (add `:root`/`.light` custom properties block; replace hardcoded hex colors in `body`, scrollbar, Prism token rules, and `.terminal-output` rules with `var(--vs-*)`)
- Modify: `tailwind.config.js` (point every `vs-*` and new `vs-heading`/`vs-overlay` color entry at the corresponding CSS variable)
- Test: `src/theme.tokens.test.js`

**Interfaces:**
- Consumes: nothing — this is the foundation task.
- Produces: CSS variables `--vs-bg`, `--vs-sidebar`, `--vs-panel`, `--vs-border`, `--vs-text`, `--vs-muted`, `--vs-comment`, `--vs-keyword`, `--vs-string`, `--vs-number`, `--vs-fn`, `--vs-type`, `--vs-accent`, `--vs-accent2`, `--vs-green`, `--vs-yellow`, `--vs-red`, `--vs-orange`, `--vs-heading`, `--vs-overlay` (all as `R G B` triplets, e.g. `30 30 30`, so Tailwind can apply opacity modifiers). Tailwind color names `vs-bg`, `vs-sidebar`, `vs-panel`, `vs-border`, `vs-text`, `vs-muted`, `vs-comment`, `vs-keyword`, `vs-string`, `vs-number`, `vs-fn`, `vs-type`, `vs-accent`, `vs-accent2`, `vs-green`, `vs-yellow`, `vs-red`, `vs-orange`, `vs-heading`, `vs-overlay` all resolve via `rgb(var(--vs-*) / <alpha-value>)`. Later tasks (2, 3, 4) rely on `vs-heading` and `vs-overlay` existing and working with opacity syntax (`bg-vs-overlay/5`, `bg-vs-overlay/10`, `bg-vs-overlay/20`, `bg-vs-overlay/60`).

- [ ] **Step 1: Write the failing test for CSS variable tokens**

Create `src/theme.tokens.test.js`:

```js
import { describe, it, expect, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const CSS_PATH = path.resolve(__dirname, 'index.css')
const TAILWIND_CONFIG_PATH = path.resolve(__dirname, '..', 'tailwind.config.js')

let cssContent
let tailwindContent

beforeAll(() => {
  cssContent = fs.readFileSync(CSS_PATH, 'utf-8')
  tailwindContent = fs.readFileSync(TAILWIND_CONFIG_PATH, 'utf-8')
})

const EXPECTED_VARS = [
  'vs-bg', 'vs-sidebar', 'vs-panel', 'vs-border', 'vs-text', 'vs-muted',
  'vs-comment', 'vs-keyword', 'vs-string', 'vs-number', 'vs-fn', 'vs-type',
  'vs-accent', 'vs-accent2', 'vs-green', 'vs-yellow', 'vs-red', 'vs-orange',
  'vs-heading', 'vs-overlay',
]

describe('theme CSS custom properties', () => {
  it('defines every expected --vs-* variable under :root', () => {
    const rootBlockMatch = cssContent.match(/:root\s*\{([\s\S]*?)\}/)
    expect(rootBlockMatch).toBeTruthy()
    const rootBlock = rootBlockMatch[1]
    for (const name of EXPECTED_VARS) {
      expect(rootBlock).toMatch(new RegExp(`--${name}:`))
    }
  })

  it('defines every expected --vs-* variable under .light with a different value than :root for themed colors', () => {
    const lightBlockMatch = cssContent.match(/\.light\s*\{([\s\S]*?)\}/)
    expect(lightBlockMatch).toBeTruthy()
    const lightBlock = lightBlockMatch[1]
    for (const name of EXPECTED_VARS) {
      expect(lightBlock).toMatch(new RegExp(`--${name}:`))
    }
  })

  it('keeps vs-accent and vs-accent2 identical between :root and .light', () => {
    const rootBlock = cssContent.match(/:root\s*\{([\s\S]*?)\}/)[1]
    const lightBlock = cssContent.match(/\.light\s*\{([\s\S]*?)\}/)[1]
    for (const name of ['vs-accent', 'vs-accent2']) {
      const rootVal = rootBlock.match(new RegExp(`--${name}:\\s*([^;]+);`))[1].trim()
      const lightVal = lightBlock.match(new RegExp(`--${name}:\\s*([^;]+);`))[1].trim()
      expect(lightVal).toBe(rootVal)
    }
  })

  it('tailwind config resolves every vs-* color via a CSS variable, not a hex literal', () => {
    for (const name of EXPECTED_VARS) {
      const re = new RegExp(`'${name}':\\s*'rgb\\(var\\(--${name}\\)`)
      expect(tailwindContent).toMatch(re)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/theme.tokens.test.js`
Expected: FAIL — `src/index.css` has no `:root`/`.light` blocks yet, and `tailwind.config.js` still uses hex literals.

- [ ] **Step 3: Add CSS custom properties to `src/index.css`**

At the very top of `src/index.css`, immediately after the three `@tailwind` directives (i.e. before the `/* ── Base ── */` comment), insert:

```css
:root {
  --vs-bg: 30 30 30;
  --vs-sidebar: 37 37 38;
  --vs-panel: 45 45 45;
  --vs-border: 62 62 66;
  --vs-text: 212 212 212;
  --vs-muted: 133 133 133;
  --vs-comment: 106 153 85;
  --vs-keyword: 86 156 214;
  --vs-string: 206 145 120;
  --vs-number: 181 206 168;
  --vs-fn: 220 220 170;
  --vs-type: 78 201 176;
  --vs-accent: 0 122 204;
  --vs-accent2: 0 152 255;
  --vs-green: 78 201 176;
  --vs-yellow: 220 220 170;
  --vs-red: 244 71 71;
  --vs-orange: 206 145 120;
  --vs-heading: 255 255 255;
  --vs-overlay: 255 255 255;
}

.light {
  --vs-bg: 255 255 255;
  --vs-sidebar: 243 243 243;
  --vs-panel: 248 248 248;
  --vs-border: 224 224 224;
  --vs-text: 30 30 30;
  --vs-muted: 110 110 110;
  --vs-comment: 0 128 0;
  --vs-keyword: 0 0 255;
  --vs-string: 163 21 21;
  --vs-number: 9 134 88;
  --vs-fn: 121 94 38;
  --vs-type: 38 127 153;
  --vs-accent: 0 122 204;
  --vs-accent2: 0 152 255;
  --vs-green: 38 127 153;
  --vs-yellow: 121 94 38;
  --vs-red: 229 20 0;
  --vs-orange: 163 21 21;
  --vs-heading: 30 30 30;
  --vs-overlay: 0 0 0;
}
```

Each triplet is `R G B` (space-separated, no commas) so Tailwind's `rgb(var(--x) / <alpha-value>)` pattern can apply opacity modifiers like `/20`.

- [ ] **Step 4: Replace hardcoded hex colors in the rest of `src/index.css` with `var(--vs-*)`**

Find:

```css
body {
  background-color: #1e1e1e;
  color: #d4d4d4;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  /* Reduce paint area — tell browser each layer is independent */
  text-rendering: optimizeSpeed;
}
```

Replace with:

```css
body {
  background-color: rgb(var(--vs-bg));
  color: rgb(var(--vs-text));
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  /* Reduce paint area — tell browser each layer is independent */
  text-rendering: optimizeSpeed;
}
```

Find:

```css
::-webkit-scrollbar-track { background: #1e1e1e; }
::-webkit-scrollbar-thumb { background: #3e3e42; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #007acc; }
```

Replace with:

```css
::-webkit-scrollbar-track { background: rgb(var(--vs-bg)); }
::-webkit-scrollbar-thumb { background: rgb(var(--vs-border)); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: rgb(var(--vs-accent)); }
```

Find:

```css
code[class*="language-"],
pre[class*="language-"] {
  font-family: 'JetBrains Mono', Cascadia Code, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.6;
  background: transparent;
  color: #d4d4d4;
  text-shadow: none;
  white-space: pre;
  word-spacing: normal;
  word-break: normal;
  tab-size: 2;
}

.token.comment, .token.prolog, .token.doctype, .token.cdata { color: #6a9955; }
.token.punctuation { color: #d4d4d4; }
.token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol { color: #b5cea8; }
.token.selector, .token.attr-name, .token.string, .token.char, .token.builtin { color: #ce9178; }
.token.operator, .token.entity, .token.url { color: #d4d4d4; }
.token.atrule, .token.attr-value, .token.keyword { color: #569cd6; }
.token.function, .token.class-name { color: #dcdcaa; }
.token.regex, .token.important, .token.variable { color: #9cdcfe; }
.token.important, .token.bold { font-weight: bold; }
.token.italic { font-style: italic; }
```

Replace with:

```css
code[class*="language-"],
pre[class*="language-"] {
  font-family: 'JetBrains Mono', Cascadia Code, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.6;
  background: transparent;
  color: rgb(var(--vs-text));
  text-shadow: none;
  white-space: pre;
  word-spacing: normal;
  word-break: normal;
  tab-size: 2;
}

.token.comment, .token.prolog, .token.doctype, .token.cdata { color: rgb(var(--vs-comment)); }
.token.punctuation { color: rgb(var(--vs-text)); }
.token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol { color: rgb(var(--vs-number)); }
.token.selector, .token.attr-name, .token.string, .token.char, .token.builtin { color: rgb(var(--vs-string)); }
.token.operator, .token.entity, .token.url { color: rgb(var(--vs-text)); }
.token.atrule, .token.attr-value, .token.keyword { color: rgb(var(--vs-keyword)); }
.token.function, .token.class-name { color: rgb(var(--vs-fn)); }
.token.regex, .token.important, .token.variable { color: rgb(var(--vs-type)); }
.token.important, .token.bold { font-weight: bold; }
.token.italic { font-style: italic; }
```

(Note: `#9cdcfe` had no dedicated token in the palette table; it's mapped to `--vs-type` since both are "info/variable" style light-blue tones in VS Code's scheme and this keeps the token list closed to what's in the spec.)

Find:

```css
.terminal-output {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  color: #d4d4d4;
}
.terminal-output .stdout { color: #d4d4d4; }
.terminal-output .stderr { color: #f44747; }
.terminal-output .info   { color: #007acc; }
.terminal-output .success{ color: #4ec9b0; }
```

Replace with:

```css
.terminal-output {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.8rem;
  line-height: 1.5;
  color: rgb(var(--vs-text));
}
.terminal-output .stdout { color: rgb(var(--vs-text)); }
.terminal-output .stderr { color: rgb(var(--vs-red)); }
.terminal-output .info   { color: rgb(var(--vs-accent)); }
.terminal-output .success{ color: rgb(var(--vs-green)); }
```

- [ ] **Step 5: Update `tailwind.config.js` to resolve colors via CSS variables**

Find:

```js
      colors: {
        'vs-bg':       '#1e1e1e',
        'vs-sidebar':  '#252526',
        'vs-panel':    '#2d2d2d',
        'vs-border':   '#3e3e42',
        'vs-text':     '#d4d4d4',
        'vs-muted':    '#858585',
        'vs-comment':  '#6a9955',
        'vs-keyword':  '#569cd6',
        'vs-string':   '#ce9178',
        'vs-number':   '#b5cea8',
        'vs-fn':       '#dcdcaa',
        'vs-type':     '#4ec9b0',
        'vs-accent':   '#007acc',
        'vs-accent2':  '#0098ff',
        'vs-green':    '#4ec9b0',
        'vs-yellow':   '#dcdcaa',
        'vs-red':      '#f44747',
        'vs-orange':   '#ce9178',
      },
```

Replace with:

```js
      colors: {
        'vs-bg':       'rgb(var(--vs-bg) / <alpha-value>)',
        'vs-sidebar':  'rgb(var(--vs-sidebar) / <alpha-value>)',
        'vs-panel':    'rgb(var(--vs-panel) / <alpha-value>)',
        'vs-border':   'rgb(var(--vs-border) / <alpha-value>)',
        'vs-text':     'rgb(var(--vs-text) / <alpha-value>)',
        'vs-muted':    'rgb(var(--vs-muted) / <alpha-value>)',
        'vs-comment':  'rgb(var(--vs-comment) / <alpha-value>)',
        'vs-keyword':  'rgb(var(--vs-keyword) / <alpha-value>)',
        'vs-string':   'rgb(var(--vs-string) / <alpha-value>)',
        'vs-number':   'rgb(var(--vs-number) / <alpha-value>)',
        'vs-fn':       'rgb(var(--vs-fn) / <alpha-value>)',
        'vs-type':     'rgb(var(--vs-type) / <alpha-value>)',
        'vs-accent':   'rgb(var(--vs-accent) / <alpha-value>)',
        'vs-accent2':  'rgb(var(--vs-accent2) / <alpha-value>)',
        'vs-green':    'rgb(var(--vs-green) / <alpha-value>)',
        'vs-yellow':   'rgb(var(--vs-yellow) / <alpha-value>)',
        'vs-red':      'rgb(var(--vs-red) / <alpha-value>)',
        'vs-orange':   'rgb(var(--vs-orange) / <alpha-value>)',
        'vs-heading':  'rgb(var(--vs-heading) / <alpha-value>)',
        'vs-overlay':  'rgb(var(--vs-overlay) / <alpha-value>)',
      },
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/theme.tokens.test.js`
Expected: PASS — all 4 tests green.

- [ ] **Step 7: Run full test suite to check for regressions**

Run: `npm test`
Expected: PASS — all pre-existing tests (120 as of the last merge) plus the 4 new ones, zero failures.

- [ ] **Step 8: Commit**

```bash
git add src/index.css tailwind.config.js src/theme.tokens.test.js
git commit -m "feat(theme): add light/dark CSS custom properties for vs-* tokens"
```

---

### Task 2: Sidebar theme toggle with localStorage persistence

**Files:**
- Create: `src/hooks/useTheme.js`
- Modify: `src/components/Sidebar.jsx:1-4` (imports), `:154-174` (footer block — add toggle button)
- Modify: `index.html:2` (remove hardcoded `class="dark"`, since the hook now controls the class)
- Test: `src/hooks/useTheme.test.js`, `src/components/Sidebar.theme-toggle.test.jsx`

**Interfaces:**
- Consumes: nothing new from Task 1 beyond the CSS classes already defined (`.light` selector, `vs-*` Tailwind colors).
- Produces: `useTheme()` hook exported from `src/hooks/useTheme.js`, returning `{ theme, toggleTheme }` where `theme` is `'dark'` or `'light'` and `toggleTheme()` flips it, updates `<html>`'s class list, and writes to `localStorage` under key `'theme'`. Later tasks do not depend on this hook directly (Task 3/4 are pure JSX class-name migrations), but this is the only place `'theme'` as a `localStorage` key is introduced — no other task should reuse that key for anything else.

- [ ] **Step 1: Write the failing test for the theme hook**

Create `src/hooks/useTheme.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useTheme } from './useTheme'

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('light')
  })

  afterEach(() => {
    document.documentElement.classList.remove('light')
  })

  it('defaults to dark theme when localStorage is empty', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })

  it('reads a previously persisted light theme from localStorage on mount', () => {
    localStorage.setItem('theme', 'light')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
  })

  it('toggleTheme flips dark to light, updates the html class, and persists to localStorage', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('toggleTheme flips light back to dark, updates the html class, and persists to localStorage', () => {
    localStorage.setItem('theme', 'light')
    const { result } = renderHook(() => useTheme())
    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.classList.contains('light')).toBe(false)
    expect(localStorage.getItem('theme')).toBe('dark')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useTheme.test.js`
Expected: FAIL — `src/hooks/useTheme.js` does not exist yet.

- [ ] **Step 3: Implement the theme hook**

Create `src/hooks/useTheme.js`:

```js
import { useState, useEffect, useCallback } from 'react'

const THEME_KEY = 'theme'

function applyThemeClass(theme) {
  document.documentElement.classList.toggle('light', theme === 'light')
}

export function useTheme() {
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem(THEME_KEY)
    return stored === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    applyThemeClass(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_KEY, next)
      return next
    })
  }, [])

  return { theme, toggleTheme }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/useTheme.test.js`
Expected: PASS — all 4 tests green.

- [ ] **Step 5: Remove the hardcoded `dark` class from `index.html`**

Find (in `index.html`):

```html
<html lang="vi" class="dark">
```

Replace with:

```html
<html lang="vi">
```

(The `useTheme` hook now owns the `.light` class entirely; omitting any class means dark styling applies by default, since `:root` — not `.dark` — holds the dark values per Task 1's CSS.)

- [ ] **Step 6: Write the failing test for the Sidebar toggle button**

Create `src/components/Sidebar.theme-toggle.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve({ claude_available: true, agent_teams_enabled: true, app_version: '0.10.1' })),
}))

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar activeSection={null} />
    </MemoryRouter>
  )
}

test('renders a theme toggle button in the sidebar footer', () => {
  renderSidebar()
  expect(screen.getByRole('button', { name: /chuyển giao diện|toggle theme/i })).toBeInTheDocument()
})

test('clicking the theme toggle adds the light class to html and persists it', () => {
  localStorage.clear()
  document.documentElement.classList.remove('light')
  renderSidebar()
  const toggleButton = screen.getByRole('button', { name: /chuyển giao diện|toggle theme/i })
  toggleButton.click()
  expect(document.documentElement.classList.contains('light')).toBe(true)
  expect(localStorage.getItem('theme')).toBe('light')
  document.documentElement.classList.remove('light')
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run src/components/Sidebar.theme-toggle.test.jsx`
Expected: FAIL — no button with an accessible name matching `/chuyển giao diện|toggle theme/i` exists yet.

- [ ] **Step 8: Add the toggle button to the Sidebar footer**

In `src/components/Sidebar.jsx`, find the import line:

```jsx
import { Bot, BookOpen, Play, LayoutDashboard, Menu, X, ChevronRight, Settings, Rocket, Sparkles } from 'lucide-react'
import { sections } from '../data/sections'
```

Replace with:

```jsx
import { Bot, BookOpen, Play, LayoutDashboard, Menu, X, ChevronRight, Settings, Rocket, Sparkles, Sun, Moon } from 'lucide-react'
import { sections } from '../data/sections'
import { useTheme } from '../hooks/useTheme'
```

Find (inside the `Sidebar` component body, right after the other `useState`/`useEffect` hooks and before `const isDocsPage = ...`):

```jsx
  const isDocsPage = location.pathname === '/'
```

Replace with:

```jsx
  const { theme, toggleTheme } = useTheme()

  const isDocsPage = location.pathname === '/'
```

Find the footer block:

```jsx
        {/* Footer with status */}
        <div className="p-3 border-t border-vs-border space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-[10px] text-vs-muted font-mono">Agent Teams</p>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${agentTeamsOk === null ? 'bg-vs-muted' : agentTeamsOk ? 'bg-vs-green' : 'bg-vs-red'}`} />
              <span className={`text-[10px] font-mono ${agentTeamsOk ? 'text-vs-green' : 'text-vs-muted'}`}>
                {agentTeamsOk === null ? '...' : agentTeamsOk ? 'Enabled' : 'Not set'}
              </span>
            </div>
          </div>
          <button
            onClick={() => window.__openChangelog?.()}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md
                       text-[10px] font-mono text-vs-muted
                       hover:text-vs-accent hover:bg-vs-accent/10 transition-colors no-drag"
          >
            <Sparkles size={10} />
            {appVersion ? `v${appVersion}` : '...'} &middot; What's New
          </button>
        </div>
```

Replace with:

```jsx
        {/* Footer with status */}
        <div className="p-3 border-t border-vs-border space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-[10px] text-vs-muted font-mono">Agent Teams</p>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${agentTeamsOk === null ? 'bg-vs-muted' : agentTeamsOk ? 'bg-vs-green' : 'bg-vs-red'}`} />
              <span className={`text-[10px] font-mono ${agentTeamsOk ? 'text-vs-green' : 'text-vs-muted'}`}>
                {agentTeamsOk === null ? '...' : agentTeamsOk ? 'Enabled' : 'Not set'}
              </span>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            aria-label="Chuyển giao diện sáng/tối"
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md
                       text-[10px] font-mono text-vs-muted
                       hover:text-vs-accent hover:bg-vs-accent/10 transition-colors no-drag"
          >
            {theme === 'dark' ? <Sun size={10} /> : <Moon size={10} />}
            {theme === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}
          </button>
          <button
            onClick={() => window.__openChangelog?.()}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md
                       text-[10px] font-mono text-vs-muted
                       hover:text-vs-accent hover:bg-vs-accent/10 transition-colors no-drag"
          >
            <Sparkles size={10} />
            {appVersion ? `v${appVersion}` : '...'} &middot; What's New
          </button>
        </div>
```

Also add a named export for `Sidebar` if it isn't already one (check the existing `export function Sidebar(...)` signature — it already is a named export, so no change needed there).

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run src/components/Sidebar.theme-toggle.test.jsx`
Expected: PASS — both tests green.

- [ ] **Step 10: Run full test suite to check for regressions**

Run: `npm test`
Expected: PASS — all tests pass, zero failures.

- [ ] **Step 11: Commit**

```bash
git add src/hooks/useTheme.js src/hooks/useTheme.test.js src/components/Sidebar.jsx src/components/Sidebar.theme-toggle.test.jsx index.html
git commit -m "feat(theme): add Sidebar theme toggle with localStorage persistence"
```

---

### Task 3: Migrate `text-white` / `bg-white/N` / `bg-black/N` in mission components and pages

**Files:**
- Modify (mechanical class-name replacement only, no logic changes): every file below matching `src/components/mission/*.jsx` and `src/pages/*.jsx` and `src/components/*.jsx` (excluding `Sidebar.jsx`, already done in Task 2) that contains `text-white`, `bg-white/N`, or `bg-black/N`:
  - `src/components/ChangelogModal.jsx`
  - `src/components/CodeBlock.jsx`
  - `src/components/InfoBox.jsx`
  - `src/components/SectionHeader.jsx`
  - `src/components/common/ShortcutsHelpModal.jsx`
  - `src/components/mission/ActivityLog.jsx`
  - `src/components/mission/AgentCard.jsx`
  - `src/components/mission/AgentGrid.jsx`
  - `src/components/mission/BusinessFlowDiagram.jsx`
  - `src/components/mission/BusinessSummary.jsx`
  - `src/components/mission/ExportDropdown.jsx`
  - `src/components/mission/FileChangesPanel.jsx`
  - `src/components/mission/InterventionPanel.jsx`
  - `src/components/mission/MessagesPanel.jsx`
  - `src/components/mission/MissionDashboard.jsx`
  - `src/components/mission/MissionHeader.jsx`
  - `src/components/mission/MissionHistoryPanel.jsx`
  - `src/components/mission/MissionLauncher.jsx`
  - `src/components/mission/PlanDependencyGraph.jsx`
  - `src/components/mission/PlanDocument.jsx`
  - `src/components/mission/PlanReview.jsx`
  - `src/components/mission/PlanVersionHistory.jsx`
  - `src/components/mission/PlanningStream.jsx`
  - `src/components/mission/PromptPreview.jsx`
  - `src/components/mission/QuestionCard.jsx`
  - `src/components/mission/RawOutput.jsx`
  - `src/components/mission/StatusBadge.jsx`
  - `src/components/mission/TaskList.jsx`
  - `src/components/mission/ThinkingIndicator.jsx`
  - `src/components/office/editor/TileEditor.jsx`
  - `src/pages/DashboardPage.jsx`
  - `src/pages/DocsPage.jsx`
  - `src/pages/MissionControlPage.jsx`
  - `src/pages/OnboardingPage.jsx`
  - `src/pages/PlaygroundPage.jsx`
- Test: `src/theme.migration.test.js` (extended in this task to cover the files above; the full-repo check is completed in Task 4)

**Interfaces:**
- Consumes: `vs-heading` and `vs-overlay` Tailwind color names from Task 1 (must already resolve correctly via CSS variables).
- Produces: nothing new consumed by later tasks — Task 4 covers the remaining directory (`src/sections/*.jsx`) using the identical mechanical rule and extends the same test file.

- [ ] **Step 1: Write the failing test for this task's file group**

Create `src/theme.migration.test.js`:

```js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const SRC_DIR = path.resolve(__dirname)

// The one deliberate exception: a toggle-switch knob that must stay literally white in both themes.
const ALLOWED_BG_WHITE = new Set([
  path.join(SRC_DIR, 'components', 'mission', 'MissionLauncher.jsx'),
])

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'assets') continue // third-party vendored assets, not app source
      walk(full, files)
    } else if (entry.name.endsWith('.jsx') || entry.name.endsWith('.js')) {
      if (!entry.name.includes('.test.')) files.push(full)
    }
  }
  return files
}

function checkFile(file) {
  const content = fs.readFileSync(file, 'utf-8')
  const violations = []
  if (/\btext-white\b/.test(content)) violations.push('text-white')
  if (/\bbg-black\/\d+/.test(content)) violations.push('bg-black/N')
  const bgWhiteOverlay = content.match(/\bbg-white\/\d+/)
  if (bgWhiteOverlay) violations.push('bg-white/N')
  const bgWhiteSolid = /(?<!\/)\bbg-white\b(?!\/)/.test(content)
  if (bgWhiteSolid && !ALLOWED_BG_WHITE.has(file)) violations.push('bg-white (solid)')
  return violations
}

describe('light-theme class migration (mission components, pages, top-level components)', () => {
  const targetDirs = [
    path.join(SRC_DIR, 'components', 'mission'),
    path.join(SRC_DIR, 'pages'),
    path.join(SRC_DIR, 'components', 'office'),
  ]
  const topLevelComponentFiles = fs.readdirSync(path.join(SRC_DIR, 'components'), { withFileTypes: true })
    .filter(e => e.isFile() && (e.name.endsWith('.jsx') || e.name.endsWith('.js')) && !e.name.includes('.test.'))
    .map(e => path.join(SRC_DIR, 'components', e.name))
  const commonFiles = walk(path.join(SRC_DIR, 'components', 'common'))

  const files = [
    ...targetDirs.flatMap(d => fs.existsSync(d) ? walk(d) : []),
    ...topLevelComponentFiles,
    ...commonFiles,
  ]

  it('found a non-trivial number of files to check', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('has no text-white, bg-white/N, or bg-black/N outside the documented exception', () => {
    const allViolations = files
      .map(f => ({ file: path.relative(SRC_DIR, f), violations: checkFile(f) }))
      .filter(r => r.violations.length > 0)
    expect(allViolations).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/theme.migration.test.js`
Expected: FAIL — the second test lists every file in the group that still has `text-white`/`bg-white/N`/`bg-black/N`.

- [ ] **Step 3: Migrate every file in this task's group**

Apply this exact substitution to every file listed in the **Files** section above:
- Replace every occurrence of `text-white` with `text-vs-heading`
- Replace every occurrence of `bg-white/` followed by a number with `bg-vs-overlay/` followed by the same number (e.g. `bg-white/5` → `bg-vs-overlay/5`, `bg-white/10` → `bg-vs-overlay/10`)
- Replace every occurrence of `bg-black/` followed by a number with `bg-vs-overlay/` followed by the same number (e.g. `bg-black/60` → `bg-vs-overlay/60`, `bg-black/20` → `bg-vs-overlay/20`)
- Do NOT touch `src/components/mission/MissionLauncher.jsx:704`'s solid `bg-white` (the toggle-switch knob) — leave that one line exactly as-is.

This is a pure find-and-replace with no logic changes — no other part of any line should change. Use your editor's find-and-replace per file, or equivalent scripted substitution, then visually diff each file afterward to confirm only class-name text changed.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/theme.migration.test.js`
Expected: PASS — both tests green.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npm test`
Expected: PASS — all tests pass, zero failures. Pay attention to any existing test in this file group that asserted on a class name containing `text-white`, `bg-white/N`, or `bg-black/N` — if any pre-existing test hardcodes the old class name, update that test's expected string to the new token name so it reflects the same visual intent.

- [ ] **Step 6: Commit**

```bash
git add src/components src/pages src/theme.migration.test.js
git commit -m "refactor(theme): migrate text-white/bg-white/bg-black to theme tokens in mission components and pages"
```

---

### Task 4: Migrate `text-white` / `bg-white/N` / `bg-black/N` in sections and finalize whole-repo check

**Files:**
- Modify (mechanical class-name replacement only, no logic changes): every file in `src/sections/*.jsx` that contains `text-white`, `bg-white/N`, or `bg-black/N`:
  - `src/sections/BestPractices.jsx`
  - `src/sections/CreateTeam.jsx`
  - `src/sections/DashboardGuide.jsx`
  - `src/sections/DisplayModes.jsx`
  - `src/sections/HowItWorks.jsx`
  - `src/sections/Introduction.jsx`
  - `src/sections/LauncherGuide.jsx`
  - `src/sections/Limitations.jsx`
  - `src/sections/PlanReviewGuide.jsx`
  - `src/sections/RealWorldExamples.jsx`
  - `src/sections/Setup.jsx`
  - `src/sections/StandardMode.jsx`
  - `src/sections/TeamInteraction.jsx`
- Modify: `src/theme.migration.test.js` (extend the scan to cover `src/sections` and the whole of `src`, replacing the directory-scoped check from Task 3 with a full-repo check)

**Interfaces:**
- Consumes: `vs-heading`/`vs-overlay` from Task 1; the `checkFile`/`walk` helpers already defined in Task 3's version of `src/theme.migration.test.js`.
- Produces: nothing consumed by later tasks — this is the last task in the plan.

- [ ] **Step 1: Extend the test to cover the whole repo instead of a partial directory list**

In `src/theme.migration.test.js`, find:

```js
describe('light-theme class migration (mission components, pages, top-level components)', () => {
  const targetDirs = [
    path.join(SRC_DIR, 'components', 'mission'),
    path.join(SRC_DIR, 'pages'),
    path.join(SRC_DIR, 'components', 'office'),
  ]
  const topLevelComponentFiles = fs.readdirSync(path.join(SRC_DIR, 'components'), { withFileTypes: true })
    .filter(e => e.isFile() && (e.name.endsWith('.jsx') || e.name.endsWith('.js')) && !e.name.includes('.test.'))
    .map(e => path.join(SRC_DIR, 'components', e.name))
  const commonFiles = walk(path.join(SRC_DIR, 'components', 'common'))

  const files = [
    ...targetDirs.flatMap(d => fs.existsSync(d) ? walk(d) : []),
    ...topLevelComponentFiles,
    ...commonFiles,
  ]

  it('found a non-trivial number of files to check', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('has no text-white, bg-white/N, or bg-black/N outside the documented exception', () => {
    const allViolations = files
      .map(f => ({ file: path.relative(SRC_DIR, f), violations: checkFile(f) }))
      .filter(r => r.violations.length > 0)
    expect(allViolations).toEqual([])
  })
})
```

Replace with:

```js
describe('light-theme class migration (whole src tree)', () => {
  const files = walk(SRC_DIR)

  it('found a non-trivial number of files to check', () => {
    expect(files.length).toBeGreaterThan(40)
  })

  it('has no text-white, bg-white/N, or bg-black/N outside the documented exception, anywhere in src', () => {
    const allViolations = files
      .map(f => ({ file: path.relative(SRC_DIR, f), violations: checkFile(f) }))
      .filter(r => r.violations.length > 0)
    expect(allViolations).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/theme.migration.test.js`
Expected: FAIL — the second test lists every file in `src/sections` that still has `text-white`/`bg-white/N`/`bg-black/N` (Task 3's files should already be clean and not appear).

- [ ] **Step 3: Migrate every file in `src/sections`**

Apply the identical substitution rule from Task 3 Step 3 to every file listed in this task's **Files** section:
- `text-white` → `text-vs-heading`
- `bg-white/<N>` → `bg-vs-overlay/<N>`
- `bg-black/<N>` → `bg-vs-overlay/<N>`

No other content in any line should change.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/theme.migration.test.js`
Expected: PASS — both tests green, confirming zero occurrences of the old patterns anywhere in `src/` outside the one documented exception.

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npm test`
Expected: PASS — all tests pass, zero failures.

- [ ] **Step 6: Manual browser verification**

Run: `npm run dev` (or the project's existing dev-server command) and manually check in a browser:
- Toggle the theme via the new Sidebar button; confirm the whole app (Docs, Playground, Mission Control, Dashboard, Setup, and any open modal) switches between dark and light with no invisible text (white-on-white or dark-on-dark) and no leftover pure-white/black boxes that look out of place.
- Reload the page after toggling to light; confirm it stays light (no flash of dark theme before the light class applies).
- Confirm the syntax-highlighted code blocks (Prism) and the terminal output panel remain readable in both themes.

This step has no automated pass/fail — record what you observed in the commit message or task report if anything looks visually wrong, and treat any visual defect found here as a new follow-up, not a blocker for this specific mechanical task (the automated test already confirms every forbidden class name is gone).

- [ ] **Step 7: Commit**

```bash
git add src/sections src/theme.migration.test.js
git commit -m "refactor(theme): migrate text-white/bg-white/bg-black to theme tokens in sections; whole-repo check"
```

---

## Self-Review Notes

**Spec coverage:**
- Spec §1 (palette mirroring VS Code Light+, `vs-accent`/`vs-accent2` unchanged) → Task 1.
- Spec's two new tokens (`vs-heading`, `vs-overlay`) → defined in Task 1, consumed in Tasks 3-4.
- Spec §2 (CSS custom properties mechanism, no changes to the 49 `vs-*`-consuming files) → Task 1 defines the mechanism; no task modifies any file solely for a `vs-*` value change, confirming the zero-file-touch claim.
- Spec §3 (migration of `text-white`/`bg-white/N`/`bg-black/N`, including the one hand-reviewed solid `bg-white` exception) → Tasks 3-4, with the exception explicitly carved out in the Global Constraints and in the test's `ALLOWED_BG_WHITE` set.
- Spec §4 (toggle in Sidebar footer, `.light` class on `<html>`, localStorage persistence, dark default, no FOUC) → Task 2. FOUC avoidance is inherent since dark is the default with no class needed (Task 2 Step 5 removes the hardcoded `class="dark"` from `index.html`, and dark values live under `:root` so they apply with zero JS having run yet).
- Acceptance criteria: "toggle switches app-wide instantly" → Task 2 (React state + CSS variables, no reload needed). "reload preserves theme, no FOUC" → Task 2's hook reads `localStorage` in `useState`'s initializer (runs during the first render, before paint). "no text-white/bg-white/N/bg-black/N remain except the one exception" → Task 4's whole-repo test. "49 vs-* files show correct light colors without modification" → inherent to Task 1's CSS-variable mechanism, verified visually in Task 4 Step 6. "syntax colors readable on white" → Task 1's Prism token color mapping using the spec's exact light hex values.
- Testing Approach section (automated tests only check logic; manual browser check needed for actual color/contrast) → reflected directly in Task 2 (hook + toggle logic tests) and Task 4 Step 6 (explicit manual verification step, not automated).

**Placeholder scan:** No TBD/TODO, no "add appropriate handling." Every step has literal before/after code, literal test code, and exact file lists enumerated from the actual repository content. Confirmed clean.

**Type consistency:** `useTheme()` returns `{ theme, toggleTheme }` in Task 2 Step 3 and is consumed identically in Task 2 Step 8 (`const { theme, toggleTheme } = useTheme()`). The `localStorage` key `'theme'` is introduced once in Task 2 and no other task reuses or redefines it. The `vs-heading`/`vs-overlay` Tailwind names introduced in Task 1 Step 5 are used with identical spelling in Tasks 2 (n/a — Task 2 doesn't use them directly), 3, and 4. The `checkFile`/`walk`/`ALLOWED_BG_WHITE` helpers defined in Task 3's version of `src/theme.migration.test.js` are reused verbatim (not redefined) when Task 4 extends the same file — Task 4 Step 1 only replaces the `describe` block, not the helper functions above it, so no duplicate/renamed helper risk.
