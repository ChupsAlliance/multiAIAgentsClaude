import { SectionHeader } from '../components/SectionHeader'
import { CodeBlock } from '../components/CodeBlock'
import { InfoBox } from '../components/InfoBox'

const inProcessDiagram = `# In-Process Mode (default trên Windows)
┌─────────────────────────────────────────┐
│            Terminal Window              │
│                                         │
│  [Lead] Analyzing task...               │
│  [Lead] Spawning 3 teammates...         │
│                                         │
│  [Teammate-1] Working on backend API... │
│  [Teammate-2] Building React UI...      │
│  [Teammate-3] Writing tests...          │
│                                         │
│  ← Shift+Down → switch focus           │
│  ← Ctrl+T → toggle task list           │
└─────────────────────────────────────────┘`

const splitPaneDiagram = `# Split-Pane Mode (cần tmux hoặc iTerm2)
┌──────────────┬──────────────┬──────────────┐
│     Lead     │  Teammate-1  │  Teammate-2  │
│              │              │              │
│ Coordinating │ Backend API  │ Frontend UI  │
│ ...          │ ...          │ ...          │
├──────────────┴──────────────┴──────────────┤
│                Teammate-3                   │
│              Integration Tests              │
└─────────────────────────────────────────────┘
# Click vào pane bất kỳ để interact trực tiếp`

const tmuxSetup = `# Cài tmux (macOS)
brew install tmux

# Cài tmux (Ubuntu/Debian)
sudo apt install tmux

# Chạy claude trong tmux session
tmux new-session -s claude
claude  # → tự detect tmux, dùng split-pane mode`

const settingsMode = `{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "teammateMode": "in-process"
  
  // Options:
  // "auto"       - tmux nếu có, fallback in-process
  // "in-process" - force in-process (Windows safe)
  // "tmux"       - force tmux (lỗi nếu không có tmux)
}`

export function DisplayModes() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={9}
        titleVi="Chế độ hiển thị"
        titleEn="Display Modes"
        description="Agent Teams hỗ trợ 2 cách hiển thị: in-process (1 terminal) và split-pane (mỗi agent 1 pane riêng)."
      />

      <div className="space-y-5 text-sm">
        {/* Comparison table */}
        <div className="overflow-x-auto rounded-lg border border-vs-border">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="bg-vs-panel">
                <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Tiêu chí</th>
                <th className="text-left px-4 py-2.5 text-vs-green font-semibold">In-Process</th>
                <th className="text-left px-4 py-2.5 text-vs-yellow font-semibold">Split-Pane</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-vs-border">
              {[
                ['Yêu cầu', 'Không cần gì thêm', 'tmux hoặc iTerm2'],
                ['Hỗ trợ Windows', '✅ Có', '❌ Không'],
                ['Xem output', 'Shift+Down để switch', 'Tất cả cùng lúc'],
                ['Tương tác', 'Cycle qua từng teammate', 'Click vào pane'],
                ['Resume session', '❌ Không hỗ trợ', '❌ Không hỗ trợ'],
                ['Phù hợp với', 'Windows, mọi terminal', 'macOS/Linux với tmux'],
              ].map(([k, v1, v2]) => (
                <tr key={k} className="hover:bg-white/5">
                  <td className="px-4 py-2 text-vs-text">{k}</td>
                  <td className="px-4 py-2 text-vs-green">{v1}</td>
                  <td className="px-4 py-2 text-vs-yellow">{v2}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-green rounded-full inline-block"></span>
            In-Process Mode
          </h3>
          <CodeBlock code={inProcessDiagram} language="text" />
        </div>

        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-yellow rounded-full inline-block"></span>
            Split-Pane Mode
          </h3>
          <CodeBlock code={splitPaneDiagram} language="text" />
        </div>

        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Setup tmux (macOS/Linux)
          </h3>
          <CodeBlock code={tmuxSetup} language="bash" />
        </div>

        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Cấu hình mode trong settings
          </h3>
          <CodeBlock code={settingsMode} language="json" filename="~/.claude/settings.json" />
        </div>

        <InfoBox type="warning">
          <strong>Windows:</strong> Chỉ dùng được <code className="font-mono bg-black/20 px-1 rounded">in-process</code> mode.
          Split-pane <strong>không hoạt động</strong> trên: VS Code integrated terminal, Windows Terminal, PowerShell, CMD, Ghostty.
        </InfoBox>
      </div>
    </div>
  )
}
