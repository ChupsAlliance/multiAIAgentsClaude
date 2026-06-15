import { SectionHeader } from '../components/SectionHeader'
import { CodeBlock } from '../components/CodeBlock'
import { InfoBox } from '../components/InfoBox'

const settingsJson = `{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}`

const settingsPath = `# Windows
%USERPROFILE%\.claude\settings.json

# macOS / Linux
~/.claude/settings.json`

const splitPaneSettings = `{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "teammateMode": "auto"
  
  // Các giá trị: "auto" | "in-process" | "tmux"
  // "auto": dùng tmux nếu có, fallback về in-process
}`

export function Setup() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={6}
        titleVi="Cài đặt & Kích hoạt"
        titleEn="Setup & Enable"
        description="Agent Teams bị tắt theo mặc định. Cần thêm 1 dòng vào settings.json để bật."
      />

      <div className="space-y-5 text-sm">
        {/* Step 1 */}
        <div className="rounded-lg border border-vs-border overflow-hidden">
          <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-vs-accent text-white text-xs font-bold flex items-center justify-center">1</span>
            <span className="text-white font-medium text-sm">Tìm file settings.json</span>
          </div>
          <div className="p-4">
            <CodeBlock code={settingsPath} language="bash" />
            <p className="text-vs-muted text-xs mt-2">Tạo file nếu chưa tồn tại. Chỉ cần tạo thư mục <code className="text-vs-string font-mono">.claude</code> và file <code className="text-vs-string font-mono">settings.json</code> trống.</p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="rounded-lg border border-vs-border overflow-hidden">
          <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-vs-accent text-white text-xs font-bold flex items-center justify-center">2</span>
            <span className="text-white font-medium text-sm">Thêm config vào settings.json</span>
          </div>
          <div className="p-4">
            <CodeBlock code={settingsJson} language="json" filename="~/.claude/settings.json" />
          </div>
        </div>

        {/* Step 3 */}
        <div className="rounded-lg border border-vs-border overflow-hidden">
          <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-vs-accent text-white text-xs font-bold flex items-center justify-center">3</span>
            <span className="text-white font-medium text-sm">Restart Claude Code</span>
          </div>
          <div className="p-4">
            <p className="text-vs-text leading-relaxed">Đóng và mở lại Claude Code để config có hiệu lực. Settings được đọc khi khởi động.</p>
          </div>
        </div>

        {/* Optional: teammateMode */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-keyword rounded-full inline-block"></span>
            Tùy chọn: Cấu hình chế độ hiển thị
          </h3>
          <CodeBlock code={splitPaneSettings} language="json" filename="~/.claude/settings.json" />
        </div>

        <InfoBox type="warning">
          <strong>Windows users:</strong> Chỉ hỗ trợ <code className="font-mono bg-black/20 px-1 rounded">in-process</code> mode.
          Split-pane (tmux) không hoạt động trên Windows Terminal, VS Code integrated terminal, hoặc Ghostty.
        </InfoBox>

        <InfoBox type="tip">
          Có thể dùng <strong>project-level settings</strong> thay vì global: tạo file{' '}
          <code className="font-mono bg-black/20 px-1 rounded">.claude/settings.json</code> trong thư mục project.
          Project settings sẽ override global settings.
        </InfoBox>
      </div>
    </div>
  )
}
