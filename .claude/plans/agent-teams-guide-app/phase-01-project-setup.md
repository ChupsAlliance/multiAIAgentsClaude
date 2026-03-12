---
phase: "01"
title: "Project Setup"
status: pending
effort: 30m
created: 2026-03-04
---

# Phase 01 — Project Setup

## Context Links
- Parent plan: [plan.md](plan.md)
- Target: `d:/multiAIAgentsClaude/agent-teams-guide/`

## Overview
| Field | Value |
|-------|-------|
| Date | 2026-03-04 |
| Description | Scaffold Vite+React project, install all deps, configure Tailwind with VS Code color tokens |
| Priority | P2 |
| Status | pending |

## Key Insights
- Static SPA — no backend, no API calls
- Tailwind `darkMode: 'class'` with `<html class="dark">` forces permanent dark mode
- Prism.js languages imported selectively in `main.jsx` to keep bundle size down
- Pin `tailwindcss@^3.4` to avoid v4 breaking changes

## Requirements
- Node.js >= 18 in PATH
- Target dir `agent-teams-guide/` inside `d:/multiAIAgentsClaude/`
- VS Code color tokens defined in Tailwind config
- JetBrains Mono font for monospace text

## Directory Structure
```
agent-teams-guide/
  package.json
  vite.config.js
  tailwind.config.js
  postcss.config.js
  index.html            ← <html class="dark">
  src/
    main.jsx
    App.jsx
    index.css           ← Tailwind directives + Prism theme
```

## Implementation Steps

### 1. Scaffold project
```bash
cd d:/multiAIAgentsClaude
npm create vite@latest agent-teams-guide -- --template react
cd agent-teams-guide
npm install
```

### 2. Install dependencies
```bash
npm install -D tailwindcss@^3.4 postcss autoprefixer
npm install prismjs lucide-react
npx tailwindcss init -p
```

### 3. tailwind.config.js
```js
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'vscode-bg':      '#1e1e1e',
        'vscode-sidebar': '#252526',
        'vscode-border':  '#3e3e42',
        'vscode-text':    '#d4d4d4',
        'vscode-comment': '#6a9955',
        'vscode-keyword': '#569cd6',
        'vscode-string':  '#ce9178',
        'vscode-accent':  '#007acc',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
```

### 4. src/index.css
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap');

html { scroll-behavior: smooth; }
```

### 5. index.html
```html
<!doctype html>
<html lang="vi" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Claude Code — Agent Teams Guide</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

## Todo
- [ ] Run `npm create vite@latest` scaffold
- [ ] Install tailwindcss, prismjs, lucide-react
- [ ] Configure tailwind.config.js with VS Code colors
- [ ] Set up index.css with Tailwind directives
- [ ] Update index.html with `class="dark"` and `lang="vi"`
- [ ] Verify `npm run dev` starts without errors

## Success Criteria
- `npm run dev` runs on localhost:5173
- Dark background (#1e1e1e) visible
- No console errors

## Risk Assessment
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Tailwind v4 breaking changes | Medium | Pin `tailwindcss@^3.4` |
| Prism.js ESM issues with Vite | Low | Import via `prismjs` + individual component paths |
