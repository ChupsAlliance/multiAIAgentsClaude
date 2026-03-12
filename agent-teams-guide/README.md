# Agent Teams Guide

Desktop app cho phep dieu phoi nhieu Claude AI agents lam viec song song tren cung 1 project. Built with Tauri + React.

> **TL;DR**: Nhap yeu cau → AI len ke hoach → Ban review/chinh sua → Deploy nhieu agents lam viec dong thoi → Theo doi real-time → Code hoan chinh.

---

## Yeu cau he thong

| Yeu cau | Chi tiet |
|---------|----------|
| **OS** | Windows 10/11 (64-bit) |
| **Claude CLI** | `claude` command phai co trong PATH ([cai dat](https://docs.anthropic.com/en/docs/claude-cli)) |
| **Anthropic API Key** | Cau hinh trong Claude CLI (`claude config`) |
| **WebView2** | Thuong da co san tren Windows 10/11. Neu chua co: [tai tai day](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |

### Kiem tra nhanh

```bash
# Kiem tra Claude CLI da cai chua
claude --version

# Kiem tra API key
claude config get api_key
```

---

## Cai dat & Chay

### Cach 1: Chay truc tiep (nhanh nhat)

```bash
# Copy file exe vao may
# File: src-tauri/target/release/agent-teams-guide.exe (14MB)

# Double-click de chay, hoac:
.\agent-teams-guide.exe
```

### Cach 2: Build tu source

```bash
# Clone repo
git clone <repo-url>
cd agent-teams-guide

# Cai dependencies
npm install

# Chay dev mode
npm run tauri dev

# Hoac build release
npm run tauri build
# Output: src-tauri/target/release/agent-teams-guide.exe
```

**Luu y khi build tu source**: Can co Rust toolchain (`rustup`, `cargo`). Neu chua co:
```bash
# Cai Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Hoac tren Windows, tai tu: https://rustup.rs
# Sau khi cai, khoi dong lai terminal de co cargo trong PATH
```

---

## Huong dan su dung

### Buoc 1: Tao Mission moi

1. Mo app → man hinh **Launcher**
2. Nhap **tieu de** mission (vi du: "Quiz App")
3. Nhap **yeu cau chi tiet** vao o lon (vi du: "Tao ung dung quiz ho tro single choice A,B,C,D...")
4. Chon **project folder** — noi code se duoc tao ra
5. Chon **model** cho Lead agent (Sonnet = nhanh/re, Opus = thong minh hon)
6. *(Tuy chon)* Dinh kem tai lieu tham khao: files, folders, hinh anh mockup
7. Click **"Bat dau Mission"**

### Buoc 2: Review Plan

Sau khi Lead agent phan tich xong, app hien man hinh **Plan Review**:

- **Agent cards**: Moi card = 1 agent (vi du: `frontend-ui`, `backend-api`, `test-runner`)
- **Chinh sua tuy y**:
  - Doi ten agent (click vao ten)
  - Doi model cho tung agent (Sonnet/Opus/Haiku)
  - Sua/them/xoa tasks (keo-tha de sap xep)
  - Them **custom instructions** (textarea)
  - Load **skill file** (.md/.txt) — inject coding standards, API spec, v.v.
- **Bulk Skill**: Ap dung 1 skill file cho nhieu agents cung luc
- **Prompt Preview**: Xem prompt hoan chinh truoc khi deploy

### Buoc 3: Deploy & Theo doi

Click **"Deploy Mission"** → Cac agents bat dau lam viec.

Man hinh **Mission Dashboard** hien:
- **Activity Log**: Real-time log moi hanh dong (doc file, viet code, chay lenh...)
- **Agents panel**: Trang thai tung agent (Working/Idle/Done)
- **Tasks panel**: Tien do tung task (Pending → In Progress → Completed)
- **Files panel**: Danh sach files da tao/sua — **click de xem diff** (kieu git)
- **Raw Output**: Output nguyen goc tu Claude CLI

### Buoc 4: Can thiep (neu can)

- **Send Message**: Gui chi thi them cho agents dang chay
- **Stop Mission**: Dung ngay lap tuc
- **Continue Mission**: Tiep tuc mission tu cho dung lai (co context cu)

### Buoc 5: Ket qua

Khi mission hoan thanh:
- Tat ca code nam trong project folder da chon
- README.md duoc tao tu dong
- Build/verify da chay (neu project type duoc nhan dien)

---

## Che do thuc thi (Execution Mode)

App ho tro 2 che do:

| Che do | Mo ta | Khi nao dung |
|--------|-------|-------------|
| **Standard** (mac dinh) | Lead spawn agents bang Agent tool, doi tat ca hoan thanh, roi verify | On dinh, phu hop da so truong hop |
| **Agent Teams** (experimental) | Lead tao team bang TeamCreate, agents giao tiep qua SendMessage | Phuc tap hon, agents co the trao doi voi nhau |

Chon tai man hinh Launcher (dropdown "Execution Mode").

---

## Tuy chinh Prompt cua Lead Agent

Day la phan quan trong nhat — prompt quyet dinh chat luong output.

### Prompt files

Tat ca prompt cua Lead agent duoc tach ra thanh file `.md` rieng, de chinh sua:

```
src-tauri/prompts/
  deploy_agent_teams.md    ← Prompt Phase 3: Agent Teams mode
  deploy_standard.md       ← Prompt Phase 3: Standard mode
  continue_mission.md      ← Prompt khi Continue/Intervention

src/data/prompts/
  planning.md              ← Prompt Phase 1: Lead phan tich & len ke hoach
```

### Template variables

Trong cac file `.md`, dung `{{VAR}}` de inject du lieu dong:

| Variable | Giai thich | Co trong |
|----------|-----------|----------|
| `{{PROJECT_PATH}}` | Duong dan project | Tat ca |
| `{{PROJECT_TYPE}}` | Loai project tu dong nhan dien (Node.js/Vite, Python, Rust...) | deploy_*, continue |
| `{{AGENT_BLOCKS}}` | Danh sach agents + tasks + custom instructions | deploy_* |
| `{{LANG_RULE}}` | Quy tac ngon ngu (tu dong phat hien tieng Viet) | deploy_* |
| `{{TOTAL_AGENTS}}` | So luong agents | deploy_* |
| `{{REQUIREMENT}}` | Yeu cau nguoi dung nhap | planning |
| `{{TEAM_HINT}}` | Goi y so luong agents | planning |
| `{{REFERENCES_SECTION}}` | Tai lieu tham khao dinh kem | planning |
| `{{SUMMARY}}` | Tom tat cong viec truoc do | continue |
| `{{MESSAGE}}` | Chi thi moi tu nguoi dung | continue |

### Vi du chinh sua prompt

**Muon them quy tac "luon dung TypeScript strict mode":**

Mo `src-tauri/prompts/deploy_standard.md`, them vao section QUALITY GATES:

```markdown
## QUALITY GATES (Mission fails if ANY are not met)
- All source files written completely (no TODO, no placeholder, no stub)
- Dependencies installed successfully
- Build passes with 0 errors: {{PROJECT_TYPE}}
- Integration test: all imports resolve, app starts without crash
- README.md exists
- TypeScript strict mode enabled (tsconfig.json: "strict": true)  ← THEM DONG NAY
```

**Muon thay doi cach Lead giao viec cho agents:**

Mo `src-tauri/prompts/deploy_agent_teams.md`, chinh section "Phase 2: Spawn All Agents".

### Sau khi chinh sua prompt

- Neu **build tu source**: `npm run tauri dev` hoac `npm run tauri build` se tu dong apply (vi dung `include_str!`)
- Neu **chay tu exe**: Can build lai (`npm run tauri build`) de embed prompt moi vao binary

---

## Skill Files — Tang chat luong output

Skill file la file `.md` hoac `.txt` chua huong dan chuyen sau cho agents.

### Cach dung

1. **Per-agent**: Expand agent card → click "Them custom instructions" → chon file
2. **Bulk**: Click "Bulk Skill" o header → chon file → tick agents → Apply

### Vi du skill files huu ich

| File | Noi dung |
|------|---------|
| `react-conventions.md` | Coding standards, folder structure, naming conventions |
| `api-spec.md` | OpenAPI/Swagger spec — agents tao endpoints dung contract |
| `design-tokens.md` | Color palette, spacing, typography — UI consistent |
| `testing-guide.md` | Test framework, coverage requirements, mock patterns |
| `database-schema.md` | Schema + relations — queries/migrations chinh xac |

### Mau skill file

```markdown
# React Coding Standards

## Component Structure
- Use functional components with hooks
- One component per file
- Co-locate styles, tests, and types

## Naming
- Components: PascalCase (UserProfile.tsx)
- Hooks: camelCase with "use" prefix (useAuth.ts)
- Utils: camelCase (formatDate.ts)

## Imports
- Use absolute imports with @/ prefix
- Group: React → 3rd party → local → styles

## State Management
- Local state: useState/useReducer
- Global state: Context API
- Server state: React Query

## Testing
- Framework: Vitest + React Testing Library
- Min coverage: 80%
- Test file: ComponentName.test.tsx
```

---

## Cau truc thu muc project

```
agent-teams-guide/
  src/                          # Frontend (React + Vite)
    components/mission/         # UI components cho Mission Dashboard
    data/
      prompts/
        planning.md             # ← PROMPT: Phase 1 planning
      promptWrapper.js          # Build planning prompt tu template
    hooks/
      useMission.js             # React hook quan ly mission state
    sections/                   # Guide/tutorial sections

  src-tauri/                    # Backend (Rust + Tauri)
    prompts/
      deploy_agent_teams.md     # ← PROMPT: Deploy Agent Teams mode
      deploy_standard.md        # ← PROMPT: Deploy Standard mode
      continue_mission.md       # ← PROMPT: Continue mission
    src/
      lib.rs                    # Toan bo logic: IPC commands, Claude CLI, state management
      main.rs                   # Entry point

  dist/                         # Frontend build output (auto-generated)
```

---

## Troubleshooting

### "claude: command not found"
Claude CLI chua duoc cai hoac chua co trong PATH.
```bash
# Cai Claude CLI
npm install -g @anthropic-ai/claude-cli
# Hoac xem: https://docs.anthropic.com/en/docs/claude-cli
```

### Mission bi treo o "Planning..."
- Kiem tra Anthropic API key hop le: `claude config get api_key`
- Kiem tra internet connection
- Thu chon model khac (Sonnet thay vi Opus)

### Agents viet code nhung build fail
- Kiem tra project folder co quyen ghi
- Thu them **skill file** voi coding standards cu the
- Them custom instructions: "Run npm install and npm run build after writing code. Fix all errors before reporting done."

### App khong mo / man hinh trang
- Can co WebView2 runtime. Tai tai: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
- Thu chay lai voi quyen Administrator

### "cargo: command not found" (khi build tu source)
```bash
# Cai Rust toolchain
# Windows: tai https://rustup.rs va chay rustup-init.exe
# Sau do khoi dong lai terminal

# Hoac set PATH tam thoi:
set PATH=%USERPROFILE%\.cargo\bin;%PATH%
```

---

## Ky thuat

- **Frontend**: React 18 + Tailwind CSS + Lucide icons
- **Backend**: Rust + Tauri 2.x
- **Communication**: Tauri IPC (invoke commands + event system)
- **AI**: Claude CLI (`claude -p --output-format stream-json`)
- **Agent orchestration**: Claude Agent tool (subagent spawning)
- **State**: Rust `Arc<RwLock<MissionState>>` + React hooks
- **Prompt embedding**: `include_str!` (Rust compile-time) + Vite `?raw` import

---

## License

Internal tool — khong phan phoi cong khai.
