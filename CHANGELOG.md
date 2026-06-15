# Changelog

Tất cả thay đổi đáng chú ý của dự án Agent Teams Guide được ghi nhận tại đây.

Format dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

---

## [0.5.0] — 2026-06-03

### Đã sửa — Bugs & Cleanup
- **Fix bug nghiêm trọng**: `useAgentTeams` undefined trong `continue_mission` — file watcher không bao giờ start ở Agent Teams mode khi dùng Continue. Fix: dùng `execMode === 'agent_teams'`
- **Xóa debug code khỏi production**: Bỏ `openDevTools()` trên main window và webview, xóa toàn bộ `[DEBUG]` console logs trong `main.cjs`

### Refactor
- **`buildMissionSummary()`**: Extract helper function thay thế 3 đoạn code trùng lặp (trong `launch_mission`, `continue_mission` fork path, `continue_mission` normal path)
- **`collectFiles()` tái sử dụng**: Thay inline `scanDir` function trong `readProcessStdout_deploy` bằng `collectFiles` có sẵn

### Tài liệu
- Cập nhật toàn bộ CHANGELOG, README, USER_GUIDE theo version
- Tạo git tags cho tất cả các version milestone (v0.1.0 – v0.5.0)

---

## [0.4.0] — 2026-05-30

### Thêm mới — Virtual Office (Pixel Agents)
- **Pixel Agents Webview**: Thay thế hoàn toàn CSS canvas bằng `<webview>` nhúng pixel-art animation — agent characters di chuyển real-time trên office floor theo mission state
- **`pixelAgentsProtocol.js`**: Translation layer giữa `missionState` (Electron) và định dạng native của pixel-agents; có test coverage
- **`useAgentSync` hook**: Bridge state từ mission events sang pixel-agents protocol — agent di chuyển, ngồi vào desk, nói chuyện bubble khi tool đang chạy
- **TileEditor**: Chỉnh sửa office layout tương tác — thêm/bớt/đổi tile, Undo/Redo, export JSON
- **IPC handlers mới**: `pa:save-layout`, `pa:save-seats`, `load_office_layout` (pixel-agents native format)
- **Webview preload**: Mock `acquireVsCodeApi` + inject asset paths để pixel-agents webview hoạt động trong Electron sandbox
- **Default layout**: Bundle sẵn `default-layout-1.json` làm fallback khi chưa có layout lưu

### Đã sửa
- Fix pixel-agents không render agent characters — gửi đúng native layout format
- Fix webview reload khi mission start để `webviewReady` event re-fire
- Fix webview-preload không hoạt động trong sandbox mode
- Fix global CSP hook làm vỡ main renderer
- Fix canvas blank — dynamic tileSize và correct ResizeObserver
- Disable `AGENT_TEAMS` env trong planning phase (Lead phải output JSON plan thay vì spawn agents ngay)
- Enable `AGENT_TEAMS` trong deploy/continue phases để Lead có Agent tool

### Kỹ thuật
- Pixel-agents webview-ui dist bundled tại `src/assets/pixel-agents-webview/`
- Build script: `node scripts/build-pixel-agents.cjs` để rebuild webview từ nguồn
- Vitest test runner thay thế custom test runner; 48 tests (4 test files)

---

## [0.3.0] — 2026-04-17

### Thêm mới — Deep Plan Mode
- **Deep Plan** (chế độ permission thứ 4): Thêm Phase 0 brainstorming trước khi lên plan — Lead chạy superpowers brainstorming skill, tự động đặt câu hỏi làm rõ yêu cầu trước khi ra kế hoạch chi tiết
- **`read_superpowers_skill` IPC handler**: Tự động tìm và đọc SKILL.md từ thư mục plugins cache, hỗ trợ semver sort để lấy version mới nhất
- **Phase 0 self-contained**: Phase 0 block Phase 1 hoàn toàn cho đến khi Q&A xong; deep_plan mode luôn bắt buộc Q&A

### Thêm mới — Prompt Preview Verbatim
- **PromptPreview verbatim path**: Khi user đã xem preview và chỉnh sửa prompt, `deploy_mission` dùng đúng prompt đó (verbatim) thay vì rebuild từ task list
- **`buildAgentPrompt()`**: Helper function tại `src/data/planMarkdown.js` build full agent prompt từ template, task list, skill file, và custom instructions
- **agentPrompts map**: Frontend truyền `agentPrompts` riêng qua IPC để backend không cần rebuild

### Thêm mới — Crash-safe Persistence
- **Auto-save snapshot**: Mission state được lưu mỗi 10 giây vào `~/.claude/agent-teams-snapshots/`
- **Crash recovery**: `get_incomplete_missions` scan snapshots tìm missions chưa hoàn thành (< 7 ngày tuổi)
- **Resizable agent sidebar**: Panel tỷ lệ được lưu vào localStorage

### Đã sửa
- Fix stale closure trong PlanReview agent sync useEffect
- Fix Q&A resume — file watcher restart sau khi answer question trong agent_teams mode
- Fix Phase 0 không block Phase 1: planning process bị kill ngay khi plan JSON được phát hiện

---

## [0.2.0] — 2026-03-20

### Added — Agent Question Protocol
- **Permission Mode selector**: 3 modes — Auto-pilot (default), Interactive, Plan Only
- **Interactive mode**: Lead agent can pause and ask questions when lacking critical info
  - Marker-based protocol: `<<<QUESTION>>>...<<<END_QUESTION>>>...<<<QUESTIONS_END>>>`
  - Backend parses markers from assistant text blocks in stream-json output
  - Stdin kept open for interactive mode (closed for auto mode)
- **QuestionCard UI**: Multi-question support with tabs, option buttons, free text, skip, submit
  - Browser notification when questions arrive while tab is unfocused
  - Amber-themed card matches VS Code dark theme
  - Shows answered count badge on question tabs
- **Auto mode**: Questions auto-resolved with `__AUTO__` answer, Lead continues autonomously
- **answer_question IPC handler**: Writes user answers back to Claude stdin via `<<<ANSWER>>>` markers
- **Question history**: All Q&A pairs stored in `missionState.question_history` for history replay
- **Prompt injection**: `{{PERMISSION_MODE}}` placeholder in all 4 deploy/continue prompt templates
  - Auto mode: "AUTONOMOUS MODE" — make all decisions independently
  - Interactive mode: Full question protocol instructions with JSON format spec
- **Permission mode persistence**: localStorage saves last-used permission mode

### Changed
- Continue from History giờ đi qua full lifecycle (Planning → ReviewPlan → Deploy) thay vì skip thẳng vào execution
- `continue_mission` chỉ còn dùng cho intervention trên mission đang chạy (không còn xử lý fork)
- Prompt continue chia thành 2 template riêng: `continue_agent_teams.md` và `continue_standard.md`
- InterventionPanel disabled khi có pending questions (tránh conflict)
- `deploy_mission` và `continue_mission` giữ stdin open khi interactive mode
- `launch_mission` nhận thêm `permissionMode` argument
- `missionState` thêm `permission_mode`, `question_history`, `pendingQuestions`
- Preload whitelist thêm `answer_question` command và `mission:question`, `mission:answer-sent` events

---

## [0.1.0] — 2026-03-14

### Added — Core Mission Engine
- **Mission lifecycle đầy đủ**: Planning → ReviewPlan → PromptPreview → Deploy → Execution → Done
- **2 execution modes**: `agent_teams` (Claude Agent Teams với TeamCreate/SendMessage) và `standard` (Agent tool trực tiếp)
- **Planning phase**: Lead agent phân tích requirement, output JSON plan với agents + tasks
- **PlanReview UI**: User chỉnh sửa agents (thêm/bớt/đổi tên/đổi model), chỉnh sửa tasks (thêm/bớt/sửa detail), drag-and-drop thứ tự
- **PromptPreview**: Xem và chỉnh raw prompt cho từng agent trước khi deploy
- **Deploy phase**: Spawn Claude CLI process với đúng execution mode + project-specific prompts
- **Replan**: Yêu cầu Lead lên plan lại nếu plan đầu không ổn
- **Intervention Panel**: Chat với Lead khi mission đang chạy, gửi hướng dẫn mới
- **Stop Mission**: Dừng mission bất cứ lúc nào, kill tất cả child processes

### Added — Agent Management
- **Agent model sync**: Model user chọn ở PlanReview được truyền chính xác qua deploy → agent-spawned events → Dashboard
- **Model choices**: sonnet (default), opus (complex reasoning), haiku (simple tasks)
- **AgentCard**: Hiển thị tên, role, model, status, current task cho từng agent
- **Auto-detect agent roles**: Tự suy luận role từ tên agent (e.g., "backend-api" → Backend Developer)

### Added — Continue from History (Fork)
- **Full lifecycle fork**: Chọn mission cũ trong History → nhập yêu cầu mới → Lead lên plan mới dựa trên context cũ → user review → deploy
- **Previous Work injection**: Tự động tóm tắt tasks (completed/in-progress/pending), recent logs, file changes từ mission cũ và inject vào planning prompt
- **`forked_from` tracking**: Mission mới ghi nhận ID + description của mission gốc
- **Forked badge**: History panel hiển thị badge "↳ từ: <parent>" cho missions được fork
- **History view mode**: Xem read-only (`view`) hoặc xem + continue (`continue`)

### Added — Project Intelligence
- **Auto-detect project type**: Nhận diện Node.js/Vite, Next.js, Python, Rust, Go, Java từ filesystem (package.json, requirements.txt, Cargo.toml, etc.)
- **Project-specific build gates**: Deploy prompt tự inject hướng dẫn build/verify phù hợp (e.g., `npm run build` cho Vite, `cargo build` cho Rust)
- **Vietnamese detection**: Tự detect requirement tiếng Việt → inject LANGUAGE REQUIREMENT rule buộc agents viết UI text tiếng Việt, dùng Unicode font cho PDF
- **`--dangerously-skip-permissions`**: Launch phase luôn set flag này để Claude CLI không bị block ở non-interactive mode

### Added — Prompt System
- **External prompt templates**: Tất cả prompts là `.md` files trong `electron/prompts/`, dễ chỉnh sửa mà không cần rebuild
  - `planning.md` — Phase 1: Lead phân tích + output plan JSON
  - `deploy_agent_teams.md` — Phase 3 (agent_teams mode): spawn team với TeamCreate
  - `deploy_standard.md` — Phase 3 (standard mode): spawn agents với Agent tool
  - `continue_agent_teams.md` — Continue intervention (agent_teams mode)
  - `continue_standard.md` — Continue intervention (standard mode)
  - `replan.md` — Replan request
- **`buildMissionPrompt()`**: Frontend wrapper thêm language hint, reference materials, team hint vào planning template
- **Reference materials**: User có thể drag-drop files/folders/images vào launcher, nội dung được inline vào prompt
- **@mention**: Gõ `@` trong requirement textarea để tìm và attach files từ project

### Added — Mission Dashboard
- **Real-time log stream**: Parse Claude CLI stream-json output, hiển thị logs theo agent
- **File changes tracking**: Detect file writes/edits từ agent output, hiển thị danh sách files changed
- **Agent status board**: Hiển thị tất cả agents với status (Spawning/Working/Idle/Done/Error)
- **Elapsed timer**: Đếm thời gian mission đang chạy
- **Raw output panel**: Xem raw stdout/stderr từ Claude CLI process
- **Task tracking**: Hiển thị tasks với status (pending/in_progress/completed) và assigned agent

### Added — History & Persistence
- **Mission history**: Tự động lưu completed/stopped/failed missions vào `~/.agent-teams-guide/history/`
- **Full state snapshot**: Lưu toàn bộ agents, tasks, logs, file_changes, raw_output
- **View history**: Click vào history entry để xem full dashboard read-only
- **Delete history**: Xóa entries không cần thiết
- **Reuse from history**: Click entry cũ để pre-fill launcher form

### Added — UI/UX
- **VS Code dark theme**: Toàn bộ UI dùng VS Code color palette
- **Sidebar navigation**: Mission Control, Dashboard, Playground, Docs, Settings
- **Onboarding page**: Hướng dẫn setup Claude CLI + API key lần đầu
- **Docs page**: Nhúng ARCHITECTURE.md, USER_GUIDE.md, FUNCTION_REFERENCE.md trực tiếp trong app
- **Playground page**: Test Claude CLI commands trực tiếp
- **Responsive layout**: Sidebar collapse trên mobile
- **Drag region**: Custom title bar với drag support

### Added — Build & Distribution
- **Electron + Vite**: Frontend React/Vite + Electron main process
- **Windows build**: `npm run electron:build` → NSIS installer + portable unpacked
- **Patch system**: `node scripts/build-patch.cjs` → zip chỉ chứa `app.asar` + prompts + apply/rollback `.bat`
- **Auto-update prompts**: Patch zip include latest prompt templates

### Added — Testing & QA
- **123 static analysis tests**: `node tests/run_all.cjs` kiểm tra source code structure, data flow, edge cases
- **CDP QC scripts**: Test live app qua Chrome DevTools Protocol (port 9222)
- **Filter support**: `node tests/run_all.cjs --filter=fork` để chạy subset tests

### Added — Documentation
- **USER_GUIDE.md** (tiếng Việt): Hướng dẫn sử dụng đầy đủ với screenshots flow
- **FUNCTION_REFERENCE.md** (English): Technical reference cho 20 IPC commands, events, data structures
- **ARCHITECTURE.md**: Kiến trúc hệ thống, data flow diagrams, state management

### Fixed
- **ReviewPlan stuck bug**: Mission kết thúc khi đang ở ReviewPlan phase → UI bị stuck. Fixed: auto-transition to Done
- **Agent Teams env flag not set in continue_mission**: Continue luôn hardcode `false` → Claude không có TeamCreate tools. Fixed: check `execution_mode`
- **Planning phase blocked**: `launch_mission` thiếu `--dangerously-skip-permissions` → Claude CLI bị block. Fixed
- **Hydration race condition**: Mission state hydration on mount có thể skip ReviewPlan states. Fixed: detect completed+ReviewPlan → auto-fix to Done

### Technical Details
- **Runtime**: Electron 33 + Node.js 22 + React 19 + Vite 7
- **State management**: React hooks (`useMission`) + batched event system (120ms flush interval, ~8 re-renders/s thay vì ~20/s)
- **IPC**: Electron `ipcMain.handle` / `ipcRenderer.invoke` (bridged via preload.cjs)
- **Process management**: `child_process.spawn` cho Claude CLI, với graceful kill (SIGTERM → 3s timeout → SIGKILL)
- **File watcher**: `setInterval` poll `.claude-agent-team/` directory cho agent_teams mode coordination files
