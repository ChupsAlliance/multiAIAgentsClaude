# Architecture Documentation — Claude Agent Teams Guide

> **Last updated:** 2026-03-14
> **Version:** 0.1.0
> **Codebase:** `d:\multiAIAgentsClaude\agent-teams-guide`

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Project Structure](#2-project-structure)
3. [Build Modes (Tauri vs Electron)](#3-build-modes)
4. [Frontend Architecture](#4-frontend-architecture)
   - 4.1 [Entry Points](#41-entry-points)
   - 4.2 [Pages (5)](#42-pages)
   - 4.3 [Components — Layout (4)](#43-components--layout)
   - 4.4 [Components — Mission (11)](#44-components--mission)
   - 4.5 [Sections — Docs (13)](#45-sections--docs)
   - 4.6 [Hooks (2)](#46-hooks)
   - 4.7 [Data Files (3)](#47-data-files)
   - 4.8 [Tauri Shim Layer (4)](#48-tauri-shim-layer)
5. [Backend Architecture (Electron)](#5-backend-architecture)
   - 5.1 [Main Process](#51-main-process)
   - 5.2 [Preload & Security](#52-preload--security)
   - 5.3 [IPC Handlers — System (7)](#53-ipc-handlers--system)
   - 5.4 [IPC Handlers — Files (8)](#54-ipc-handlers--files)
   - 5.5 [IPC Handlers — History (5)](#55-ipc-handlers--history)
   - 5.6 [IPC Handlers — Mission (8)](#56-ipc-handlers--mission)
6. [Mission Core (mission.cjs)](#6-mission-core)
   - 6.1 [Module-Level State](#61-module-level-state)
   - 6.2 [MissionState Data Structure](#62-missionstate-data-structure)
   - 6.3 [Helper Functions (20+)](#63-helper-functions)
   - 6.4 [Stream-JSON Parsing](#64-stream-json-parsing)
   - 6.5 [Process Lifecycle](#65-process-lifecycle)
   - 6.6 [File Watcher (Agent Teams)](#66-file-watcher)
7. [Mission Lifecycle](#7-mission-lifecycle)
   - 7.1 [Phases & Statuses](#71-phases--statuses)
   - 7.2 [Phase Transitions](#72-phase-transitions)
   - 7.3 [Intervention Cycles](#73-intervention-cycles)
   - 7.4 [State Persistence](#74-state-persistence)
8. [Event System](#8-event-system)
9. [Prompt Templates (5)](#9-prompt-templates)
10. [Data Persistence](#10-data-persistence)
11. [Performance Optimizations](#11-performance-optimizations)
12. [Dependencies](#12-dependencies)

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER (Browser/Desktop)                  │
│                                                                 │
│   React App (Vite)                                              │
│   ├── Pages: Docs, Playground, MissionControl, Dashboard, Setup │
│   ├── Hooks: useMission (state + events), useTauriFileDrop      │
│   └── Components: 15 mission components, 4 layout, 13 sections │
│                                                                 │
│   invoke() / listen()                                           │
│       │           ▲                                             │
│       │  ┌────────┘                                             │
│       ▼  │                                                      │
│   ┌──────┴──────┐                                               │
│   │   IPC Layer │  (Tauri: @tauri-apps/api → Rust lib.rs)       │
│   │             │  (Electron: shim → preload → ipcMain)         │
│   └──────┬──────┘                                               │
│          │                                                      │
│   ┌──────▼──────┐                                               │
│   │  Backend    │                                               │
│   │  ├ system   │ ← Claude CLI check, settings, launcher       │
│   │  ├ files    │ ← File picker, reader, search, scaffold      │
│   │  ├ history  │ ← Save/load/delete mission history           │
│   │  └ mission  │ ← Core: launch, deploy, continue, stop      │
│   └──────┬──────┘                                               │
│          │                                                      │
│   ┌──────▼──────┐                                               │
│   │  claude -p  │ ← Subprocess: stream-json output             │
│   │  (CLI)      │   --dangerously-skip-permissions              │
│   └─────────────┘   --output-format stream-json --verbose       │
└─────────────────────────────────────────────────────────────────┘
```

**Purpose:** Desktop GUI that orchestrates Claude Code AI Agent Teams. Users describe what they want built, the app generates a plan with specialized agents, and manages execution via Claude CLI subprocess.

**Key design decisions:**
- **Dual-mode build:** Tauri (WebView2) for dev, Electron for production (WebView2 has rendering lag in production builds on Windows)
- **Frontend code shared 100%:** Tauri shim layer redirects `@tauri-apps/api` imports to Electron IPC
- **Singleton state:** One `missionState` object per app instance (no concurrent missions)
- **Stream parsing:** Real-time parsing of `claude -p --output-format stream-json` stdout
- **Event-driven UI:** Backend pushes events → frontend batches and renders

---

## 2. Project Structure

```
agent-teams-guide/
├── package.json                    # Scripts, deps, electron-builder config
├── vite.config.js                  # Tauri mode Vite config
├── vite.config.electron.mjs        # Electron mode Vite config (aliases shims)
├── tailwind.config.js              # Tailwind CSS config
├── index.html                      # Root HTML
│
├── src/                            # ═══ FRONTEND (shared between Tauri & Electron)
│   ├── main.jsx                    # React entry point
│   ├── App.jsx                     # Root component + router
│   ├── index.css                   # Tailwind base + custom styles
│   │
│   ├── pages/                      # Route-level components (5)
│   │   ├── DocsPage.jsx            #   / — Documentation browser
│   │   ├── PlaygroundPage.jsx      #   /playground — Template launcher
│   │   ├── MissionControlPage.jsx  #   /mission — Mission execution
│   │   ├── DashboardPage.jsx       #   /dashboard — System status
│   │   └── OnboardingPage.jsx      #   /setup — First-run wizard
│   │
│   ├── components/                 # Reusable components
│   │   ├── Sidebar.jsx             #   Navigation sidebar
│   │   ├── CodeBlock.jsx           #   Syntax-highlighted code
│   │   ├── InfoBox.jsx             #   Tip/warning/info boxes
│   │   ├── SectionHeader.jsx       #   Section title with number
│   │   └── mission/                #   Mission-specific (11)
│   │       ├── MissionLauncher.jsx     # New mission form
│   │       ├── MissionDashboard.jsx    # Main monitoring view
│   │       ├── MissionHeader.jsx       # Title + status bar
│   │       ├── MissionHistoryPanel.jsx # History list
│   │       ├── PlanReview.jsx          # Plan editing UI
│   │       ├── PromptPreview.jsx       # Per-agent prompt editor
│   │       ├── AgentGrid.jsx           # Agent cards grid
│   │       ├── AgentCard.jsx           # Individual agent card
│   │       ├── TaskList.jsx            # Task progress list
│   │       ├── ActivityLog.jsx         # Scrolling log viewer
│   │       ├── FileChangesPanel.jsx    # File diff viewer
│   │       ├── MessagesPanel.jsx       # Inter-agent messages
│   │       ├── InterventionPanel.jsx   # User intervention input
│   │       ├── RawOutput.jsx           # Raw stdout viewer
│   │       └── ThinkingIndicator.jsx   # Loading/planning animation
│   │
│   ├── sections/                   # Docs page sections (13)
│   │   ├── Introduction.jsx
│   │   ├── StandardMode.jsx
│   │   ├── LauncherGuide.jsx
│   │   ├── PlanReviewGuide.jsx
│   │   ├── DashboardGuide.jsx
│   │   ├── Setup.jsx
│   │   ├── CreateTeam.jsx
│   │   ├── TeamInteraction.jsx
│   │   ├── DisplayModes.jsx
│   │   ├── BestPractices.jsx
│   │   ├── RealWorldExamples.jsx
│   │   ├── HowItWorks.jsx
│   │   └── Limitations.jsx
│   │
│   ├── hooks/                      # React hooks (2)
│   │   ├── useMission.js           # Core mission state management
│   │   └── useTauriFileDrop.js     # Drag-drop file handling
│   │
│   ├── data/                       # Static data & utilities (3)
│   │   ├── sections.js             # Section definitions for DocsPage
│   │   ├── templates.js            # 8 prompt templates for Playground
│   │   └── promptWrapper.js        # Prompt builder for Mission Control
│   │
│   └── lib/tauri-shim/             # Electron compatibility shims (4)
│       ├── core.js                 # invoke() → electronAPI.invoke()
│       ├── event.js                # listen() → electronAPI.on()
│       ├── webview.js              # getCurrentWebview() noop
│       └── plugin-opener.js        # openUrl() → invoke('open_url')
│
├── electron/                       # ═══ BACKEND (Electron mode only)
│   ├── main.cjs                    # Window creation + IPC registration
│   ├── preload.cjs                 # contextBridge (security layer)
│   ├── ipc/                        # IPC handler modules (4)
│   │   ├── system.cjs              # 7 handlers: CLI check, settings, launcher
│   │   ├── files.cjs               # 8 handlers: file ops, search, scaffold
│   │   ├── history.cjs             # 5 handlers: save/load/delete history
│   │   └── mission.cjs             # 8 handlers: launch/deploy/continue/stop (CORE)
│   └── prompts/                    # Prompt templates (5)
│       ├── planning.md             # Phase 1: plan generation
│       ├── deploy_standard.md      # Phase 3: standard execution
│       ├── deploy_agent_teams.md   # Phase 3: agent teams execution
│       ├── continue_mission.md     # Intervention continuation
│       └── replan.md               # Re-plan existing plan
│
├── src-tauri/                      # ═══ BACKEND (Tauri mode only)
│   ├── src/lib.rs                  # Rust IPC handlers (mirrors electron/ipc/)
│   ├── tauri.conf.json             # Window config
│   ├── Cargo.toml                  # Rust dependencies
│   └── prompts/                    # Same prompts as electron/prompts/
│
├── dist/                           # Tauri build output
├── dist-electron/                  # Electron build output
└── release/                        # electron-builder output (.exe)
```

---

## 3. Build Modes

### 3.1 Tauri Mode (Development)

```bash
npm run tauri dev
```

- Uses `vite.config.js` → serves on port 1420
- Frontend imports `@tauri-apps/api` directly → talks to Rust `lib.rs`
- Outputs to `dist/`
- Hot reload via Vite HMR

### 3.2 Electron Mode (Production)

```bash
npm run electron:dev     # Dev: build + launch
npm run electron:build   # Production: build + package .exe
```

- Uses `vite.config.electron.mjs` → aliases `@tauri-apps/api` to `src/lib/tauri-shim/`
- Frontend calls `window.electronAPI.invoke()` → `ipcMain.handle()` → Node.js handlers
- Outputs to `dist-electron/`
- Packaged via `electron-builder` → `release/Claude Agent Teams Setup 0.1.0.exe`

### 3.3 Shim Architecture

```
[Tauri mode]
  src/component.jsx → import { invoke } from '@tauri-apps/api/core'
                       → Tauri native invoke → Rust lib.rs

[Electron mode]
  src/component.jsx → import { invoke } from '@tauri-apps/api/core'
                       → (vite alias) → src/lib/tauri-shim/core.js
                       → window.electronAPI.invoke(cmd, args)
                       → preload.cjs contextBridge
                       → ipcRenderer.invoke(cmd, args)
                       → ipcMain.handle(cmd) in electron/ipc/*.cjs
```

**Result:** Zero frontend code changes between modes. Same `invoke()` and `listen()` API.

---

## 4. Frontend Architecture

### 4.1 Entry Points

**`index.html`**
- Dark theme (`bg-[#0a0a0a]`), robot favicon
- Mounts React to `<div id="root">`

**`src/main.jsx`**
- `StrictMode` + `HashRouter` (required for `file://` protocol in Electron)
- Loads Prism.js themes for syntax highlighting (bash, json, js, jsx, ts, yaml, toml)

**`src/App.jsx`**
- Root component with route definitions
- State: `step` (setup completion), `checked` (setup verified)
- On mount: calls `check_claude_available()` + `get_system_info()`
- Redirects to `/setup` if not configured
- All pages lazy-loaded via `React.lazy()` for code splitting

**Routes:**
| Path | Component | Purpose |
|------|-----------|---------|
| `/` | `DocsPage` | Documentation browser |
| `/playground` | `PlaygroundPage` | Template-based launcher |
| `/mission` | `MissionControlPage` | Mission execution & monitoring |
| `/dashboard` | `DashboardPage` | System status & setup |
| `/setup` | `OnboardingPage` | First-run wizard |

---

### 4.2 Pages

#### `DocsPage.jsx` — Documentation Browser (`/`)

| Property | Value |
|----------|-------|
| **State** | `activeSection` (current visible section), `showTop` (scroll button) |
| **Features** | IntersectionObserver scroll tracking, sidebar section nav, progress bar |
| **Sections** | 13 documentation sections (imported from `src/sections/`) |
| **Navigation** | Smooth scrolling, sticky sidebar, scroll-to-top button at 600px |

#### `PlaygroundPage.jsx` — Template Launcher (`/playground`)

| Property | Value |
|----------|-------|
| **State** | `selectedTpl`, `fields`, `projectPath`, `teamSize`, `model`, `generatedPrompt`, `references`, `mentionQuery` |
| **Features** | 8 prompt templates, dynamic form fields, @mention file search, drag-drop references, team size slider (2-6), 2-stage launch (scaffold → terminal) |
| **IPC calls** | `pick_folder`, `scaffold_project`, `save_to_history`, `load_history`, `delete_history_entry`, `launch_in_terminal`, `open_folder_in_explorer` |

#### `MissionControlPage.jsx` — Mission Execution (`/mission`)

| Property | Value |
|----------|-------|
| **Hook** | `useMission()` — provides full mission state + actions |
| **State** | `promptPreview` (prompt edit mode), `historyView` (history snapshot view) |
| **View Flow** | Launcher → PlanReview → PromptPreview → Dashboard ←→ HistoryView |
| **History** | `handleViewHistory()` loads snapshot via `get_mission_detail`, renders read-only Dashboard |
| **Elapsed** | Live timer (running) or computed from `started_at`/`ended_at` (history) |

**View selection logic:**
```
if (promptPreview)       → PromptPreview
if (planReady)           → PlanReview
if (historyView)         → MissionDashboard (read-only, isHistoryView=true)
if (hasMission)          → MissionDashboard (live)
else                     → MissionLauncher + MissionHistoryPanel
```

#### `DashboardPage.jsx` — System Status (`/dashboard`)

| Property | Value |
|----------|-------|
| **State** | `claudeStatus`, `systemInfo`, `sessions`, `output` |
| **Cards** | Claude CLI status, Agent Teams config, Platform, Active Sessions |
| **IPC calls** | `check_claude_available`, `get_system_info`, `launch_agent_team` |

#### `OnboardingPage.jsx` — First-Run Wizard (`/setup`)

| Property | Value |
|----------|-------|
| **Steps** | 1. Check Claude CLI → 2. Enable Agent Teams → 3. Done |
| **IPC calls** | `get_system_info`, `check_claude_available`, `enable_agent_teams` |
| **Redirect** | Goes to `/` on completion, stores setup state in localStorage |

---

### 4.3 Components — Layout

#### `Sidebar.jsx`
- Navigation with active state highlighting
- Logo with Agent Teams status indicator (green dot if enabled)
- Doc sections nav (visible on DocsPage only)
- Scroll progress bar
- Mobile responsive with overlay

#### `CodeBlock.jsx`
- Prism.js syntax highlighting
- Copy-to-clipboard button
- Window chrome (traffic light dots)
- Language label in top-right

#### `InfoBox.jsx`
- 4 variants: `tip` (green), `warning` (yellow), `info` (blue), `danger` (red)
- Used throughout documentation sections

#### `SectionHeader.jsx`
- Section number (zero-padded), Vietnamese title, English subtitle, description

---

### 4.4 Components — Mission

#### `MissionLauncher.jsx`
**Props:** `onLaunch(config)`

Main form for starting missions:
- **Project path:** text input + folder picker button
- **Requirement textarea:** multi-line with @mention support (searches project files via `search_project_files`), Ctrl+V paste images
- **Reference materials:** drag-drop files/folders/images from OS, click buttons to add
- **Model selector:** Sonnet (balanced) / Opus (best) / Haiku (fast)
- **Execution mode:** Standard / Agent Teams (experimental, with `FlaskConical` icon)
- **Team size slider:** 2-6 with cost warning at 4+
- **System prompt preview:** toggle to view generated prompt
- **Mission history:** last 5 expandable, reuse or delete

#### `MissionDashboard.jsx`
**Props:** `state`, `isRunning`, `onStop`, `onContinue`, `onNewMission`, `elapsed`, `isHistoryView`

Main monitoring dashboard, renders:
```
┌─────────────────────────────────────────────────┐
│ [History Banner] (if isHistoryView)             │
├─────────────────────────────────────────────────┤
│ MissionHeader (title, status, elapsed, actions) │
├──────────────┬──────────────────────────────────┤
│ AgentGrid    │ Tabbed Content:                  │
│ (left panel) │  ├ Tasks — TaskList              │
│              │  ├ Activity — ActivityLog         │
│              │  ├ Messages — MessagesPanel       │
│              │  ├ Files — FileChangesPanel       │
│              │  └ [Agent] — filtered log         │
├──────────────┴──────────────────────────────────┤
│ ThinkingIndicator (when launching)              │
├─────────────────────────────────────────────────┤
│ InterventionPanel (hidden in historyView)       │
├─────────────────────────────────────────────────┤
│ RawOutput (collapsible)                         │
└─────────────────────────────────────────────────┘
```

All sub-arrays are memoized to prevent re-renders during high-frequency updates.

#### `PlanReview.jsx`
**Props:** `plan`, `onDeploy`, `onCancel`, `isReplanning`, `onReplan`, `projectPath`

Edit plan before deployment:
- Drag-drop task reordering (via `@dnd-kit/sortable`)
- Add/remove agents, edit names/roles
- Model selection per agent
- Priority cycling (High → Med → Low)
- Task detail panel (inline editor)
- Skill folder loading
- Re-plan button (sends edits to AI for review)

#### `PromptPreview.jsx`
**Props:** `agents`, `tasks`, `projectPath`, `onConfirm`, `onBack`

Per-agent prompt editor before deployment. Each agent gets a generated system prompt showing their role, tasks, and quality requirements. User can edit prompts inline.

#### `AgentCard.jsx`
**Props:** `agent`, `logs`, `isSelected`, `onSelect`

Individual agent card showing:
- Colored initials badge (green=Done, blue=Working, gray=Idle, red=Error)
- Name, role, model badge
- Status badge with animated dot
- Current task (truncated)
- Expandable recent logs (last 30 entries)

#### `AgentGrid.jsx`
**Props:** `agents`, `logs`, `selectedAgent`, `onSelectAgent`

Grid of AgentCard components. Shows agent count in header.

#### `TaskList.jsx`
**Props:** `tasks`, `logs`

Task progress tracking:
- Progress bar (completed/total, percentage)
- Per-task: status icon, title, assigned agent, priority badge
- Phase inference from logs (Investigating → Coding → Building → Done)
- "Stuck" detection (no activity > 1 min)
- Duration calculation from started_at/completed_at

#### `ActivityLog.jsx`
**Props:** `log`, `title`

Auto-scrolling log viewer:
- Shows last 200 entries (from potentially 2000+ in state)
- Deduplicates consecutive identical messages
- Expandable long messages (> 200 chars) with copy button
- Color-coded by log_type: spawn (blue), error (red), tool (purple), result (green), message (cyan)

#### `FileChangesPanel.jsx`
**Props:** `changes`

File diff viewer with timeline:
- Sorted by most recent timestamp
- Per-file expandable view
- **DiffViewer** sub-component:
  - Created files: green content preview with line numbers
  - Modified files: red (old) → green (new) diff with line numbers
  - Copy content button, truncation indicator
- **Edit timeline:** if multiple edits on one file, shows numbered buttons with timestamps
- Graceful fallback when diff data is null ("Diff data not available")

#### `MessagesPanel.jsx`
**Props:** `messages`

Inter-agent message viewer (Agent Teams mode):
- Message type badges (message, broadcast, shutdown)
- From → To agent labels
- Timestamp display

#### `InterventionPanel.jsx`
**Props:** `onSend`, `isRunning`, `disabled`

User intervention input:
- Text input with Shift+Enter for multiline, Enter to send
- **Custom agent config:** toggle to add agents with name/task/model per row
- Message history with status (queued/running/sent)
- Hidden in history view

#### `RawOutput.jsx`
**Props:** `lines`

Collapsible raw stdout viewer:
- Shows last 500 lines
- Auto-scrolls when expanded
- Pre-formatted monospace text

#### `ThinkingIndicator.jsx`
**Props:** `log`, `isRunning`

Loading animation during planning:
- Pulsing brain icon
- Cycling phase text every 8s ("Đang phân tích yêu cầu...", "Đang lên kế hoạch...", etc.)
- Animated dots
- Recent activity feed (last 3 logs)
- Hides after 2+ meaningful log entries

---

### 4.5 Sections — Docs

13 documentation section components in `src/sections/`:

| File | Section | Content |
|------|---------|---------|
| `Introduction.jsx` | Giới thiệu | App overview, features |
| `StandardMode.jsx` | Standard Mode | Default single-agent flow |
| `LauncherGuide.jsx` | Launcher Guide | How to fill mission form |
| `PlanReviewGuide.jsx` | Plan Review | Editing plans, tasks, details, re-plan |
| `DashboardGuide.jsx` | Dashboard Guide | Reading mission dashboard |
| `Setup.jsx` | Cài đặt | Installation instructions |
| `CreateTeam.jsx` | Agent Teams Mode | Experimental multi-agent mode |
| `TeamInteraction.jsx` | Tương tác Team | Inter-agent communication |
| `DisplayModes.jsx` | Chế độ hiển thị | UI display options |
| `BestPractices.jsx` | Best Practices | Tips for good results |
| `RealWorldExamples.jsx` | Ví dụ thực tế | Sample missions |
| `HowItWorks.jsx` | Cách hoạt động | Technical architecture |
| `Limitations.jsx` | Giới hạn | Known limitations |

All sections are pure display components. Data defined in `src/data/sections.js`.

---

### 4.6 Hooks

#### `useMission()` — Core Mission State Manager

**Returns:**
```javascript
{
  missionState,    // MissionState | null
  isRunning,       // boolean
  planReady,       // { agents, tasks } | null
  isReplanning,    // boolean
  launch,          // (config) => Promise
  deploy,          // (agents, tasks) => Promise
  continueM,       // (message, context?) => Promise
  stop,            // () => Promise
  reset,           // () => Promise
  replan,          // (agents, tasks) => Promise<plan>
}
```

**Event batching system:**
High-frequency events (`mission:log`, `mission:file-change`, `mission:raw-line`) are buffered and flushed every 120ms to prevent excessive re-renders.

```
Event arrives → push to buffer → schedule flush (120ms)
                                    ↓
                              setState({ ...prev,
                                log: [...prev.log, ...logBuffer],
                                file_changes: merge(prev.file_changes, fcBuffer),
                                raw_output: [...prev.raw_output, ...rawBuffer]
                              })
```

Low-frequency events (`mission:status`, `mission:agent-spawned`, `mission:plan-ready`) are applied immediately.

**File change history tracking:**
When multiple edits happen to the same file, the hook maintains a `history[]` array on the file change object so the FileChangesPanel can show an edit timeline.

**Event listeners (10):**

| Event | Handler | Frequency |
|-------|---------|-----------|
| `mission:status` | Update status/phase, detect terminal states | Low |
| `mission:agent-spawned` | Add/reset agents array | Low |
| `mission:log` | Buffer → batch flush | High |
| `mission:file-change` | Buffer → batch flush, maintain edit history | High |
| `mission:task-update` | Smart match by id or title fuzzy | Medium |
| `mission:raw-line` | Buffer → batch flush | Very High |
| `mission:plan-ready` | Set planReady, mark phase ReviewPlan | Low |
| `mission:agent-message` | Append to messages | Low |
| `mission:team-event` | Log entry | Low |
| `mission:task-reassigned` | Log entry | Low |

**Hydration on mount:**
Calls `get_mission_state()` to restore state if app was reloaded mid-mission.

**Error handling:**
All IPC calls (`launch`, `deploy`, `continueM`) wrapped in try/catch with graceful state transition to `Failed`/`Done` on error.

#### `useTauriFileDrop()` — Drag-Drop Handler

**Args:** `onDrop: (paths: string[]) => void`
**Returns:** `{ isDragging: boolean }`

Uses `getCurrentWebview().onDragDropEvent()` (Tauri) or noop (Electron, uses HTML5 drag-drop instead).

---

### 4.7 Data Files

#### `sections.js`
Array of 13 section definitions for DocsPage:
```javascript
{ id, titleVi, titleEn, icon: LucideIcon, badge?, experimental? }
```

#### `templates.js`
Array of 8 prompt templates for Playground:
```javascript
{
  id, icon, label, desc, defaultTeamSize,
  fields: [{ id, label, placeholder, multiline? }],
  buildPrompt: (fields) => string
}
```

Templates: code-review, feature, debug, research, migration, security-audit, documentation, refactor.

#### `promptWrapper.js`
Exports:
- `buildMissionPrompt(requirement, options)` → generates Phase 1 planning prompt
- `SYSTEM_INFO` — flow steps, agent tools, model info

Prompt building:
1. Detect language (Vietnamese diacritics check)
2. Load planning template (`read_planning_template` IPC)
3. Build reference materials section (inline files < 500KB, path hints for others)
4. Substitute template variables: `{{REQUIREMENT}}`, `{{PROJECT_PATH}}`, `{{LANG_HINT}}`, `{{REFERENCES_SECTION}}`, `{{TEAM_HINT}}`

---

### 4.8 Tauri Shim Layer

4 files in `src/lib/tauri-shim/` that redirect Tauri API calls to Electron IPC:

| Shim | Tauri API | Electron Equivalent |
|------|-----------|-------------------|
| `core.js` | `invoke(cmd, args)` | `window.electronAPI.invoke(cmd, args)` |
| `event.js` | `listen(event, cb)` | `window.electronAPI.on(event, cb)` returning unlisten fn |
| `event.js` | `emit()` | No-op |
| `webview.js` | `getCurrentWebview()` | No-op `onDragDropEvent` (Electron uses HTML5 drag-drop) |
| `plugin-opener.js` | `openUrl(url)` | `invoke('open_url', { url })` |

Activated by Vite alias in `vite.config.electron.mjs`. Tauri mode uses the real `@tauri-apps/api` directly.

---

## 5. Backend Architecture

### 5.1 Main Process

**`electron/main.cjs`** (60 lines)

```javascript
app.whenReady() → {
  createWindow(1280x820, dark bg, preload.cjs)
  registerSystem(getMainWindow)
  registerFiles(getMainWindow)
  registerHistory(getMainWindow)
  registerMission(getMainWindow)
}
```

- Single window, min 900x600
- Loads `dist-electron/index.html`
- Quits on all windows closed

---

### 5.2 Preload & Security

**`electron/preload.cjs`** (57 lines)

Exposes `window.electronAPI` via `contextBridge`:

**Command whitelist (28 commands):**
```
system:  check_claude_available, get_system_info, enable_agent_teams,
         read_settings, open_folder_in_explorer, launch_in_terminal, open_url
files:   pick_folder, pick_files, read_file_content, get_file_info,
         save_clipboard_image, search_project_files, scaffold_project, read_skill_folder
history: save_to_history, load_history, get_mission_history,
         delete_history_entry, get_mission_detail
mission: launch_mission, deploy_mission, continue_mission, replan_mission,
         stop_mission, reset_mission, get_mission_state, update_agent_model,
         read_planning_template
```

**Event whitelist (11 channels):**
```
mission:status, mission:agent-spawned, mission:log, mission:file-change,
mission:task-update, mission:raw-line, mission:plan-ready,
mission:agent-message, mission:team-event, mission:task-reassigned,
claude-output
```

Non-whitelisted commands/events are rejected at the preload layer.

---

### 5.3 IPC Handlers — System

**`electron/ipc/system.cjs`** — 7 handlers

| Command | Input | Output | Effect |
|---------|-------|--------|--------|
| `check_claude_available` | — | `{ ok, version? }` | `execSync('claude --version')` |
| `get_system_info` | — | `{ platform, claude_available, agent_teams_enabled, settings_path, settings_exist, username }` | Reads `~/.claude/settings.json` |
| `enable_agent_teams` | — | settings path | Writes `{"env":{"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS":"1"}}` to `~/.claude/settings.json` (preserves existing) |
| `read_settings` | — | JSON string | Reads `~/.claude/settings.json` |
| `open_folder_in_explorer` | `{ path }` | — | `spawn('explorer', [path])` |
| `launch_in_terminal` | `{ projectPath, prompt }` | — | `spawn('cmd', ...)` with cd + claude command |
| `open_url` | `{ url }` | — | `shell.openExternal(url)` |

---

### 5.4 IPC Handlers — Files

**`electron/ipc/files.cjs`** — 8 handlers

| Command | Input | Output | Effect |
|---------|-------|--------|--------|
| `pick_folder` | — | folder path string | `dialog.showOpenDialog({ properties: ['openDirectory'] })` |
| `pick_files` | — | file path array | `dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })` |
| `read_file_content` | `{ path }` | UTF-8 string | `fs.readFileSync(path, 'utf-8')` |
| `get_file_info` | `{ path }` | `{ name, size, is_dir, extension }` | `fs.statSync()` |
| `save_clipboard_image` | `{ base64Data }` | `{ name, path, size }` | Decodes base64 → writes to `~/temp/agent-teams-guide/` |
| `search_project_files` | `{ projectPath, query }` | file array (max 20) | Recursive walk, 6 levels deep, skips node_modules/dist/.git/etc |
| `scaffold_project` | `{ projectPath, templateId, config }` | `{ agent_dir, created_files }` | Creates `.claude-agent-team/` with template files |
| `read_skill_folder` | `{ path }` | `{ name, size, fileCount, content, files[] }` | Bundles all text files into markdown (500KB max) |

---

### 5.5 IPC Handlers — History

**`electron/ipc/history.cjs`** — 5 handlers

**Storage locations:**
- History index: `~/.claude/agent-teams-history.json` (max 50 entries)
- Snapshots: `~/.claude/agent-teams-snapshots/{missionId}.json`

| Command | Input | Output | Effect |
|---------|-------|--------|--------|
| `save_to_history` | `{ entry }` | — | Prepend entry to history.json, truncate to 50 |
| `load_history` | — | entry array | Read history.json |
| `get_mission_history` | — | entry array | Alias for load_history |
| `delete_history_entry` | `{ index }` | — | Remove entry at index |
| `get_mission_detail` | `{ missionId }` | full MissionState | Read `agent-teams-snapshots/{id}.json` |

**History entry structure (summary):**
```javascript
{
  id, description, project_path, execution_mode,
  status, started_at, ended_at,
  agent_count, task_summary: ["[status] title", ...],
  file_changes, log_count
}
```

---

### 5.6 IPC Handlers — Mission

**`electron/ipc/mission.cjs`** — 8 handlers (see [Section 6](#6-mission-core) for full details)

| Command | Input | Output | Description |
|---------|-------|--------|-------------|
| `launch_mission` | `{ projectPath, prompt, description, model, executionMode }` | MissionState | Start Phase 1 (planning) |
| `deploy_mission` | `{ agents, tasks }` | null or error | Start Phase 3 (execution) |
| `continue_mission` | `{ message, contextJson? }` | null or error | Intervention continuation |
| `replan_mission` | `{ agents, tasks }` | `{ agents, tasks }` or error | AI re-plan existing plan |
| `stop_mission` | — | — | Kill process, set Stopped |
| `reset_mission` | — | — | Kill process, clear all state |
| `get_mission_state` | — | MissionState or null | Get current state (hydration) |
| `update_agent_model` | `{ agentName, model }` | — | Update agent model field |
| `read_planning_template` | — | markdown string | Read planning.md content |

---

## 6. Mission Core

### 6.1 Module-Level State

```javascript
// ═══ SINGLETON STATE ═══
let missionState = null;        // MissionState | null — THE state object
let childProcess = null;        // ChildProcess | null — claude -p subprocess
let watcherInterval = null;     // NodeJS.Timeout | null — file watcher (agent_teams)

// ═══ PROMPT TEMPLATES (loaded once at startup) ═══
const PROMPT_DEPLOY_STANDARD     // deploy_standard.md content
const PROMPT_DEPLOY_AGENT_TEAMS  // deploy_agent_teams.md content
const PROMPT_CONTINUE_MISSION    // continue_mission.md content
const PROMPT_REPLAN              // replan.md content (optional)
```

**Only ONE mission can exist at a time.** `launch_mission` rejects if `childProcess` is already running.

---

### 6.2 MissionState Data Structure

```typescript
interface MissionState {
  // ─── Identity ───
  id: string                    // "mission-{Date.now()}"
  description: string           // User's requirement text
  project_path: string          // Absolute path to project directory

  // ─── Lifecycle ───
  status: Status                // Current status
  phase: Phase                  // Current phase
  execution_mode: 'standard' | 'agent_teams'
  started_at: number            // Timestamp (ms)
  ended_at: number | null       // Timestamp (ms) — set on completion

  // ─── Agents ───
  agents: Agent[]               // Grows across intervention cycles, never shrinks

  // ─── Tasks ───
  tasks: Task[]                 // Plan tasks, updated during execution

  // ─── Logs ───
  log: LogEntry[]               // Capped at 2000 entries in memory, 2000 in snapshot
  raw_output: string[]          // Capped at 5000 in memory, 500 in snapshot

  // ─── Files ───
  file_changes: FileChange[]    // All file modifications detected

  // ─── Communication ───
  messages: Message[]           // Inter-agent messages (Agent Teams mode)
  team_name: string | null      // Active team name (Agent Teams mode)
}

interface Agent {
  name: string                  // Unique name (e.g., "Lead", "backend-dev")
  role: string                  // Role description
  status: 'Spawning' | 'Working' | 'Idle' | 'Done' | 'Error'
  current_task: string | null   // What agent is currently doing
  spawned_at: number            // Timestamp
  model: string | null          // "sonnet" | "opus" | "haiku"
  model_reason: string | null   // Why this model was chosen
}

interface Task {
  id: string                    // "task-0", "task-1", ...
  title: string                 // Short task name
  detail: string                // Detailed implementation instructions
  status: 'pending' | 'in_progress' | 'completed'
  assigned_agent: string | null // Agent name
  started_at: number | null
  completed_at: number | null
  priority: 'high' | 'medium' | 'low' | null
}

interface LogEntry {
  timestamp: number
  agent: string                 // "Lead", "System", agent name
  message: string               // Log text
  log_type: 'info' | 'error' | 'thinking' | 'tool' | 'spawn' | 'result' | 'task' | 'plan-ready' | 'message'
  tool_name: string             // Tool used (if log_type='tool')
  phase_hint: string            // 'investigating' | 'coding' | 'building' | 'spawning'
  file_path: string             // File involved (if any)
  lines: number                 // Lines affected
}

interface FileChange {
  path: string                  // Relative file path
  action: 'created' | 'modified'
  agent: string                 // Who made the change
  timestamp: number
  lines: number | null          // Line count
  content_preview: string | null // File content (created) or new content (modified), max 2000 chars
  diff_old: string | null       // Old content (modified only), max 1500 chars
  diff_new: string | null       // New content (modified only), max 1500 chars
}

interface Message {
  timestamp: number
  from: string                  // Sender agent name
  to: string                    // Recipient agent name
  content: string               // Message text
  msg_type: 'message' | 'broadcast' | 'shutdown_request' | 'shutdown_response'
}
```

---

### 6.3 Helper Functions

| Function | Signature | Purpose |
|----------|-----------|---------|
| `now()` | `() → number` | `Date.now()` |
| `stripAnsi(s)` | `string → string` | Remove ANSI escape codes |
| `makeLogEntry(ts, agent, msg, type, tool)` | `→ LogEntry` | Create standardized log entry |
| `inferRole(name)` | `string → string` | Guess role from agent name ("backend" → "Backend Developer") |
| `inferPhase(tool)` | `string → string` | Map tool to phase ("Write" → "coding") |
| `buildToolDetail(tool, input)` | `→ string` | Human-readable tool description |
| `extractFilePathAndLines(tool, input)` | `→ [path, lines]` | Extract file info from tool input |
| `buildFileChangeFromInput(tool, input, agent, ts)` | `→ FileChange` | Create FileChange from Write/Edit tool input |
| `upsertFileChange(fc)` | `FileChange → void` | Update-or-insert into `missionState.file_changes` |
| `tryParsePlanFromBuffer(buffer)` | `string → {agents,tasks} \| null` | Extract plan JSON from marker or raw text |
| `applyPlanToState(plan)` | `{agents,tasks} → void` | Write parsed plan into missionState |
| `detectProjectType(path)` | `string → string` | Detect project type + build instructions |
| `detectVietnamese(text)` | `string → boolean` | Check for Vietnamese diacritics |
| `parseProgressLine(text)` | `string → [agent, message]` | Parse "[AgentName] message" format |
| `collectFiles(dir, base)` | `→ Set<string>` | Recursive file listing, skip node_modules/.git/etc |
| `startFileWatcher(path, send)` | `→ void` | Start polling interval for Agent Teams |
| `stopWatcher()` | `→ void` | Clear polling interval |
| `spawnClaude(args, cwd, useAgentTeams)` | `→ ChildProcess` | Spawn `claude` with env setup |
| `killChild()` | `→ void` | Kill subprocess tree (SIGTERM → SIGKILL after 3s) |
| `saveMissionSnapshot(state)` | `→ void` | Save state to snapshot file (truncated) |
| `saveToHistory(entry)` | `→ void` | Append summary entry to history |

---

### 6.4 Stream-JSON Parsing

Claude CLI with `--output-format stream-json` emits one JSON object per line.

**JSON types:**

```javascript
// System messages
{ "type": "system", "subtype": "init" | "task_notification" | "task_progress" | ... }

// Assistant messages (text + tool calls)
{ "type": "assistant", "message": { "content": [
  { "type": "text", "text": "..." },
  { "type": "tool_use", "name": "Write", "input": { "file_path": "...", "content": "..." } }
]}}

// Content streaming (incremental text)
{ "type": "content_block_delta", "delta": { "type": "text_delta", "text": "..." } }
{ "type": "content_block_start", "content_block": { "type": "text", "text": "..." } }

// Results (tool output, subagent completion)
{ "type": "result", "result": "...", "subtype": "tool_result" }

// Errors
{ "type": "error", "error": { "message": "..." } }
```

**Two parsing modes:**

1. **`readProcessStdout_launch()`** — Planning phase
   - Accumulates all text into `fullTextBuf`
   - After each text chunk: calls `tryParsePlanFromBuffer(fullTextBuf)`
   - Plan detection strategies:
     - Marker: `=== MISSION PLAN ===` ... `=== END PLAN ===`
     - JSON: find first `{` ... last `}` containing `agents` + `tasks` keys
   - On plan found: emit `mission:plan-ready`, set phase to `ReviewPlan`
   - Also tracks tool_use for Write/Edit/Agent during planning

2. **`readProcessStdout_deploy()`** — Execution phase
   - Tracks `toolUseIdToAgent` map (associates tool_use_id → agent name)
   - Detects Agent tool spawning → creates new Agent in state
   - Detects TeamCreate/TeamDelete → team lifecycle events
   - Detects SendMessage → inter-agent messages
   - Detects TaskUpdate → task reassignment events
   - Detects Write/Edit → file changes with diff data
   - Tracks subagent results via `parentId` matching
   - Fuzzy task completion: matches agent name + task title words in completion text

---

### 6.5 Process Lifecycle

#### Launch Phase

```
launch_mission() {
  1. Init missionState (id, description, agents=[Lead], tasks=[], ...)
  2. Emit mission:status { status: 'launching' }
  3. Emit mission:agent-spawned { name: 'Lead', reset: true }
  4. Spawn: claude -p --dangerously-skip-permissions --model {model}
            --output-format stream-json --verbose
     env: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 (if agent_teams)
  5. Write prompt to stdin → close stdin
  6. Wire: readProcessStdout_launch(), readProcessStderr(), watchProcessExit_launch()
  7. Return missionState
}
```

#### Deploy Phase

```
deploy_mission() {
  1. Validate missionState exists
  2. Detect Vietnamese → viRule
  3. Detect project type → projectTypeHint
  4. Build agent blocks (name, role, model, tasks, custom instructions, skill files)
  5. Build deploy prompt from template (standard or agent_teams)
  6. Update phase='Deploying', Lead.status='Working'
  7. Kill old subprocess
  8. Spawn: claude -p --dangerously-skip-permissions --model {leadModel}
            --output-format stream-json --verbose --max-turns 200
     env: CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 (if agent_teams)
  9. Write deploy prompt to stdin → close stdin
  10. If agent_teams: startFileWatcher()
  11. Wire: readProcessStdout_deploy(), readProcessStderr(), watchProcessExit_deploy()
}
```

#### Continue Phase

```
continue_mission() {
  1. Parse optional contextJson (for history-based continuation)
  2. Build summary: completed tasks + recent logs + file changes
  3. Detect project type → projectTypeHint
  4. Build continue prompt from template
  5. Mutate missionState:
     - phase='Deploying', status='Running'
     - Lead.status='Working'
     - messages=[], team_name=null  (CLEARED)
     - Other agents: status unchanged (stay Done)
  6. Kill old subprocess
  7. Spawn: claude -p --dangerously-skip-permissions --model {leadModel}
            --output-format stream-json --verbose --max-turns 200
     env: NO agent teams (always standard mode for continuation)
  8. Write continue prompt to stdin → close stdin
  9. Wire: readProcessStdout_deploy(isContMode=true), readProcessStderr(),
           watchProcessExit_deploy()
}
```

#### Process Exit

```
watchProcessExit_deploy() {
  on 'close' event:
  1. Stop file watcher
  2. Determine status: exit code 0 → 'Completed', else → 'Failed'
  3. Set phase='Done'
  4. Mark all Working/Idle agents as Done/Error
  5. If Completed: mark remaining pending tasks as completed
  6. Set ended_at
  7. saveToHistory(entry) — summary with execution_mode
  8. saveMissionSnapshot(missionState) — full state (truncated)
  9. Emit mission:status { status: 'completed' | 'failed' }
}
```

---

### 6.6 File Watcher

**Active only in Agent Teams execution mode.** Polls every 2 seconds:

**Task directory monitoring** (`~/.claude/tasks/mission/`):
- Reads all `*.json` files
- Tracks status changes via `knownTaskStatuses` Map
- On status change: update task in missionState, emit `mission:task-update`
- Also reads `messages[]` array in task JSON for inter-agent messages
- Deduplicates messages via `knownMsgIds` Set (from-to-timestamp key)
- Emits `mission:agent-message` for new messages

**Project directory monitoring** (every 5 iterations ≈ 10s):
- Calls `collectFiles(projectDir)` — recursive walk, skips node_modules/.git/etc
- Compares against `knownProjectFiles` Set
- New files: push to `missionState.file_changes`, emit `mission:file-change`
- File changes from watcher have `content_preview: null` (no diff data — only metadata)

---

## 7. Mission Lifecycle

### 7.1 Phases & Statuses

**Phases (7 values):**

| Phase | Description | Entered from |
|-------|-------------|--------------|
| `null` | No mission | Initial state, after reset |
| `Planning` | Phase 1: AI generating plan | launch_mission() |
| `ReviewPlan` | User reviewing/editing plan | Plan detected in output |
| `Deploying` | Phase 3: spawning execution process | deploy_mission() or continue_mission() |
| `Executing` | Agents working | After deploy subprocess starts producing output |
| `Continuing` | Intervention in progress | continue_mission() (frontend-only) |
| `Done` | Terminal state | Process exit |

**Statuses (7 values):**

| Status | Description | Entered from |
|--------|-------------|--------------|
| `Idle` | Initial | Not used after launch |
| `Launching` | Process starting | launch_mission() |
| `Running` | Active execution | Process output received |
| `Deploying` | About to spawn | deploy_mission() |
| `Completed` | Exit code 0 | Process exit handler |
| `Stopped` | User stopped | stop_mission() |
| `Failed` | Exit code != 0 or error | Process exit handler |

---

### 7.2 Phase Transitions

```
                 launch_mission()
                      │
              ┌───────▼───────┐
              │   Planning    │ status: Launching → Running
              │  (Phase 1)    │
              └───────┬───────┘
                      │ Plan JSON detected in output
              ┌───────▼───────┐
              │  ReviewPlan   │ User edits agents, tasks, details
              │  (Phase 2)    │
              └───┬───────┬───┘
                  │       │
            Cancel│       │ deploy_mission()
                  │       │
              ┌───▼──┐ ┌──▼───────────┐
              │Reset │ │  Deploying   │ Kill old process, spawn new
              └──────┘ │  (Phase 3)   │
                       └──────┬───────┘
                              │ Output streaming begins
                       ┌──────▼───────┐
                       │  Executing   │ Agents working, tasks progressing
                       │  (Phase 3)   │
                       └──────┬───────┘
                              │ Process exits
                       ┌──────▼───────┐
                       │    Done      │ status: Completed/Failed/Stopped
                       │  (Phase 4)   │ Snapshot saved, history entry added
                       └──────┬───────┘
                              │
                 ┌────────────┼────────────┐
                 │            │            │
            Continue    New Mission     Close
           (intervention)  (reset)       (app)
                 │
          ┌──────▼───────┐
          │  Deploying   │ Same missionState, new process
          │  (repeat)    │ Lead reset, subagents stay Done
          └──────┬───────┘
                 │
          ┌──────▼───────┐
          │  Executing   │ Can cycle indefinitely
          └──────┬───────┘
                 │
          ┌──────▼───────┐
          │    Done      │ Updated snapshot saved
          └──────────────┘
```

---

### 7.3 Intervention Cycles

A single mission (same ID) can have **multiple intervention cycles**:

```
Cycle 1: Deploy → Agents [Lead, A1, A2] → Complete
  ↓ User: "Add dark mode"
Cycle 2: Continue → Agents [Lead, A1(Done), A2(Done), A3(new)] → Complete
  ↓ User: "Fix the navbar"
Cycle 3: Continue → Agents [Lead, A1(Done), A2(Done), A3(Done), A4(new)] → Complete
  ↓ User can keep going...
```

**What persists across cycles:**
- `missionState.id` — same ID
- `agents[]` — only grows (never removed)
- `tasks[]` — keeps all tasks
- `log[]` — keeps all logs (appended)
- `file_changes[]` — keeps all changes (appended)
- `raw_output[]` — keeps all output (appended)
- `project_path`, `description`, `started_at`, `execution_mode`

**What resets each cycle:**
- `messages[]` → cleared (`[]`)
- `team_name` → cleared (`null`)
- `Lead.status` → `Working`
- `phase` → `Deploying` → `Executing` → `Done`
- Other agents: **status NOT reset** (stay `Done`)

**Agent Teams mode disabled in continue:** All continuation cycles use `agent_teams=false`, meaning no file watcher and no TeamCreate/SendMessage tools.

---

### 7.4 State Persistence

**On each mission completion (Done), two files are written:**

1. **History entry** → `~/.claude/agent-teams-history.json`
   - Summary: id, description, project_path, execution_mode, status, timestamps, agent_count, task_summary, file_changes, log_count
   - Max 50 entries (FIFO)

2. **Full snapshot** → `~/.claude/agent-teams-snapshots/{id}.json`
   - Complete MissionState
   - `raw_output` truncated to last 500 lines
   - `log` truncated to last 2000 entries
   - Overwrites previous snapshot with same ID (latest cycle wins)

**Loading history:**
1. History panel calls `get_mission_history()` → list of summary entries
2. "Xem chi tiết" calls `get_mission_detail(missionId)` → full snapshot
3. Snapshot loaded into `historyView` state → rendered as read-only MissionDashboard

---

## 8. Event System

Backend pushes events via `win.webContents.send(channel, payload)`.
Frontend listens via `listen(channel, callback)` (Tauri API or shim).

| Channel | Payload | Frequency | Description |
|---------|---------|-----------|-------------|
| `mission:status` | `{ status, mission_id? }` | Low | Phase/status change |
| `mission:agent-spawned` | `{ agent_name, role, timestamp, reset? }` | Low | Agent added (reset=true clears all) |
| `mission:log` | `LogEntry` | **Very High** | Log line (batched in frontend) |
| `mission:file-change` | `{ path, action, agent, timestamp, lines?, content_preview?, diff_old?, diff_new? }` | **High** | File modification detected |
| `mission:task-update` | `{ task_id?, agent?, status, description?, timestamp }` | Medium | Task status change |
| `mission:raw-line` | `{ line, line_number }` | **Very High** | Raw stdout line (batched) |
| `mission:plan-ready` | `{ agents[], tasks[] }` | Once | Plan parsed, ready for review |
| `mission:agent-message` | `{ from, to, content, timestamp, msg_id? }` | Low | Inter-agent DM |
| `mission:team-event` | `{ event_type, data?, timestamp }` | Rare | TeamCreate/TeamDelete |
| `mission:task-reassigned` | `{ task_id, from_agent, to_agent }` | Rare | Task ownership change |
| `claude-output` | `{ sessionId, data }` | Legacy | Dashboard page output |

**Frontend batching:**
`mission:log`, `mission:file-change`, `mission:raw-line` are buffered in `useMission.js` and flushed via a single `setState` every 120ms to prevent render thrashing.

---

## 9. Prompt Templates

All templates stored in `electron/prompts/` (packaged as `extraResources` in production).

### 9.1 `planning.md` — Phase 1

**Purpose:** Generate a plan with agents and tasks from user requirement.

**Variables:** `{{REQUIREMENT}}`, `{{PROJECT_PATH}}`, `{{LANG_HINT}}`, `{{REFERENCES_SECTION}}`, `{{TEAM_HINT}}`

**Output format:** JSON between `=== MISSION PLAN ===` markers:
```json
{
  "agents": [{ "name", "role", "model", "model_reason" }],
  "tasks": [{ "id", "title", "detail", "assigned_agent", "priority" }]
}
```

### 9.2 `deploy_standard.md` — Phase 3 (Standard Mode)

**Purpose:** Execute plan with Agent tool spawning (no Teams API).

**Variables:** `{{PROJECT_PATH}}`, `{{PROJECT_TYPE}}`, `{{LANG_RULE}}`, `{{TOTAL_AGENTS}}`, `{{AGENT_BLOCKS}}`

**Execution phases:**
1. **Spawn:** Call Agent tool for each agent with their tasks + skill content
2. **Review:** Check build results from each agent
3. **Integration:** Run full build, fix import/type errors, smoke test
4. **Documentation:** Write README.md, print summary

**Quality gates:**
- All source files complete (no TODO/stub)
- Dependencies installed
- Build passes with 0 errors
- Integration test passes
- README.md exists

### 9.3 `deploy_agent_teams.md` — Phase 3 (Agent Teams Mode)

**Purpose:** Execute plan with TeamCreate/SendMessage collaboration.

**Variables:** Same as standard.

**Additional phases:**
- Phase 1: TeamCreate with `team_name='mission'`
- Phase 3: Active monitoring — read teammate messages, send DMs, reassign if stuck
- Phase 5: Send `shutdown_request` to all teammates, TeamDelete

### 9.4 `continue_mission.md` — Intervention

**Purpose:** Continue from a completed mission with user's new instruction.

**Variables:** `{{PROJECT_PATH}}`, `{{PROJECT_TYPE}}`, `{{SUMMARY}}`, `{{MESSAGE}}`

**Summary contains:**
- Completed tasks list
- Recent log entries (last 20)
- File changes list

### 9.5 `replan.md` — Re-plan

**Purpose:** Adjust existing plan based on user edits.

**Variables:** `{{AGENTS}}`, `{{TASKS}}`, `{{CHANGES}}`

**Rules:**
- Incremental update only (don't rewrite everything)
- Fill detail for tasks that lack it
- Respect user's agent/task modifications
- Timeout: 120 seconds

---

## 10. Data Persistence

### 10.1 File Locations

| Data | Path | Max Size |
|------|------|----------|
| Settings | `~/.claude/settings.json` | ~1KB |
| History index | `~/.claude/agent-teams-history.json` | 50 entries |
| Snapshots | `~/.claude/agent-teams-snapshots/{id}.json` | ~100-500KB each |
| Clipboard images | `~/temp/agent-teams-guide/` | Per-image |
| Scaffold templates | `{project}/.claude-agent-team/` | Generated |
| Team task files | `~/.claude/tasks/mission/*.json` | Per-task (Agent Teams) |

### 10.2 Snapshot Truncation

To keep snapshot files reasonable:
- `raw_output`: last 500 lines (from potentially 5000+)
- `log`: last 2000 entries (from potentially unlimited)
- `file_changes.content_preview`: max 2000 chars per file
- `file_changes.diff_old/diff_new`: max 1500 chars each

### 10.3 History Lifecycle

```
Mission completes → saveToHistory(summary) + saveMissionSnapshot(full)
                     ↓                         ↓
              history.json               snapshots/{id}.json
              (50 entry max)             (overwritten per mission)
                     ↓
              MissionHistoryPanel reads history.json on mount
                     ↓ User clicks "Xem chi tiết"
              get_mission_detail(id) → reads snapshot
                     ↓
              MissionDashboard renders full snapshot (read-only)
```

---

## 11. Performance Optimizations

### Frontend

| Optimization | Where | Impact |
|-------------|-------|--------|
| **Code splitting** | `React.lazy()` for all pages | Faster initial load |
| **Event batching** | `useMission.js` — 120ms flush interval | Prevents render thrashing |
| **Memoization** | `useMemo` for agents, logs, tasks, fileChanges | Stable references |
| **React.memo** | All mission components | Skip unnecessary re-renders |
| **Array limiting** | ActivityLog shows last 200 | DOM node limit |
| **Raw output cap** | RawOutput shows last 500 lines | Memory limit |
| **Deduplication** | Log entries, agent updates | Reduce noise |

### Backend

| Optimization | Where | Impact |
|-------------|-------|--------|
| **Log cap** | `missionState.log` capped at 2000 | Memory limit |
| **Raw output cap** | `missionState.raw_output` capped at 5000 | Memory limit |
| **Snapshot truncation** | raw_output→500, log→2000 | Disk savings |
| **File watcher skip dirs** | node_modules, .git, dist, build, target | Faster scanning |
| **Watcher interval** | 2s for tasks, 10s for files | CPU savings |
| **ANSI stripping** | `stripAnsi()` on all output lines | Clean data |

---

## 12. Dependencies

### Runtime Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `react` | ^19.1.0 | UI framework |
| `react-dom` | ^19.1.0 | DOM rendering |
| `react-router-dom` | ^7.13.1 | Client-side routing |
| `lucide-react` | ^0.577.0 | Icon library (100+ icons used) |
| `@dnd-kit/core` | ^6.3.1 | Drag-and-drop core |
| `@dnd-kit/sortable` | ^10.0.0 | Sortable lists (plan review) |
| `@dnd-kit/utilities` | ^3.2.2 | DnD utilities |
| `@tauri-apps/api` | ^2 | Tauri frontend API (or shim) |
| `@tauri-apps/plugin-opener` | ^2 | URL opener (or shim) |
| `@xterm/xterm` | ^6.0.0 | Terminal emulator (unused currently) |
| `@xterm/addon-fit` | ^0.11.0 | xterm auto-fit (unused currently) |
| `prismjs` | ^1.30.0 | Syntax highlighting for code blocks |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `vite` | ^7.0.4 | Build tool |
| `@vitejs/plugin-react` | ^4.6.0 | React support for Vite |
| `tailwindcss` | ^3.4.19 | Utility-first CSS |
| `postcss` | ^8.5.8 | CSS processing |
| `autoprefixer` | ^10.4.27 | CSS vendor prefixes |
| `@tauri-apps/cli` | ^2 | Tauri CLI tools |
| `electron` | ^33.4.11 | Desktop runtime |
| `electron-builder` | ^25.1.8 | App packaging |

### External Runtime Requirements

| Tool | Version | Purpose |
|------|---------|---------|
| `claude` | CLI (any) | AI agent execution via `claude -p` subprocess |
| Node.js | 18+ | Electron main process |
| Rust/Cargo | Latest | Tauri mode only |

---

*End of Architecture Documentation*
