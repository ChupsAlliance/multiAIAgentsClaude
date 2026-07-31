# Copilot Instructions — Claude Agent Teams

## What This Project Is

A Windows desktop app (Electron + React) that orchestrates multiple Claude Code AI agents working in parallel on a single project. Users describe a requirement → AI generates a plan → user reviews/edits → multiple Claude CLI subprocesses execute in parallel.

**The UI code is 100% shared between Tauri (dev) and Electron (prod)** via a shim layer at `src/lib/tauri-shim/` that translates `@tauri-apps/api` calls to `window.electronAPI` IPC.

---

## Commands

```bash
# Development
npm run electron:dev        # Build + launch Electron app (hot build, no HMR)
npm run dev                 # Vite dev server only (Tauri mode, no backend)

# Production build
npm run electron:build      # Build + package .exe installer → release/

# Quick patch update
node scripts/build-patch.cjs   # Creates release/Claude-Agent-Teams-Patch-x.x.x.zip

# Tests
npm test                    # Vitest unit tests (jsdom)
npm run test:watch          # Vitest watch mode
npx vitest run src/hooks/useMission.test.jsx   # Run a single test file
npm run test:e2e            # Playwright E2E (requires build first)
```

---

## Architecture

### IPC Flow

```
React component
  → import { invoke } from '@tauri-apps/api/core'
  → (Electron: Vite alias redirects to src/lib/tauri-shim/core.js)
  → window.electronAPI.invoke(cmd, args)
  → electron/preload.cjs (contextBridge whitelist)
  → ipcMain.handle(cmd) in electron/ipc/*.cjs
  → calls Node.js / spawns claude CLI subprocess
```

- `electron/ipc/system.cjs` — CLI check, settings, terminal launcher
- `electron/ipc/files.cjs` — file picker, reader, search, scaffold
- `electron/ipc/history.cjs` — save/load/delete mission history
- `electron/ipc/mission.cjs` — **core**: launch, deploy, continue, stop, retry

### Mission Lifecycle (Phases)

```
Launch → Planning (claude -p streams plan JSON)
       → ReviewPlan (user edits agents/tasks)
       → PromptPreview (optional per-agent prompt editing)
       → Deploying (multiple claude -p subprocesses)
       → Running → [Intervention] → Continuing
                → Done / Stopped / Error
```

### State Management

- **`useMission()`** hook owns all mission state in the frontend.
- High-frequency events (`mission:log`, `mission:file-change`, `mission:raw-line`) are **buffered and flushed every 120ms** to prevent excessive re-renders.
- Low-frequency events (`mission:status`, `mission:agent-spawned`, `mission:plan-ready`) are applied immediately.
- **Singleton:** only one `missionState` object exists per app instance. `launch_mission` rejects if a subprocess is already running.

### MissionState Shape (key fields)

```typescript
{
  id: string              // "mission-{timestamp}"
  status: Status          // 'Planning' | 'ReviewPlan' | 'Deploying' | 'Running' | 'Done' | 'Stopped' | 'Error'
  phase: Phase
  execution_mode: 'standard' | 'agent_teams'
  agents: Agent[]         // grows across intervention cycles, never shrinks
  tasks: Task[]
  log: LogEntry[]         // capped at 2000 entries in memory
  file_changes: FileChange[]
  messages: Message[]     // inter-agent messages (agent_teams mode only)
  forked_from: string | null  // parent mission ID when continuing from history
}
```

### History / Persistence

- History index: `~/.claude/agent-teams-history.json` (max 50 entries)
- Snapshots: `~/.claude/agent-teams-snapshots/{missionId}.json`
- "Continue from history" creates a **new mission** forked from the snapshot, linked via `forked_from`.

---

## Key Conventions

### Dual Build Mode — Never Use Tauri APIs Directly in Non-Shim Code

All frontend code imports from `@tauri-apps/api/*`. In Electron builds, `vite.config.electron.mjs` aliases these imports to `src/lib/tauri-shim/`. Never call `window.electronAPI` directly from components — always use the Tauri API imports.

### IPC Command/Event Whitelists

`electron/preload.cjs` maintains explicit whitelists of allowed IPC commands (30) and event channels (14). Any new IPC command or event **must be added to the whitelist** in `preload.cjs` or it will be silently rejected.

### Toast Notifications

Use `const { toast } = useToast()` in any component. Do **not** use `alert()` or `console.error()` for user-facing errors. All IPC errors in `useMission` show `toast.error(...)`.

### Test File Co-location

Test files live next to the code they test:
- `src/pages/PlaygroundPage.launch-validation.test.jsx` (alongside `PlaygroundPage.jsx`)
- `src/hooks/useMission.test.jsx` (alongside `useMission.js`)
- `electron/ipc/mission.test.cjs` (alongside `mission.cjs`)

Vitest config uses `jsdom` environment with globals. Electron IPC tests use `.cjs` extension.

### Prompt Templates

Prompt markdown files live in `electron/prompts/`. Template variables use `{{VARIABLE_NAME}}` syntax (double curly braces). The planning prompt is loaded via `read_planning_template` IPC at runtime so it can be updated without rebuilding.

### Router

Uses `HashRouter` (not `BrowserRouter`) — required for `file://` protocol in Electron. All navigation must be `#`-based.

### Styling

Tailwind CSS with dark theme defaults. Background base is `bg-[#0a0a0a]`. Use Tailwind utility classes; avoid inline styles. Component color tokens are defined in `tailwind.config.js`.

### Sections / Docs

`src/sections/` contains 13 pure display components for the DocsPage. Section metadata (IDs, titles, icons) lives in `src/data/sections.js`. Sections have both Vietnamese (`titleVi`) and English (`titleEn`) titles.

### Agent Teams Mode

Requires `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env var (set via `enable_agent_teams` IPC which writes to `~/.claude/settings.json`). Standard mode runs a single claude subprocess; Agent Teams mode spawns one per agent with a file watcher (`startFileWatcher`) for cross-agent file change detection.

---

## Important Files

| File | Purpose |
|------|---------|
| `electron/ipc/mission.cjs` | Core mission orchestration — spawn/parse/events |
| `src/hooks/useMission.js` | Frontend mission state + event batching |
| `src/lib/tauri-shim/core.js` | Bridges `invoke()` to Electron IPC |
| `electron/preload.cjs` | IPC security whitelist |
| `electron/prompts/planning.md` | Phase 1 planning prompt template |
| `src/data/promptWrapper.js` | Builds the planning prompt from user input |
| `src/pages/MissionControlPage.jsx` | View-flow orchestration for mission UI |
| `vite.config.electron.mjs` | Electron-mode aliases (tauri-shim activation) |
