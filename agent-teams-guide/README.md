# Claude Agent Teams

Desktop app cho phep dieu phoi nhieu Claude AI agents lam viec song song tren cung 1 project. Built with Electron + React.

> **TL;DR**: Nhap yeu cau → AI len ke hoach → Ban review/chinh sua → Deploy nhieu agents lam viec dong thoi → Theo doi real-time → Code hoan chinh.

---

## Yeu cau he thong

| Yeu cau | Chi tiet |
|---------|----------|
| **OS** | Windows 10/11 (64-bit) |
| **Claude CLI** | `claude` command phai co trong PATH ([cai dat](https://docs.anthropic.com/en/docs/claude-cli)) |
| **Anthropic API Key** | Cau hinh trong Claude CLI (`claude config`) |
| **Node.js** | >= 18 (chi can khi build tu source) |

### Kiem tra nhanh

```bash
# Kiem tra Claude CLI da cai chua
claude --version

# Kiem tra API key
claude config get api_key
```

---

## Cai dat & Chay

### Cach 1: Installer (cho nguoi dung cuoi)

```
release/Claude Agent Teams Setup 0.1.0.exe    (86 MB, NSIS installer)
```
Double-click de cai dat. App tu tao shortcut tren Desktop.

### Cach 2: Patch (cho nguoi da cai phien ban cu)

```
release/Claude-Agent-Teams-Patch-0.1.0.zip    (6.7 MB)
```
Giai nen → double-click `apply-patch.bat` → tu dong backup + update.
Undo: double-click `rollback.bat`.

### Cach 3: Build tu source (cho developer)

```bash
git clone <repo-url>
cd agent-teams-guide
npm install

# Dev mode (hot reload)
npm run electron:dev

# Build release (installer + patch)
node scripts/build-patch.cjs
# Output: release/Claude Agent Teams Setup 0.1.0.exe
#         release/Claude-Agent-Teams-Patch-0.1.0.zip
```

---

## Tinh nang chinh

### Mission Pipeline (5 buoc)

| Buoc | Mo ta |
|------|-------|
| **1. Launch** | Nhap yeu cau, chon folder, chon model, dinh kem tai lieu |
| **2. Planning** | Lead agent phan tich → de xuat ke hoach (agents + tasks) |
| **3. Plan Review** | Ban review/chinh sua: doi ten agents, doi model, sua tasks, them skill files |
| **4. Deploy** | Lead spawn cac agents, moi agent lam cac tasks duoc giao |
| **5. Monitor** | Real-time dashboard: Activity Log, Agents, Tasks, File Changes, Messages |

### Chinh sua Plan truoc khi deploy

- Doi model cho tung agent (Sonnet/Opus/Haiku) — **duoc dong bo chinh xac** sang backend + dashboard
- Keo-tha sap xep tasks, them/xoa agents
- Load **skill file** (.md/.txt) cho tung agent hoac **Bulk Skill** cho nhieu agents
- **Custom instructions** per-agent
- **Prompt Preview**: xem prompt hoan chinh truoc khi gui

### Continue from History (Fork)

Tiep tuc cong viec tu bat ky mission cu nao:

1. Mo **Mission History** → expand mission → click **"Continue mission"**
2. Xem dashboard read-only cua mission cu + banner "Tiep tuc tu mission cu"
3. Nhap yeu cau moi vao **Intervention Panel** → gui
4. He thong tao **mission MOI** (fork), lien ket voi mission goc
5. Trong History, mission fork hien badge: `↳ tu: {ten mission goc}`

**Quan trong:** Mission moi co ID rieng, **khong ghi de** mission cu.

### Intervention (can thiep khi dang chay)

- **Send Message**: gui chi thi them cho agents
- **Spawn them agents**: dinh nghia agents moi ngay trong intervention
- **Stop / Continue**: dung hoac tiep tuc mission

### 2 Execution Modes

| Mode | Mo ta | Khi nao dung |
|------|-------|-------------|
| **Standard** (mac dinh) | Lead spawn agents bang Agent tool | On dinh, phu hop da so |
| **Agent Teams** (experimental) | Lead tao team, agents giao tiep bang SendMessage | Phuc tap, agents trao doi real-time |

---

## Tuy chinh Prompt

Prompt cua Lead agent tach thanh file `.md` rieng, de chinh sua:

```
electron/prompts/
  planning.md              ← Phase 1: Lead phan tich & len ke hoach
  deploy_standard.md       ← Phase 3: Standard mode execution
  deploy_agent_teams.md    ← Phase 3: Agent Teams mode execution
  continue_mission.md      ← Continue / Intervention
  replan.md                ← Replan (neu co)
```

### Template variables

| Variable | Giai thich | Co trong |
|----------|-----------|----------|
| `{{PROJECT_PATH}}` | Duong dan project | Tat ca |
| `{{PROJECT_TYPE}}` | Auto-detect: Node.js/Vite, Python, Rust, Go, Java | deploy_*, continue |
| `{{AGENT_BLOCKS}}` | Agents + tasks + custom instructions | deploy_* |
| `{{LANG_RULE}}` | Quy tac ngon ngu (auto-detect tieng Viet) | deploy_* |
| `{{TOTAL_AGENTS}}` | So luong agents | deploy_* |
| `{{REQUIREMENT}}` | Yeu cau nguoi dung nhap | planning |
| `{{TEAM_HINT}}` | Goi y so luong agents | planning |
| `{{REFERENCES_SECTION}}` | Tai lieu dinh kem | planning |
| `{{SUMMARY}}` | Tom tat cong viec truoc do | continue |
| `{{MESSAGE}}` | Chi thi moi tu nguoi dung | continue |

Sau khi chinh sua prompt → chay `npm run electron:dev` hoac build lai de apply.

---

## Skill Files

Skill file = file `.md`/`.txt` chua huong dan chuyen sau cho agents.

### Cach dung

1. **Per-agent**: Expand agent card → "Them custom instructions" → chon file
2. **Bulk**: Click "Bulk Skill" → chon file → tick agents → Apply

### Vi du

| File | Noi dung |
|------|---------|
| `react-conventions.md` | Coding standards, folder structure, naming |
| `api-spec.md` | OpenAPI spec — agents tao endpoints dung contract |
| `design-tokens.md` | Colors, spacing, typography |
| `testing-guide.md` | Test framework, coverage, mock patterns |
| `database-schema.md` | Schema + relations — queries chinh xac |

---

## Cau truc thu muc

```
agent-teams-guide/
  electron/                       # Electron backend (Node.js)
    main.cjs                      # App entry, window creation
    preload.cjs                   # IPC bridge (contextBridge)
    ipc/
      mission.cjs                 # Mission lifecycle: launch, deploy, continue, stop
      history.cjs                 # History load/save/delete
      files.cjs                   # File picker, folder operations
      system.cjs                  # System info, open terminal
    prompts/                      # Lead agent prompt templates
      planning.md
      deploy_standard.md
      deploy_agent_teams.md
      continue_mission.md

  src/                            # Frontend (React + Vite)
    hooks/
      useMission.js               # Core hook: mission state + actions
    pages/
      MissionControlPage.jsx      # Mission launcher + dashboard + history
    components/mission/
      MissionLauncher.jsx         # Launch form
      PlanReview.jsx              # Plan review/edit UI
      MissionDashboard.jsx        # Real-time monitoring dashboard
      MissionHistoryPanel.jsx     # Mission history list + fork badge
      InterventionPanel.jsx       # Send message / continue
      AgentCard.jsx               # Agent status card
      ActivityLog.jsx             # Real-time log viewer
      TaskList.jsx                # Task progress tracker
      FileChangesPanel.jsx        # File diff viewer
    data/
      promptWrapper.js            # Build planning prompt from template

  tests/
    run_all.cjs                   # 128 test cases (18 suites)

  scripts/
    build-patch.cjs               # Build + generate patch zip

  release/                        # Build output
    Claude Agent Teams Setup 0.1.0.exe
    Claude-Agent-Teams-Patch-0.1.0.zip
    patch/
      app.asar
      prompts/
      apply-patch.bat
      rollback.bat
```

---

## Tai lieu

| Doc | Noi dung | Ngon ngu |
|-----|----------|----------|
| [USER_GUIDE.md](USER_GUIDE.md) | Huong dan su dung chi tiet | Tieng Viet |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kien truc he thong, data flow, events | English |
| [FUNCTION_REFERENCE.md](FUNCTION_REFERENCE.md) | 20 IPC commands, events, data types | English |

---

## Tests

```bash
# Chay tat ca 128 tests (18 suites)
node tests/run_all.cjs

# Loc theo ten
node tests/run_all.cjs --filter=fork
node tests/run_all.cjs --filter=model
node tests/run_all.cjs --filter=edge
```

### Test suites

| Suite | Tests | Coverage |
|-------|-------|----------|
| Backend: fork logic | 16 | continue_mission fork flow, forked_from fields, kill/spawn |
| Backend: agent-spawned model | 3 | All emit sites include model field |
| Backend: deploy model sync | 2 | Model from PlanReview → missionState |
| Backend: history forked_from | 2 | forked_from in history entries |
| Backend: helper functions | 11 | detectProjectType, detectVietnamese, --dangerously-skip-permissions |
| Frontend: deploy() sync | 3 | Model sync after invoke |
| Frontend: agent-spawned | 6 | eventModel, existingIdx, preserve user model |
| Frontend: continueM fork | 5 | History context detection, hydration |
| Frontend: MissionControlPage | 8 | historyViewMode, continue banner |
| Frontend: HistoryPanel | 7 | GitFork badge, Continue button |
| Frontend: Dashboard | 4 | isHistoryView prop, InterventionPanel |
| Prompt templates | 10 | Files exist + placeholders verified |
| Build output | 3 | dist-electron output integrity |
| Documentation | 11 | All docs updated |
| Data flow: model | 6 | Plan → Deploy → Dashboard pipeline |
| Data flow: fork | 8 | HistoryPanel → Page → Hook → Backend |
| Edge cases | 9 | Null safety, error handling, fallbacks |
| File structure | 14 | All critical files exist |

---

## Ky thuat

- **Frontend**: React 19 + Tailwind CSS 3 + Lucide icons + React Router 7
- **Backend**: Electron 33 + Node.js IPC handlers
- **Communication**: Electron IPC (invoke/handle + webContents.send)
- **AI**: Claude CLI (`claude -p --dangerously-skip-permissions --output-format stream-json`)
- **Agent orchestration**: Claude Agent tool (subagent spawning) / TeamCreate (experimental)
- **State**: Module-level JS objects (backend) + React hooks (frontend)
- **Prompt system**: Markdown templates with `{{VAR}}` placeholders
- **Build**: Vite (frontend) + electron-builder (packaging) + custom patch script

---

## Troubleshooting

### "claude: command not found"
```bash
npm install -g @anthropic-ai/claude-cli
# Hoac: https://docs.anthropic.com/en/docs/claude-cli
```

### Mission bi treo o "Planning..."
- Kiem tra Anthropic API key: `claude config get api_key`
- Kiem tra internet
- Thu chon model khac (Sonnet thay vi Opus)

### Agents viet code nhung build fail
- Them **skill file** voi coding standards cu the
- Them custom instructions: "Run npm install && npm run build. Fix all errors before done."
- Kiem tra project folder co quyen ghi

### Model dashboard hien sai (da fix)
Model ban chon o PlanReview duoc dong bo chinh xac sang backend + dashboard.
Neu thay van sai → chay `node tests/run_all.cjs --filter=model` de verify.

---

## Changelog

### v0.1.0 (2026-03-14)

**Major: Migration Tauri → Electron**
- Toan bo backend chuyen tu Rust/Tauri sang Node.js/Electron
- Prompt templates tach ra file `.md` rieng (khong con embed trong binary)

**Features**
- Continue from History (Fork): tao mission moi tu bat ky mission cu nao
- Agent model sync: model chon o PlanReview dong bo chinh xac
- `mission:agent-spawned` event truyen model field cho tat ca emit sites
- History entries hien badge fork: `↳ tu: {parent description}`
- MissionControlPage: `historyViewMode` ('view' vs 'continue')
- Auto-detect project type: Node.js/Vite, Next.js, Python, Rust, Go, Java

**Bug Fixes**
- Fix model hien sai tren dashboard (hien model plan thay vi model chon)
- Fix agent-spawned handler skip existing agents thay vi update status
- Fix plain-text parser emit agent-spawned thieu model field
- `--dangerously-skip-permissions` cho launch_mission (fix planning phase bi block)

**Infrastructure**
- 128 test cases (18 suites) — `node tests/run_all.cjs`
- Patch system: `build-patch.cjs` tao zip nho (6.7MB) cho update nhanh
- Documentation: ARCHITECTURE.md, FUNCTION_REFERENCE.md, USER_GUIDE.md

---

## License

Internal tool — khong phan phoi cong khai.
