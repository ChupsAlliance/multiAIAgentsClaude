import { SectionHeader } from '../components/SectionHeader'
import { CodeBlock } from '../components/CodeBlock'
import { InfoBox } from '../components/InfoBox'

const shortcuts = [
  { keys: 'Shift+Down', action: 'Chuyển sang teammate tiếp theo', note: 'In-process mode' },
  { keys: 'Ctrl+T', action: 'Toggle shared task list', note: 'Xem tiến độ tổng thể' },
  { keys: 'Escape', action: 'Interrupt turn hiện tại', note: '' },
]

const commands = `# Yêu cầu teammate dừng lại
"Ask the researcher teammate to shut down"

# Giao thêm task cho teammate cụ thể
"Give the backend teammate this additional task: add rate limiting"

# Broadcast message đến tất cả teammates
"Tell all teammates to use TypeScript strict mode"

# Yêu cầu cập nhật status
"What is the current status of all teammates?"

# Cleanup toàn bộ team
"Clean up the team"

# Chuyển focus (in-process mode)
# Nhấn Shift+Down → gõ message trực tiếp cho teammate đó`

const directMessage = `# Cách message trực tiếp một teammate (in-process mode)
# 1. Nhấn Shift+Down để cycle qua các teammates
# 2. Gõ message khi đang ở teammate cần nhắn

# Hoặc qua lead:
"Tell the frontend teammate to switch to using Tailwind instead of CSS modules"`

export function TeamInteraction() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={8}
        titleVi="Tương tác với Agent Team"
        titleEn="Team Interaction"
        description="Cách giao tiếp với lead và từng teammate trong quá trình làm việc."
      />

      <div className="space-y-5 text-sm">
        {/* Keyboard shortcuts */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Phím tắt
          </h3>
          <div className="overflow-x-auto rounded-lg border border-vs-border">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-vs-panel">
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Phím</th>
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Chức năng</th>
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Ghi chú</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vs-border">
                {shortcuts.map(({ keys, action, note }) => (
                  <tr key={keys} className="hover:bg-white/5">
                    <td className="px-4 py-2.5">
                      <kbd className="bg-vs-panel border border-vs-border text-vs-keyword px-2 py-0.5 rounded text-xs">{keys}</kbd>
                    </td>
                    <td className="px-4 py-2.5 text-vs-text">{action}</td>
                    <td className="px-4 py-2.5 text-vs-muted">{note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Commands */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Commands (nói với lead bằng ngôn ngữ tự nhiên)
          </h3>
          <CodeBlock code={commands} language="bash" />
        </div>

        {/* Direct message */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Message trực tiếp teammate
          </h3>
          <CodeBlock code={directMessage} language="bash" />
        </div>

        {/* Task list */}
        <div className="rounded-lg border border-vs-border overflow-hidden">
          <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
            <span className="text-white font-medium text-sm">Shared Task List (Ctrl+T)</span>
          </div>
          <div className="p-4 space-y-2">
            <p className="text-vs-text">Task list hiển thị:</p>
            <ul className="space-y-1.5 text-vs-muted ml-3">
              {[
                '✅ Tasks đã hoàn thành',
                '🔄 Tasks đang chạy (teammate nào đang làm)',
                '⏳ Tasks pending (chưa được claim)',
                '🔗 Dependencies giữa các tasks',
              ].map(item => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </div>

        <InfoBox type="warning">
          Task status đôi khi <strong>lag</strong> vài giây — đây là known limitation của experimental feature. Nếu cần update chính xác, hỏi lead: <code className="font-mono bg-black/20 px-1 rounded">"What is the status of all tasks?"</code>
        </InfoBox>
      </div>
    </div>
  )
}
