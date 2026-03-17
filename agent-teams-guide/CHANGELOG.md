# Changelog

Tất cả thay đổi đáng chú ý của dự án Agent Teams Guide được ghi nhận tại đây.

Format dựa trên [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Changed
- Continue from History giờ đi qua full lifecycle (Planning → ReviewPlan → Deploy) thay vì skip thẳng vào execution
- `continue_mission` chỉ còn dùng cho intervention trên mission đang chạy (không còn xử lý fork)
- Prompt continue chia thành 2 template riêng: `continue_agent_teams.md` và `continue_standard.md`

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
