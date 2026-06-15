import { SectionHeader } from '../components/SectionHeader'
import { CodeBlock } from '../components/CodeBlock'
import { InfoBox } from '../components/InfoBox'
import { SYSTEM_INFO } from '../data/promptWrapper'

export function HowItWorks() {
  const architectureDiagram = `┌─────────────────────────────────────────────────────────┐
│                    Your Desktop App                      │
│                                                         │
│  ┌──────────────┐    ┌─────────────────────────────┐    │
│  │ React UI     │◄──►│ Tauri (Rust backend)         │    │
│  │ - Launcher   │IPC │ - spawn child process        │    │
│  │ - PlanReview │    │ - parse stream-json output   │    │
│  │ - Dashboard  │    │ - WebSocket-like events      │    │
│  └──────────────┘    └─────────┬───────────────────┘    │
│                                │                         │
│                                │ spawn: claude -p        │
│                                │ --output-format          │
│                                │   stream-json            │
│                                ▼                         │
│                   ┌────────────────────────┐             │
│                   │ Claude CLI (Lead Agent) │             │
│                   │ model: user's choice    │             │
│                   └──────┬──────┬──────────┘             │
│                          │      │                        │
│              Agent tool  │      │  Agent tool             │
│                   ┌──────▼──┐ ┌─▼─────────┐             │
│                   │Subagent │ │ Subagent   │             │
│                   │"backend"│ │ "frontend" │             │
│                   │ sonnet  │ │  haiku     │             │
│                   └─────────┘ └────────────┘             │
└─────────────────────────────────────────────────────────┘`

  const promptFlow = `# Step 1: User nhập requirement
"Build authentication with login, register, password reset"

# Step 2: App wraps thành System Prompt (buildMissionPrompt)
"You are the Lead agent coordinating an Agent Team.
 ## REQUIREMENT
 Build authentication with login, register, password reset
 ## INSTRUCTIONS FOR LEAD
 Phase 1: Analyze & Plan (do NOT spawn teammates yet)
 Phase 2: Output the Plan as JSON
 ..."

# Step 3: Gửi cho Claude CLI
claude -p --model opus --output-format stream-json --verbose

# Step 4: Lead Agent output plan JSON
=== MISSION PLAN ===
{
  "agents": [
    { "name": "backend-api", "role": "Express.js API", "model": "sonnet" },
    { "name": "frontend-ui", "role": "React forms", "model": "haiku" }
  ],
  "tasks": [...]
}
=== END PLAN ===

# Step 5: User review + approve trên UI

# Step 6: App spawn NEW Claude process với deploy prompt
# Claude dùng Agent tool để tạo subagents → mỗi subagent chạy độc lập`

  return (
    <div>
      <SectionHeader
        number={12}
        titleVi="Flow hoạt động"
        titleEn="How It Works Under the Hood"
        description="Hiểu rõ từng bước từ khi bạn nhập requirement đến khi agents thực thi."
      />

      <div className="space-y-8 text-sm leading-relaxed">
        {/* Architecture */}
        <div>
          <h3 className="text-white font-semibold mb-3">Kiến trúc tổng thể</h3>
          <CodeBlock language="text" code={architectureDiagram} />
        </div>

        {/* Step-by-step flow */}
        <div>
          <h3 className="text-white font-semibold mb-3">Flow từng bước</h3>
          <div className="space-y-3">
            {SYSTEM_INFO.flowSteps.map(s => (
              <div key={s.step} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-vs-accent/20 border border-vs-accent/40 flex items-center justify-center shrink-0">
                  <span className="text-vs-accent text-xs font-mono font-bold">{s.step}</span>
                </div>
                <div className="pt-0.5">
                  <p className="text-white font-medium">{s.title}</p>
                  <p className="text-vs-muted text-xs mt-0.5">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Prompt example */}
        <div>
          <h3 className="text-white font-semibold mb-3">Ví dụ prompt flow</h3>
          <CodeBlock language="bash" code={promptFlow} />
        </div>

        {/* What each agent can do */}
        <div>
          <h3 className="text-white font-semibold mb-3">Mỗi subagent có gì?</h3>
          <div className="grid grid-cols-2 gap-2">
            {SYSTEM_INFO.agentTools.map((tool, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-md bg-vs-panel/50 border border-vs-border text-xs">
                <span className="text-vs-accent">▸</span>
                <span className="text-vs-text font-mono">{tool}</span>
              </div>
            ))}
          </div>
          <InfoBox type="info">
            Mỗi subagent là một Claude instance độc lập. Chúng <strong>không chia sẻ context</strong> với nhau
            — chỉ communicate qua file system (ví dụ: shared interfaces, coordination files).
          </InfoBox>
        </div>

        {/* Where prompts come from */}
        <div>
          <h3 className="text-white font-semibold mb-3">Prompt đến từ đâu?</h3>
          <div className="space-y-3">
            <div className="bg-vs-panel/50 border border-vs-border rounded-lg p-4">
              <p className="text-vs-keyword text-xs font-mono mb-1">System Prompt (Mission Prompt)</p>
              <p className="text-vs-text text-xs">
                Được build bởi <code className="text-vs-string">buildMissionPrompt()</code> trong app.
                Bạn có thể xem trước trong Launcher bằng nút "Xem System Prompt".
              </p>
            </div>
            <div className="bg-vs-panel/50 border border-vs-border rounded-lg p-4">
              <p className="text-vs-keyword text-xs font-mono mb-1">Deploy Prompt</p>
              <p className="text-vs-text text-xs">
                Sau khi user approve plan, app build deploy prompt gồm: danh sách agents, tasks,
                và custom instructions nếu có. Gửi cho Claude CLI mới.
              </p>
            </div>
            <div className="bg-vs-panel/50 border border-vs-border rounded-lg p-4">
              <p className="text-vs-keyword text-xs font-mono mb-1">Subagent Prompt</p>
              <p className="text-vs-text text-xs">
                Lead agent tự viết prompt cho từng subagent khi spawn qua Agent tool.
                Nếu bạn thêm "Custom Instructions" trong Plan Review, nó sẽ được include vào prompt của subagent đó.
              </p>
            </div>
          </div>
        </div>

        {/* Model comparison */}
        <div>
          <h3 className="text-white font-semibold mb-3">So sánh Models</h3>
          <div className="border border-vs-border rounded-lg overflow-hidden">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-vs-panel/50 text-vs-muted">
                  <th className="text-left px-3 py-2">Model</th>
                  <th className="text-left px-3 py-2">Tốc độ</th>
                  <th className="text-left px-3 py-2">Chi phí</th>
                  <th className="text-left px-3 py-2">Phù hợp cho</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(SYSTEM_INFO.modelInfo).map(([key, m]) => (
                  <tr key={key} className="border-t border-vs-border">
                    <td className="px-3 py-2 text-vs-keyword font-semibold">{m.label}</td>
                    <td className="px-3 py-2 text-vs-text">{m.speed}</td>
                    <td className="px-3 py-2 text-vs-text">{m.cost}</td>
                    <td className="px-3 py-2 text-vs-string">{m.best}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <InfoBox type="tip">
          <strong>Tip:</strong> Dùng Sonnet cho hầu hết agents. Chỉ dùng Opus cho agent cần reasoning
          phức tạp (kiến trúc, refactoring lớn). Dùng Haiku cho tasks đơn giản (docs, formatting).
        </InfoBox>
      </div>
    </div>
  )
}
