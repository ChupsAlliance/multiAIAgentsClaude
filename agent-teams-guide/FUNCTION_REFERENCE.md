# Function Reference - Claude Agent Teams (Electron)

**Version**: 2.1
**Last Updated**: 2026-03-14
**Language**: English
**Audience**: Developers & Integrators

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [IPC Commands](#ipc-commands)
3. [Event System](#event-system)
4. [Frontend Hooks API](#frontend-hooks-api)
5. [Data Structures](#data-structures)
6. [Template System](#template-system)
7. [Mission Flow Diagrams](#mission-flow-diagrams)
8. [Key Design Decisions](#key-design-decisions)
9. [Integration Guide](#integration-guide)

---

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     Agent Teams Guide App                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Frontend (React + Electron IPC)                                   │
│  ┌────────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │   Pages        │  │  Components  │  │   Hooks      │        │
│  │ - Dashboard    │  │ - Dashboard  │  │ - useMission │        │
│  │ - Playground   │  │ - Plan UI    │  │ - useHistory │        │
│  │ - MissionCtrl  │  │ - Real-time  │  │              │        │
│  │ - Docs         │  │   Monitor    │  │              │        │
│  └────────────────┘  └──────────────┘  └──────────────┘        │
│                              ↓                                   │
│  State Management & Event Listeners                              │
│  - React Context (MissionState)                                  │
│  - Electron IPC Event Listeners                                    │
│  - Local Storage (history, snapshots)                            │
│                              ↓                                   │
├─────────────────────────────────────────────────────────────────┤
│                     Electron IPC Bridge                              │
│  ┌──────────────────────────────────────────────────────┐       │
│  │ IPC Commands (invoke)  ←→  Node.js Handlers          │       │
│  │ Event System (listen)  ←→  webContents.send           │       │
│  └──────────────────────────────────────────────────────┘       │
│                              ↓                                   │
├─────────────────────────────────────────────────────────────────┤
│                    Node.js Backend (Electron)                       │
│  ┌────────────────┐  ┌──────────────┐  ┌──────────────┐        │
│  │ IPC Handlers   │  │ State Mgmt   │  │  Process     │        │
│  │                │  │ (module-lvl) │  │  Spawner     │        │
│  │ - System info  │  │ MissionState │  │              │        │
│  │ - File ops     │  │              │  │ Phase 1: Plan│        │
│  │ - Process mgmt │  │              │  │ Phase 3: Exec│        │
│  └────────────────┘  └──────────────┘  └──────────────┘        │
│                              ↓                                   │
│  Event Emitters                                                  │
│  - mission:status, mission:log, mission:agent-spawned, etc.     │
│                              ↓                                   │
├─────────────────────────────────────────────────────────────────┤
│                    External Services                              │
│  ┌─────────────────────┐  ┌──────────────────────────┐          │
│  │ Claude CLI Process  │  │ File System              │          │
│  │                     │  │ - ~/.claude/             │          │
│  │ Phase 1 (planning)  │  │ - Project files          │          │
│  │ - No permissions    │  │ - History & Snapshots    │          │
│  │                     │  │                          │          │
│  │ Phase 3 (execution) │  │ Permissions:             │          │
│  │ - --dangerously-    │  │ - Read/Write project     │          │
│  │   skip-permissions  │  │ - Read/Write ~/.claude   │          │
│  └─────────────────────┘  └──────────────────────────┘          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Architecture Decisions

1. **Dual Process Model**
   - **Phase 1 (Planning)**: Lightweight Claude process to analyze requirements
   - **Phase 3 (Execution)**: Full-featured Claude process with team spawning

2. **Event-Driven Updates**
   - All state changes propagate via Electron IPC events
   - Frontend listens for updates and re-renders
   - No polling required for real-time updates

3. **State Management**
   - **Backend**: Module-level JS objects (missionState, childProcess)
   - **Frontend**: React hooks + local listeners on Electron IPC events
   - **Persistence**: JSON files in `~/.claude/agent-teams-*`

4. **Output Parsing**
   - Regex-based parsing of Claude stdout
   - Patterns: `[AgentName]`, `Starting:`, `Completed:`, `Writing file:`

---

## IPC Commands

All commands are invoked via `window.__TAURI__.invoke(commandName, args)` or the Tauri JS library.

### 1. check_claude_available()

**Purpose**: Verify if Claude CLI is installed and accessible

**Parameters**: None

**Return Type**: `String` (version string, e.g., "0.7.2")

**Errors**: Throws error if Claude not found

**Example**:
```javascript
try {
  const version = await window.__TAURI__.invoke('check_claude_available');
  console.log(`Claude CLI version: ${version}`);
} catch (error) {
  console.error('Claude not available:', error);
}
```

**Behavior**:
- Executes `claude --version` command
- Parses output to extract version number
- Returns version string if successful

---

### 2. get_system_info()

**Purpose**: Retrieve system configuration and Claude setup status

**Parameters**: None

**Return Type**: `JSON Object`

**Returns**:
```typescript
{
  claude_available: boolean,      // Is Claude CLI installed?
  settings_path: string,          // Path to settings (~/.claude)
  settings_exist: boolean,        // Do settings already exist?
  agent_teams_enabled: boolean,   // Is agent-teams feature enabled?
  platform: string,               // "linux" | "darwin" | "win32"
  username: string                // Current user
}
```

**Example**:
```javascript
const sysInfo = await window.__TAURI__.invoke('get_system_info');
console.log(sysInfo);
// Output:
// {
//   claude_available: true,
//   settings_path: "/home/user/.claude",
//   settings_exist: true,
//   agent_teams_enabled: true,
//   platform: "linux",
//   username: "user"
// }
```

**Behavior**:
- Checks Claude CLI availability
- Checks if settings files exist in `~/.claude`
- Detects current platform and user
- Used for setup wizard and dashboard diagnostics

---

### 3. enable_agent_teams()

**Purpose**: Initialize agent teams configuration in `~/.claude`

**Parameters**: None

**Return Type**: `String` (path where settings were created)

**Returns**: Absolute path to created settings directory

**Errors**: Throws if directory creation fails or insufficient permissions

**Example**:
```javascript
const configPath = await window.__TAURI__.invoke('enable_agent_teams');
console.log(`Agent Teams enabled at: ${configPath}`);
// Output: /home/user/.claude
```

**Behavior**:
- Creates `~/.claude` directory if not exists
- Initializes required subdirectories (agents, teams, tasks)
- Creates `agent-teams-history.json` for mission history
- Returns path to created configuration

**Side Effects**:
- Modifies filesystem in home directory
- Sets up agent teams infrastructure

---

### 4. read_settings()

**Purpose**: Read existing agent teams configuration

**Parameters**: None

**Return Type**: `String` (JSON stringified settings)

**Returns**: Stringified JSON with all settings

**Errors**: Throws if settings don't exist or can't be read

**Example**:
```javascript
const settingsStr = await window.__TAURI__.invoke('read_settings');
const settings = JSON.parse(settingsStr);
console.log(settings);
```

**Behavior**:
- Reads `~/.claude/agent-teams-settings.json`
- Returns entire configuration as JSON string
- Used by frontend to validate setup

---

### 5. pick_folder(app)

**Purpose**: Open native file picker to select a folder

**Parameters**:
- `app` (String): Application context (usually "agent-teams-guide")

**Return Type**: `String` (absolute path)

**Returns**: Path user selected, empty string if cancelled

**Example**:
```javascript
const folderPath = await window.__TAURI__.invoke('pick_folder', {
  app: 'agent-teams-guide'
});
if (folderPath) {
  console.log(`Selected: ${folderPath}`);
}
```

**Behavior**:
- Opens native OS file picker dialog
- User navigates and selects folder
- Returns full absolute path
- Returns empty string if user cancels

**Platform Behavior**:
- **Windows**: Opens Windows Explorer picker
- **macOS**: Opens Finder picker
- **Linux**: Opens system file manager

---

### 6. open_folder_in_explorer(path)

**Purpose**: Open a folder in the system file manager

**Parameters**:
- `path` (String): Absolute path to folder

**Return Type**: `void` (no return)

**Errors**: Throws if path doesn't exist or file manager unavailable

**Example**:
```javascript
await window.__TAURI__.invoke('open_folder_in_explorer', {
  path: '/home/user/myproject'
});
// Opens file manager showing /home/user/myproject
```

**Behavior**:
- Executes platform-specific file manager command
- Navigates to provided folder
- Does not return a value

**Platform Behavior**:
- **Windows**: `explorer.exe /select, path`
- **macOS**: `open path`
- **Linux**: `xdg-open path`

---

### 7. scaffold_project(project_path, template_id, config)

**Purpose**: Create a new project structure using a template

**Parameters**:
- `project_path` (String): Absolute path where project will be created
- `template_id` (String): Template identifier (see Template System)
- `config` (JSON Object): Template-specific configuration

**Return Type**: `JSON Object`

**Returns**:
```typescript
{
  agent_dir: string,      // Path to created agent directory
  created_files: string[] // List of created file paths
}
```

**Example**:
```javascript
const result = await window.__TAURI__.invoke('scaffold_project', {
  project_path: '/home/user/new-project',
  template_id: 'code-review',
  config: {
    language: 'python',
    codebase_size: 'medium'
  }
});
console.log(result.created_files);
// Output: ['/home/user/new-project/.claude/agents/...', ...]
```

**Behavior**:
- Creates project directory structure
- Copies template files
- Generates agent configuration files
- Returns paths of all created files

**Supported Templates**:
- `code-review`, `feature-build`, `debug-bug`, `research`
- `migration`, `security-audit`, `documentation`, `refactor`

---

### 8. launch_in_terminal(project_path, prompt)

**Purpose**: Launch a Claude CLI process in a new terminal window with the given prompt

**Parameters**:
- `project_path` (String): Absolute path to project directory
- `prompt` (String): The prompt to send to Claude

**Return Type**: `void`

**Errors**: Throws if terminal command fails or project path invalid

**Example**:
```javascript
await window.__TAURI__.invoke('launch_in_terminal', {
  project_path: '/home/user/myproject',
  prompt: 'Review code and find bugs'
});
// Opens new terminal window with claude process running
```

**Behavior**:
- Creates command string
- Opens new terminal window (OS-specific)
- Executes `claude` with prompt in that terminal
- Terminal remains open after process completes

**Terminal Command Structure** (approximate):
```bash
cd /project/path && claude "your prompt here"
```

---

### 9. save_to_history(entry)

**Purpose**: Save a mission to the history file

**Parameters**:
- `entry` (JSON Object): Mission entry to save (MissionState)

**Return Type**: `void`

**Behavior**:
- Appends entry to `~/.claude/agent-teams-history.json`
- Maintains maximum 50 entries (FIFO rotation)
- Automatically saves on mission completion

**Example**:
```javascript
const missionEntry = {
  id: 'mission-123',
  description: 'Code review',
  project_path: '/home/user/project',
  status: 'completed',
  // ... other MissionState fields
};
await window.__TAURI__.invoke('save_to_history', { entry: missionEntry });
```

---

### 10. load_history()

**Purpose**: Load all missions from history file

**Parameters**: None

**Return Type**: `Vec<JSON>` (Array of MissionState objects)

**Returns**: Array of all saved missions (most recent first)

Each entry contains:
```typescript
{
  id: string,
  description: string,
  project_path: string,
  execution_mode: 'standard' | 'agent_teams',
  forked_from: string | null,       // Parent mission ID if forked
  forked_from_desc: string | null,   // Parent description if forked
  status: 'completed' | 'failed' | 'stopped',
  started_at: number,
  ended_at: number,
  agent_count: number,
  task_summary: string[],
  file_changes: FileChange[],
  log_count: number
}
```

**Example**:
```javascript
const history = await window.__TAURI__.invoke('load_history');
console.log(`${history.length} missions in history`);
history.forEach(mission => {
  console.log(`${mission.id}: ${mission.status}`);
});
```

**Behavior**:
- Reads `~/.claude/agent-teams-history.json`
- Parses and returns all entries
- Returns empty array if file doesn't exist
- Entries ordered by most recent first

---

### 11. delete_history_entry(index)

**Purpose**: Remove a specific mission from history

**Parameters**:
- `index` (Number): Array index of mission to delete

**Return Type**: `void`

**Example**:
```javascript
// Delete 3rd mission in history (0-indexed)
await window.__TAURI__.invoke('delete_history_entry', { index: 2 });
```

**Behavior**:
- Removes entry at specified index
- Rewrites history file
- Validates index before deletion

---

### 12. get_mission_history()

**Purpose**: Retrieve mission history (alias for load_history)

**Parameters**: None

**Return Type**: `Vec<JSON>`

**Example**: Same as `load_history()`

**Note**: Identical to `load_history()`. Use either one.

---

### 13. get_mission_detail(missionId)

**Purpose**: Retrieve detailed snapshot of a specific mission

**Parameters**:
- `missionId` (String): Mission ID to retrieve

**Return Type**: `JSON Object` (Complete MissionState)

**Returns**: Full mission state object including all logs, file changes, agents

**Example**:
```javascript
const detail = await window.__TAURI__.invoke('get_mission_detail', {
  missionId: 'mission-123'
});
console.log(detail.log); // All logs for this mission
console.log(detail.file_changes); // All file changes
```

**Behavior**:
- Reads from `~/.claude/agent-teams-snapshots/{missionId}.json`
- Returns full mission state
- Throws error if snapshot doesn't exist

**Storage**:
- Snapshots saved periodically during mission execution
- Deleted when mission deleted from history

---

### 14. launch_mission(projectPath, prompt, description, model)

**Purpose**: Initiate Phase 1 - Planning phase of mission

**Parameters**:
- `projectPath` (String): Absolute path to project
- `prompt` (String): User requirement/prompt
- `description` (String): Human-readable mission description
- `model` (String): AI model to use (e.g., "claude-opus-4-6")

**Return Type**: `JSON Object` (MissionState)

**Returns**:
```typescript
{
  id: string,                    // Unique mission ID
  description: string,
  project_path: string,
  status: "planning" | "ready",
  phase: 1,
  agents: [],                    // Empty during planning
  tasks: [],                     // Empty during planning
  log: [],                       // Planning logs
  file_changes: [],
  started_at: string,            // ISO timestamp
  raw_output: []                 // Raw Claude output
}
```

**Example**:
```javascript
const mission = await window.__TAURI__.invoke('launch_mission', {
  projectPath: '/home/user/myproject',
  prompt: 'Review code quality in main.py',
  description: 'Code Review Task',
  model: 'claude-opus-4-6'
});
console.log(`Mission created: ${mission.id}`);
```

**Behavior**:
1. Creates mission ID and state object
2. Spawns first Claude process (Phase 1)
3. Sends planning prompt to Claude
4. Captures output to identify agents and tasks
5. Emits `mission:plan-ready` event when complete
6. Returns initial mission state

**Events Emitted**:
- `mission:status {status: "running"}`
- `mission:log` (for planning output)
- `mission:plan-ready {agents[], tasks[]}` (when ready)

---

### 15. deploy_mission(agents, tasks)

**Purpose**: Initiate Phase 3 - Execution phase with spawned agents

**Parameters**:
- `agents` (Array): List of Agent objects (name, role, model, reason)
- `tasks` (Array): List of Task objects (title, description, assigned_agent)

**Return Type**: `void`

**Example**:
```javascript
const agents = [
  { name: 'code-reviewer', role: 'Senior Developer', model: 'claude-opus-4-6', model_reason: 'Complex analysis needed' },
  { name: 'error-handler', role: 'QA Engineer', model: 'claude-opus-4-6', model_reason: 'Edge case detection' }
];

const tasks = [
  {
    id: 'task-1',
    title: 'Analyze code structure',
    description: 'Review main.py for architecture',
    assigned_agent: 'code-reviewer',
    priority: 1
  },
  {
    id: 'task-2',
    title: 'Check error handling',
    description: 'Ensure all exceptions are caught',
    assigned_agent: 'code-reviewer',
    priority: 2
  },
  {
    id: 'task-3',
    title: 'Test edge cases',
    description: 'Find edge cases and write test cases',
    assigned_agent: 'error-handler',
    priority: 3
  }
];

await window.__TAURI__.invoke('deploy_mission', {
  agents,
  tasks
});
```

**Behavior**:
1. Validates agents and tasks
2. Builds complete execution prompt (via `buildDeployPrompt`)
3. Spawns second Claude process (Phase 3) with `--dangerously-skip-permissions`
4. Claude creates agent team and starts spawning agents
5. Agents begin executing tasks
6. Output parsing begins (logs, file changes, agent status)

**Events Emitted**:
- `mission:status {status: "running"}` (if not already running)
- `mission:agent-spawned` for each agent
- `mission:log` for all output
- `mission:task-update` when tasks complete
- `mission:file-change` when files created/modified

---

### 16. stop_mission()

**Purpose**: Stop the currently running mission

**Parameters**: None

**Return Type**: `void`

**Behavior**:
- Terminates current Claude process
- Sets mission status to "stopped"
- Emits `mission:status {status: "stopped"}`
- Saves mission to history

**Example**:
```javascript
await window.__TAURI__.invoke('stop_mission');
// Mission stopped, can be resumed later
```

---

### 17. reset_mission()

**Purpose**: Reset mission to initial state, clearing all progress

**Parameters**: None

**Return Type**: `void`

**Behavior**:
- Clears logs, agents, tasks, file_changes
- Keeps original prompt and description
- Sets phase back to 1
- Emits `mission:status {status: "reset"}`
- Allows restarting from planning phase

**Example**:
```javascript
await window.__TAURI__.invoke('reset_mission');
// Mission reset, can be restarted
```

---

### 18. get_mission_state()

**Purpose**: Get current mission state

**Parameters**: None

**Return Type**: `JSON Object | null`

**Returns**: Full MissionState if mission active, null otherwise

**Example**:
```javascript
const state = await window.__TAURI__.invoke('get_mission_state');
if (state) {
  console.log(`Mission ${state.id}: ${state.status}`);
} else {
  console.log('No active mission');
}
```

**Behavior**:
- Returns current MissionState object
- Null if no mission running
- Real-time view of current state

---

### 19. update_agent_model(agent_name, model)

**Purpose**: Change model for a specific agent during planning phase

**Parameters**:
- `agent_name` (String): Name of agent to update
- `model` (String): New model to use

**Return Type**: `void`

**Behavior**:
- Updates model in current mission state
- Only works during Phase 2 (PlanReview)
- Updates corresponding Task entries
- Used before calling `deploy_mission`

**Example**:
```javascript
await window.__TAURI__.invoke('update_agent_model', {
  agent_name: 'code-reviewer',
  model: 'claude-sonnet'
});
```

---

### 20. continue_mission(message, contextJson?)

**Purpose**: Send additional instructions to running mission, or fork a new mission from history

**Parameters**:
- `message` (String): Additional instruction to send agents
- `contextJson` (String, optional): JSON-stringified history snapshot — triggers **fork mode**

**Return Type**: `null` (success) or `String` (error)

**Behavior — Normal Mode** (no contextJson):
1. Builds summary from current missionState (tasks + recent logs + file changes)
2. Detects project type, builds continue prompt from template
3. Resets Lead agent status, kills old subprocess
4. Spawns new Claude process with continue prompt
5. Logs the intervention

**Behavior — Fork Mode** (contextJson provided):
1. Parses history snapshot from contextJson
2. Creates **NEW missionState** with fresh ID (`mission-{Date.now()}`)
   - `forked_from` = parent mission ID
   - `forked_from_desc` = parent mission description
   - Inherits `project_path`, `description`, `execution_mode` from parent
   - Fresh agents, tasks, log, file_changes arrays
3. Kills any running process
4. Builds rich summary from parent snapshot (tasks + logs + files)
5. Spawns new Claude process with continue prompt
6. New mission appears in history with fork badge upon completion

**Example — Normal Intervention**:
```javascript
await window.__TAURI__.invoke('continue_mission', {
  message: 'Please add comprehensive error handling to all functions'
});
// Agents receive instruction and adjust their work
```

**Example — Fork from History**:
```javascript
const snapshot = await window.__TAURI__.invoke('get_mission_detail', { missionId: 'mission-123' });
await window.__TAURI__.invoke('continue_mission', {
  message: 'Add dark mode support',
  contextJson: JSON.stringify(snapshot)
});
// NEW mission created, linked to parent mission-123
```

**When to Use**:
- Mid-mission adjustments (normal mode)
- Clarifying requirements
- Adding additional checks
- Continuing work from a completed mission (fork mode)
- Iterating on a previous mission's output

---

## Event System

The event system uses Tauri's event channel. Frontend listens via `window.__TAURI__.event.listen()`.

### Listening to Events

```javascript
import { listen } from '@tauri-apps/api/event';

// Listen to mission status changes
const unsubscribe = await listen('mission:status', event => {
  console.log(`Status: ${event.payload.status}`);
});

// Unsubscribe when done
unsubscribe();
```

### Event Types

#### 1. mission:status

**Emitted When**: Mission status changes

**Payload**:
```typescript
{
  status: "running" | "completed" | "stopped" | "failed" | "reset",
  mission_id?: string,     // Present on fork/completion
  forked_from?: string     // Parent mission ID (present when forked from history)
}
```

**Examples**:
```javascript
// Mission started
{ status: "running" }

// Mission completed successfully
{ status: "completed" }

// User clicked stop
{ status: "stopped" }

// Error occurred
{ status: "failed" }

// User clicked reset
{ status: "reset" }
```

---

#### 2. mission:agent-spawned

**Emitted When**: A new agent is created/activated and ready

**Payload**:
```typescript
{
  agent_name: string,
  role: string,
  timestamp: string,      // ISO 8601
  model?: string,         // Agent's model ("sonnet" | "opus" | "haiku") — from user's plan selection
  reset?: boolean         // true if this is a retry after reset
}
```

**Example**:
```typescript
{
  agent_name: "code-reviewer",
  role: "Senior Developer",
  timestamp: "2026-03-05T13:45:22Z",
  model: "opus"
}
```

**Frontend handling**:
- If agent already exists in state (from plan): updates `status` to 'Working', preserves user-selected `model`
- If agent is new: adds to agents array with provided `model`
- If `reset=true`: replaces entire agents array with just this agent

---

#### 3. mission:log

**Emitted When**: Agent logs output

**Payload**:
```typescript
{
  timestamp: string,      // ISO 8601
  agent: string,          // Agent name (or "system")
  message: string,        // Log message
  log_type: "info" | "error" | "warning" | "debug" | "task-status"
}
```

**Examples**:
```typescript
// Agent spawn log
{
  timestamp: "2026-03-05T13:45:22Z",
  agent: "code-reviewer",
  message: "Agent spawned and ready",
  log_type: "info"
}

// Task start
{
  timestamp: "2026-03-05T13:45:25Z",
  agent: "code-reviewer",
  message: "Starting: Analyze code structure",
  log_type: "task-status"
}

// Task completion
{
  timestamp: "2026-03-05T13:46:10Z",
  agent: "code-reviewer",
  message: "Completed: Found 3 issues in main.py",
  log_type: "task-status"
}

// Error
{
  timestamp: "2026-03-05T13:47:00Z",
  agent: "code-reviewer",
  message: "Permission denied accessing /restricted/file",
  log_type: "error"
}
```

---

#### 4. mission:file-change

**Emitted When**: Agent creates, modifies, or deletes a file

**Payload**:
```typescript
{
  path: string,           // Relative or absolute file path
  action: "create" | "modify" | "delete",
  agent: string,          // Agent that made change
  timestamp: string       // ISO 8601
}
```

**Examples**:
```typescript
// File created
{
  path: "src/test_main.py",
  action: "create",
  agent: "error-handler",
  timestamp: "2026-03-05T13:46:15Z"
}

// File modified
{
  path: "src/main.py",
  action: "modify",
  agent: "code-reviewer",
  timestamp: "2026-03-05T13:47:02Z"
}

// File deleted
{
  path: "old_config.ini",
  action: "delete",
  agent: "cleanup-agent",
  timestamp: "2026-03-05T13:47:45Z"
}
```

---

#### 5. mission:task-update

**Emitted When**: A task changes status

**Payload**:
```typescript
{
  agent: string,
  description: string,
  status: "started" | "in-progress" | "completed" | "failed",
  timestamp: string
}
```

**Examples**:
```typescript
// Task started
{
  agent: "code-reviewer",
  description: "Analyze code structure",
  status: "started",
  timestamp: "2026-03-05T13:45:25Z"
}

// Task completed
{
  agent: "code-reviewer",
  description: "Check error handling",
  status: "completed",
  timestamp: "2026-03-05T13:46:45Z"
}
```

---

#### 6. mission:raw-line

**Emitted When**: Raw output line from Claude process

**Payload**:
```typescript
{
  line: string            // Raw stdout line from Claude CLI
}
```

**Use Case**: For debugging or detailed log analysis

**Example**:
```typescript
{
  line: "[code-reviewer] Starting to analyze codebase structure..."
}
```

---

#### 7. mission:plan-ready

**Emitted When**: Phase 1 planning completes and agents/tasks are identified

**Payload**:
```typescript
{
  agents: Agent[],
  tasks: Task[]
}
```

**Example**:
```typescript
{
  agents: [
    {
      name: "code-reviewer",
      role: "Senior Developer",
      status: "ready",
      model: "claude-opus-4-6",
      model_reason: "Complex code analysis"
    },
    {
      name: "error-handler",
      role: "QA Engineer",
      status: "ready",
      model: "claude-opus-4-6",
      model_reason: "Edge case detection"
    }
  ],
  tasks: [
    {
      id: "task-1",
      title: "Analyze code structure",
      description: "Review main.py for architecture patterns",
      assigned_agent: "code-reviewer",
      status: "pending",
      priority: 1
    },
    {
      id: "task-2",
      title: "Check error handling",
      description: "Ensure all exceptions are caught",
      assigned_agent: "code-reviewer",
      status: "pending",
      priority: 2
    }
  ]
}
```

---

## Frontend Hooks API

### useMission Hook

Provides mission state management and control functions.

**Location**: `src/hooks/useMission.js`

**Usage**:
```javascript
import { useMission } from '../hooks/useMission';

function MyComponent() {
  const {
    missionState,
    isRunning,
    planReady,
    launch,
    deploy,
    continueM,
    stop,
    reset
  } = useMission();

  // Use hook data and functions
}
```

#### State Properties

**`missionState`** (Object | null)
- Current MissionState object
- Null if no active mission

**`isRunning`** (Boolean)
- True if mission in progress
- False if idle, completed, or stopped

**`planReady`** (Boolean)
- True if planning phase complete and agents/tasks identified
- False otherwise

#### Control Methods

##### `launch(config)`

**Purpose**: Start Phase 1 (planning)

**Parameters**:
```typescript
{
  projectPath: string,     // Absolute path to project
  prompt: string,          // User requirement
  description: string,     // Mission description
  model: string           // Model to use
}
```

**Returns**: Promise<MissionState>

**Example**:
```javascript
await launch({
  projectPath: '/home/user/myproject',
  prompt: 'Review code quality',
  description: 'Code Review Task',
  model: 'claude-opus-4-6'
});
```

---

##### `deploy(agents, tasks)`

**Purpose**: Start Phase 3 (execution)

**Parameters**:
- `agents`: Array of Agent objects
- `tasks`: Array of Task objects

**Returns**: Promise<void>

**Example**:
```javascript
const agents = [
  {
    name: 'code-reviewer',
    role: 'Senior Developer',
    model: 'claude-opus-4-6',
    model_reason: 'Complex analysis'
  }
];

const tasks = [
  {
    id: 'task-1',
    title: 'Analyze structure',
    description: 'Review architecture',
    assigned_agent: 'code-reviewer',
    priority: 1
  }
];

await deploy(agents, tasks);
```

---

##### `continueM(message)`

**Purpose**: Send instruction to running mission

**Parameters**:
- `message` (String): Instruction to send

**Returns**: Promise<void>

**Example**:
```javascript
await continueM('Add type hints to all functions');
```

---

##### `stop()`

**Purpose**: Stop running mission

**Returns**: Promise<void>

**Example**:
```javascript
await stop();
```

---

##### `reset()`

**Purpose**: Reset mission to initial state

**Returns**: Promise<void>

**Example**:
```javascript
await reset();
```

---

## Data Structures

### MissionState

Main state object for a mission.

```typescript
interface MissionState {
  // Identifiers
  id: string;                           // Unique mission ID
  description: string;                  // Human-readable description
  project_path: string;                 // Path to project being worked on

  // Status
  status: "planning" | "ready" | "running" | "completed" | "stopped" | "failed" | "reset";
  phase: 1 | 2 | 3 | 4;                // Current phase

  // Agents and Tasks
  agents: Agent[];                      // List of agents (empty until planning completes)
  tasks: Task[];                        // List of tasks (empty until planning completes)

  // Execution Data
  log: LogEntry[];                      // All log messages
  file_changes: FileChange[];           // All file modifications

  // Timing
  started_at: string;                   // ISO 8601 timestamp

  // Raw Output
  raw_output: string[];                 // Raw stdout lines from Claude process
}
```

### Agent

Represents an AI agent in the team.

```typescript
interface Agent {
  name: string;                         // Unique agent name (e.g., "code-reviewer")
  role: string;                         // Agent role (e.g., "Senior Developer")
  status: "spawned" | "ready" | "working" | "completed" | "failed";
  current_task?: string;                // Current task ID (if working)
  spawned_at?: string;                  // ISO 8601 timestamp
  model: string;                        // AI model being used
  model_reason: string;                 // Why this model was selected
}
```

### Task

Represents a task to be executed.

```typescript
interface Task {
  id: string;                           // Unique task ID
  title: string;                        // Short task name
  description?: string;                 // Detailed description
  assigned_agent: string;               // Agent name assigned to this task
  status: "pending" | "started" | "in-progress" | "completed" | "failed";
  started_at?: string;                  // ISO 8601 timestamp
  completed_at?: string;                // ISO 8601 timestamp
  priority: number;                     // 1 = highest priority
}
```

### LogEntry

Represents a log message.

```typescript
interface LogEntry {
  timestamp: string;                    // ISO 8601 timestamp
  agent: string;                        // Agent name (or "system")
  message: string;                      // Log message
  log_type: "info" | "error" | "warning" | "debug" | "task-status";
}
```

### FileChange

Represents a file operation.

```typescript
interface FileChange {
  path: string;                         // File path (relative or absolute)
  action: "create" | "modify" | "delete";
  agent: string;                        // Agent that made the change
  timestamp: string;                    // ISO 8601 timestamp
}
```

---

## Template System

### Available Templates

| ID | Name | Purpose |
|----|------|---------|
| `code-review` | Code Review | Review code quality, find issues |
| `feature-build` | Feature Build | Implement new feature |
| `debug-bug` | Debug Bug | Find and fix bug |
| `research` | Research | Research technology/approach |
| `migration` | Migration | Migrate code to new stack |
| `security-audit` | Security Audit | Check for security issues |
| `documentation` | Documentation | Write/update docs |
| `refactor` | Refactor | Improve code quality |

### Template Structure

Each template has:
1. **Template ID**: Used in `scaffold_project` and Playground
2. **Planning Prompt**: Initial prompt for Phase 1
3. **Default Agents**: List of agents to spawn
4. **Sample Tasks**: Initial task list
5. **Instructions**: Special instructions for agents

### Adding Custom Templates

To add a new template:

1. **Create template configuration** in template system:
```javascript
{
  id: 'my-template',
  name: 'My Custom Template',
  description: 'Description of template',
  planning_prompt: 'Template for Phase 1 prompt building...',
  default_agents: [
    { role: 'Agent Role', skills: ['skill1', 'skill2'] }
  ],
  default_tasks: [
    { title: 'Task 1', description: 'Do something' }
  ]
}
```

2. **Register in Playground** component:
```javascript
const TEMPLATES = [
  // ... existing templates
  {
    id: 'my-template',
    name: 'My Custom Template',
    icon: 'icon-class',
    description: 'Description'
  }
];
```

3. **Use in Playground**: Will appear as new card

---

## Mission Flow Diagrams

### Complete Mission Flow

```
USER STARTS MISSION
        ↓
    LAUNCHER PHASE
    ┌───────────────────────────────┐
    │ - User fills form             │
    │ - Select project folder       │
    │ - Enter prompt                │
    │ - Choose model                │
    │ - Click "Start"               │
    └───────────────────────────────┘
        ↓
  INVOKE: launch_mission()
        ↓
  PHASE 1: PLANNING (First Claude Process)
    ┌───────────────────────────────┐
    │ - Claude analyzes prompt      │
    │ - Reviews project structure   │
    │ - Creates agent list          │
    │ - Creates task list           │
    │ - Extracts dependencies       │
    └───────────────────────────────┘
        ↓
  EMIT: mission:plan-ready
        ↓
    PLAN REVIEW PHASE
    ┌───────────────────────────────┐
    │ - Display agents              │
    │ - Display tasks               │
    │ - User edits if needed:       │
    │   * Change agent models       │
    │   * Reorder tasks (D&D)       │
    │   * Add custom instructions   │
    │ - Click "Next"                │
    └───────────────────────────────┘
        ↓
    PROMPT PREVIEW PHASE
    ┌───────────────────────────────┐
    │ - Build final execution prompt│
    │ - Show complete prompt text   │
    │ - User reviews                │
    │ - User clicks "Deploy"        │
    └───────────────────────────────┘
        ↓
  INVOKE: deploy_mission()
        ↓
  PHASE 3: EXECUTION (Second Claude Process)
    ┌───────────────────────────────┐
    │ - Spawn first Claude process  │
    │ - Send full execution prompt  │
    │ - Agents receive role + tasks │
    │ - Agents begin executing      │
    └───────────────────────────────┘
        ↓
    DASHBOARD MONITORING PHASE
    ┌───────────────────────────────┐
    │ - Parse real-time output      │
    │ - Extract agent logs          │
    │ - Extract task status         │
    │ - Extract file changes        │
    │ - Display in real-time        │
    │ - User can:                   │
    │   * Send continue_mission()   │
    │   * Click stop_mission()      │
    │   * Click reset_mission()     │
    └───────────────────────────────┘
        ↓
    MISSION COMPLETE
    ┌───────────────────────────────┐
    │ - Claude process ends         │
    │ - All logs collected          │
    │ - All file changes recorded   │
    │ - Save to history             │
    │ - Emit mission:status         │
    │   {status: "completed"}       │
    └───────────────────────────────┘
```

### Event Flow During Execution

```
CLAUDE PROCESS RUNNING
        ↓
[Agent Name] Agent spawned...
        ↓ PARSE ↓
EMIT: mission:agent-spawned
{agent_name, role, timestamp}
        ↓
        ├─→ UPDATE: agent status to "ready"
        └─→ UPDATE: Task list view
        ↓
[Agent Name] Starting: Task description
        ↓ PARSE ↓
EMIT: mission:task-update
{agent, description, status: "started"}
        ↓
[Agent Name] Writing file: /path/to/file
        ↓ PARSE ↓
EMIT: mission:file-change
{path, action: "create", agent, timestamp}
        ↓
[Agent Name] Completed: Task description
        ↓ PARSE ↓
EMIT: mission:task-update
{agent, description, status: "completed"}
        ↓
(REPEAT FOR EACH AGENT/TASK)
        ↓
(All agents complete, Claude process exits)
        ↓
EMIT: mission:status
{status: "completed"}
```

### State Machine

```
                  ┌────────────────────┐
                  │   INITIAL (null)   │
                  └────────┬───────────┘
                           │
                    launch_mission()
                           ↓
                  ┌────────────────────┐
                  │   PLANNING         │
                  │ status: "planning" │
                  │ phase: 1           │
                  └────────┬───────────┘
                           │
                  (plan-ready event)
                           ↓
                  ┌────────────────────┐
     ┌────────────→│   READY            │←─────────┐
     │            │ status: "ready"    │          │
     │            │ phase: 2           │          │
     │            └────────┬───────────┘          │
     │                     │                      │
     │             (user edits plan)              │
     │           update_agent_model()             │
     │                     │                      │
     │          deploy_mission()                  │
     │                     ↓                      │
     │            ┌────────────────────┐          │
     │            │   RUNNING          │          │
     │            │ status: "running"  │          │
     │  continue  │ phase: 3 or 4      │          │
     │   stop()   └────────┬───────────┘          │
     │                     │                      │
     │        ┌────────────┼────────────┐         │
     │        │            │            │        │
     │        │ (complete) │ (error)    │        │
     │        ↓            ↓            ↓        │
     │    ┌──────┐    ┌───────┐   ┌────────┐   │
     │    │DONE  │    │FAILED │   │STOPPED │   │
     │    └──────┘    └───────┘   └────────┘   │
     │                                          │
     └──────────── reset_mission() ─────────────┘
                      (go back to READY)
```

---

## Key Design Decisions

### 1. Dual Process Architecture

**Decision**: Use two separate Claude processes

**Rationale**:
- Phase 1 (planning): Quick analysis without side effects, no special permissions needed
- Phase 3 (execution): Full team coordination with file system access via `--dangerously-skip-permissions`
- Separating concerns allows better error handling and cleaner state management

**Trade-offs**:
- More complex state management
- But allows interruption and modification before execution

---

### 2. Event-Driven State Updates

**Decision**: All state changes propagate via Tauri events

**Rationale**:
- Real-time updates without polling
- Decouples components
- Supports undo/replay of state changes
- Backend state updates trigger frontend updates automatically

---

### 3. Output Parsing via Regex

**Decision**: Parse Claude stdout using regex patterns

**Rationale**:
- Simple pattern matching is reliable
- Patterns: `[AgentName]`, `Starting:`, `Completed:`, `Writing file:`
- No need for complex Claude parsing, just look for structured output

---

### 4. History Persistence

**Decision**: Keep JSON history file with max 50 entries

**Rationale**:
- Lightweight, human-readable format
- Snapshots allow replaying missions
- FIFO rotation prevents unbounded growth
- Located in `~/.claude/` for accessibility

---

### 5. React Hooks for State Management

**Decision**: Use React hooks + Tauri event listeners

**Rationale**:
- Simple, familiar pattern for React developers
- Hooks handle side-effects (event listeners)
- No need for complex state library (Redux, etc.)
- Event listeners auto-cleanup via dependencies

---

## Integration Guide

### Embedding in Your App

To integrate useMission hook:

```javascript
import { useMission } from './hooks/useMission';

function MyMissionComponent() {
  const { missionState, isRunning, launch } = useMission();

  const handleLaunch = async () => {
    await launch({
      projectPath: '/home/user/project',
      prompt: 'Your requirement here',
      description: 'Task description',
      model: 'claude-opus-4-6'
    });
  };

  return (
    <div>
      <button onClick={handleLaunch} disabled={isRunning}>
        {isRunning ? 'Running...' : 'Start Mission'}
      </button>
      {missionState && <p>Status: {missionState.status}</p>}
    </div>
  );
}
```

### Listening to All Events

```javascript
import { listen } from '@tauri-apps/api/event';

async function setupMissionListeners() {
  const events = [
    'mission:status',
    'mission:agent-spawned',
    'mission:log',
    'mission:file-change',
    'mission:task-update',
    'mission:plan-ready'
  ];

  for (const eventName of events) {
    await listen(eventName, (event) => {
      console.log(`${eventName}:`, event.payload);
    });
  }
}
```

### Custom UI Components

```javascript
// Real-time log viewer
function MissionLogs({ missionState }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const handleLog = async () => {
      const unsubscribe = await listen('mission:log', (event) => {
        setLogs(prev => [...prev, event.payload]);
      });
      return unsubscribe;
    };

    handleLog();
  }, []);

  return (
    <div>
      {logs.map((log, i) => (
        <div key={i}>
          [{log.timestamp}] {log.agent}: {log.message}
        </div>
      ))}
    </div>
  );
}
```

---

## Appendix: Command Reference Quick Lookup

| Command | Phase | Purpose |
|---------|-------|---------|
| `check_claude_available()` | Setup | Verify Claude CLI |
| `get_system_info()` | Setup | Get system config |
| `enable_agent_teams()` | Setup | Initialize agent teams |
| `pick_folder()` | UI Helper | Open file picker |
| `launch_mission()` | 1 | Start planning |
| `deploy_mission()` | 3 | Start execution |
| `stop_mission()` | Any | Stop mission |
| `reset_mission()` | Any | Reset mission |
| `continue_mission()` | 3 | Send instruction |
| `get_mission_state()` | Any | Get current state |
| `update_agent_model()` | 2 | Change model |
| `load_history()` | Any | Get all missions |
| `get_mission_detail()` | Any | Get mission snapshot |

---

**Document Version**: 1.0
**Last Updated**: 2026-03-05
**Next Review**: 2026-04-05
