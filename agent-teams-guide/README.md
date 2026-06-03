# Claude Agent Teams

Ứng dụng desktop điều phối nhiều Claude AI agents làm việc song song trên cùng một project. Built with Electron + React.

> **TL;DR**: Nhập yêu cầu → AI lên kế hoạch → Bạn review/chỉnh sửa → Deploy nhiều agents làm việc đồng thời → Theo dõi real-time → Code hoàn chỉnh.

---

## Yêu cầu hệ thống

| Yêu cầu | Chi tiết |
|---------|----------|
| **OS** | Windows 10/11 (64-bit) |
| **Claude CLI** | Lệnh `claude` phải có trong PATH ([cài đặt](https://docs.anthropic.com/en/docs/claude-cli)) |
| **Anthropic API Key** | Cấu hình trong Claude CLI (`claude config`) |
| **Node.js** | >= 18 (chỉ cần khi build từ source) |

```bash
# Kiểm tra nhanh
claude --version
claude config get api_key
```

---

## Cài đặt & Chạy

### Cách 1: Build từ source (developer)

```bash
git clone <repo-url>
cd agent-teams-guide
npm install

# Dev mode (hot reload)
npm run electron:dev

# Build release (installer)
npm run electron:build
```

### Cách 2: Build patch (cập nhật nhanh)

```bash
node scripts/build-patch.cjs
# Output: release/Claude-Agent-Teams-Patch-x.x.x.zip
# Giải nén → double-click apply-patch.bat → backup + update tự động
```

---

## Tính năng chính

### Pipeline 5 bước

| Bước | Mô tả |
|------|-------|
| **1. Launch** | Nhập yêu cầu, chọn thư mục project, chọn model, đính kèm tài liệu tham khảo |
| **2. Planning** | Lead agent phân tích → đề xuất kế hoạch (danh sách agents + tasks) |
| **3. Plan Review** | Bạn review/chỉnh sửa: đổi tên agents, đổi model, sửa tasks, thêm skill files |
| **4. Deploy** | Lead spawn các agents, mỗi agent thực hiện các tasks được giao |
| **5. Monitor** | Real-time dashboard: Activity Log, Agents, Tasks, File Changes, Messages |

---

### 4 Permission Modes

Chọn ở Launcher → **Permission Mode**:

| Mode | Mô tả | Khi nào dùng |
|------|-------|-------------|
| **Auto-pilot** (mặc định) | Lead tự quyết tất cả | Hầu hết mọi task |
| **Interactive** | Lead dừng lại hỏi bạn khi thiếu thông tin quan trọng | Khi yêu cầu còn mơ hồ |
| **Plan Only** | Chỉ lên kế hoạch, không deploy | Khi bạn chỉ muốn xem plan trước |
| **Deep Plan** | Phase 0: brainstorming với superpowers skill → hỏi clarifying questions → mới lên plan | Khi yêu cầu phức tạp, cần làm rõ nhiều điểm trước |

**Deep Plan** yêu cầu [superpowers plugin](https://github.com/anthropics/superpowers) được cài đặt trong Claude CLI.

---

### 2 Execution Modes

| Mode | Mô tả | Khi nào dùng |
|------|-------|-------------|
| **Standard** (mặc định) | Lead spawn agents bằng Agent tool, chờ kết quả, tự verify | Ổn định, phù hợp đa số |
| **Agent Teams** (experimental) | Lead tạo team, agents giao tiếp real-time bằng SendMessage | Tasks cần phối hợp chặt chẽ |

---

### Chỉnh sửa Plan trước khi Deploy

- **Đổi model** từng agent: Sonnet / Opus / Haiku — được đồng bộ chính xác sang backend
- **Kéo-thả** sắp xếp lại tasks
- **Thêm/xóa** agents và tasks
- **Skill file** (.md/.txt): Load cho từng agent hoặc **Bulk Skill** cho nhiều agents cùng lúc
- **Custom instructions** per-agent
- **Prompt Preview**: Xem và chỉnh sửa prompt hoàn chỉnh trước khi gửi (verbatim mode)

---

### Continue from History (Fork)

Tiếp tục công việc từ bất kỳ mission cũ nào:

1. Mở **Mission History** → expand mission → click **"Continue mission"**
2. Xem dashboard read-only của mission cũ
3. Nhập yêu cầu mới → gửi
4. Hệ thống tạo **mission MỚI** (fork), kế thừa context từ mission gốc
5. History hiển thị badge: `↳ từ: <tên mission gốc>`

> Mission mới có ID riêng, **không ghi đè** mission cũ.

---

### Virtual Office (Pixel Agents)

Hiển thị trong MissionDashboard khi mission đang chạy — agent characters pixel-art di chuyển, ngồi vào desk, nói chuyện qua speech bubble real-time.

- **TileEditor**: Click biểu tượng ⚙️ trong Virtual Office → chỉnh sửa layout, thêm/bớt tiles, Undo/Redo
- Layout tùy chỉnh được lưu tự động vào userData

---

### Intervention (can thiệp khi đang chạy)

- **Send Message**: Gửi chỉ thị thêm cho agents khi mission đang chạy
- **Spawn thêm agents**: Định nghĩa agents mới ngay trong intervention
- **Stop / Continue**: Dừng hoặc tiếp tục mission

---

## Skill Files

Skill file = file `.md` / `.txt` chứa hướng dẫn chuyên sâu cho agents.

| Cách dùng | Mô tả |
|-----------|-------|
| **Per-agent** | Expand agent card → "Thêm custom instructions" → chọn file |
| **Bulk** | Click "Bulk Skill" → chọn file → tick agents → Apply |
| **Skill folder** | Chọn thư mục — tất cả files trong folder được bundle lại thành 1 skill |

**Ví dụ skill files:**

| File | Nội dung |
|------|---------|
| `react-conventions.md` | Coding standards, folder structure, naming |
| `api-spec.md` | OpenAPI spec — agents tạo endpoints đúng contract |
| `database-schema.md` | Schema + relations — queries chính xác |
| `testing-guide.md` | Test framework, coverage, mock patterns |
| `design-tokens.md` | Colors, spacing, typography |

---

## Tùy chỉnh Prompt

Prompt của Lead agent là các file `.md` trong `electron/prompts/` — chỉnh sửa trực tiếp mà không cần rebuild:

```
electron/prompts/
  planning.md              ← Phase 1: Lead phân tích & lên kế hoạch
  deploy_standard.md       ← Phase 3: Standard mode execution
  deploy_agent_teams.md    ← Phase 3: Agent Teams mode execution
  continue_standard.md     ← Continue / Intervention (standard)
  continue_agent_teams.md  ← Continue / Intervention (agent teams)
  replan.md                ← Yêu cầu Lead lên plan lại
```

**Template variables:**

| Variable | Giải thích |
|----------|-----------|
| `{{PROJECT_PATH}}` | Đường dẫn project |
| `{{PROJECT_TYPE}}` | Auto-detect: Node.js/Vite, Python, Rust, Go, Java |
| `{{AGENT_BLOCKS}}` | Agents + tasks + custom instructions + skill files |
| `{{LANG_RULE}}` | Quy tắc ngôn ngữ (auto-detect tiếng Việt) |
| `{{PERMISSION_MODE}}` | Hướng dẫn autonomous hoặc interactive mode |
| `{{SUMMARY}}` | Tóm tắt công việc trước đó (cho continue) |
| `{{MESSAGE}}` | Chỉ thị mới từ người dùng (cho continue) |

---

## Cấu trúc thư mục

```
agent-teams-guide/
  electron/                       # Electron backend (Node.js)
    main.cjs                      # App entry, window creation
    preload.cjs                   # IPC bridge (contextBridge)
    webview-preload.cjs           # Preload cho pixel-agents webview
    ipc/
      mission.cjs                 # Mission lifecycle: launch, deploy, continue, stop, replan
      history.cjs                 # History: load/save/delete + snapshot recovery
      files.cjs                   # File picker, folder scan, skill folder bundler
      system.cjs                  # System info, enable agent teams, open terminal
      pixelAgents.cjs             # Virtual Office: save/load layout và seats
    prompts/                      # Lead agent prompt templates (.md)

  src/                            # Frontend (React + Vite)
    hooks/
      useMission.js               # Core hook: mission state + tất cả actions
    components/office/
      bridge/
        pixelAgentsProtocol.js    # Mission state → pixel-agents format translation
      hooks/
        useAgentSync.js           # Sync agent status sang Virtual Office
    pages/
      MissionControlPage.jsx      # Mission launcher + dashboard + history
    data/
      planMarkdown.js             # buildAgentPrompt() — build full prompt từ plan

  src/assets/pixel-agents-webview/  # Pixel-agents webview UI (bundled)
    assets/
      default-layout-1.json       # Default office layout

  scripts/
    build-patch.cjs               # Build + generate patch zip
    build-pixel-agents.cjs        # Rebuild pixel-agents webview từ nguồn
```

---

## Tests

```bash
# Chạy tất cả tests
npm test

# Watch mode (tự chạy lại khi file thay đổi)
npm run test:watch
```

**48 tests / 4 test files:**

| Test file | Coverage |
|-----------|----------|
| `AgentStateMapper.test.ts` | Mission state → pixel-agents agent objects |
| `DeskAssigner.test.ts` | Agent ↔ desk slot assignment, idempotency |
| `OfficeLayoutStore.test.ts` | Layout load/save/validate |
| `pixelAgentsProtocol.test.js` | Protocol translation layer |

---

## Tài liệu

| Tài liệu | Nội dung |
|----------|----------|
| [CHANGELOG.md](CHANGELOG.md) | Lịch sử phiên bản theo version |
| [USER_GUIDE.md](USER_GUIDE.md) | Hướng dẫn sử dụng chi tiết (tiếng Việt) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Kiến trúc hệ thống, data flow, IPC events |
| [FUNCTION_REFERENCE.md](FUNCTION_REFERENCE.md) | IPC commands, events, data types |

---

## Phiên bản

| Version | Ngày | Nội dung chính |
|---------|------|---------------|
| **v0.5.0** | 03/06/2026 | Cleanup: xóa debug code, fix `useAgentTeams` bug, refactor dedup |
| **v0.4.0** | 30/05/2026 | Virtual Office: pixel-agents webview, TileEditor |
| **v0.3.0** | 17/04/2026 | Deep Plan Mode, Prompt Preview verbatim, Crash-safe persistence |
| **v0.2.0** | 20/03/2026 | Agent Question Protocol: Interactive mode, Permission modes |
| **v0.1.0** | 14/03/2026 | Core Mission Engine: Electron migration, lifecycle, fork, model sync |

Xem chi tiết tại [CHANGELOG.md](CHANGELOG.md).

---

## Kỹ thuật

- **Frontend**: React 19 + Tailwind CSS 3 + Lucide icons + React Router 7
- **Backend**: Electron 33 + Node.js IPC handlers
- **Communication**: Electron IPC (invoke/handle + webContents.send)
- **AI**: Claude CLI (`claude -p --dangerously-skip-permissions --output-format stream-json`)
- **Agent orchestration**: Claude Agent tool (subagent spawning) / TeamCreate (experimental)
- **Virtual Office**: pixel-agents webview UI (pixel-art sprites + tile-based office)
- **State**: Module-level JS objects (backend) + React hooks (frontend)
- **Build**: Vite (frontend) + electron-builder (packaging) + custom patch script

---

## Troubleshooting

### "claude: command not found"
```bash
npm install -g @anthropic-ai/claude-cli
```

### Mission bị treo ở "Planning..."
- Kiểm tra API key: `claude config get api_key`
- Kiểm tra kết nối internet
- Thử model khác (Sonnet thay vì Opus)
- Nếu lỗi "Request too large" → bỏ bớt reference materials

### Agents viết code nhưng build fail
- Thêm **skill file** với coding standards cụ thể
- Thêm custom instructions: "Run npm install && npm run build. Fix all errors before done."
- Kiểm tra project folder có quyền ghi

### Virtual Office không hiển thị agents
- Đảm bảo mission đang ở trạng thái Running
- Click ⚙️ → kiểm tra layout có đủ desk tiles
- Thử reload: dừng và restart mission

### Deep Plan không hoạt động
- Cần có [superpowers plugin](https://github.com/anthropics/superpowers) cài trong `~/.claude/plugins/`
- Kiểm tra: `ls ~/.claude/plugins/cache/claude-plugins-official/superpowers/`

---

## License

Internal tool — không phân phối công khai.
