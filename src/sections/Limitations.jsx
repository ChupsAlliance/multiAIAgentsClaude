import { SectionHeader } from '../components/SectionHeader'
import { InfoBox } from '../components/InfoBox'

const limitations = [
  {
    title: 'Không hỗ trợ /resume cho teammates',
    severity: 'high',
    detail: 'Trong in-process mode, sau khi thoát Claude Code, teammates không thể được restore. Chỉ lead session có thể resume. Hãy hoàn thành session trong 1 lần.',
  },
  {
    title: 'Task status có thể lag',
    severity: 'medium',
    detail: 'Shared task list đôi khi không cập nhật real-time. Known limitation của experimental feature. Hỏi lead để có status chính xác.',
  },
  {
    title: 'Chỉ 1 team per session',
    severity: 'medium',
    detail: 'Không thể spawn 2 teams song song trong 1 session. Phải "Clean up the team" trước khi tạo team mới.',
  },
  {
    title: 'Không có nested teams',
    severity: 'medium',
    detail: 'Teammates không thể spawn team con. Chỉ lead mới có quyền tạo và quản lý team. Không có "super team" hay hierarchy phức tạp.',
  },
  {
    title: 'Split-pane không hỗ trợ trên Windows',
    severity: 'high',
    detail: 'Split-pane mode yêu cầu tmux hoặc iTerm2. Không hoạt động trên: Windows Terminal, VS Code integrated terminal, CMD, PowerShell, Ghostty. Windows users chỉ dùng được in-process mode.',
  },
  {
    title: 'Chi phí token nhân theo số teammates',
    severity: 'medium',
    detail: 'Mỗi teammate là 1 Claude session độc lập. 5 teammates = gần 5x token cost. Cân nhắc kỹ trước khi dùng cho tasks đơn giản.',
  },
  {
    title: 'Lead không thể được thay thế',
    severity: 'low',
    detail: 'Không thể promote teammate lên thành lead, không thể transfer leadership. Lead là cố định từ khi tạo team.',
  },
  {
    title: 'File conflict nếu không plan kỹ',
    severity: 'high',
    detail: 'Nếu 2 teammates cùng chỉnh 1 file → race condition → mất code. Luôn thiết kế tasks để mỗi teammate sở hữu directory/file riêng biệt.',
  },
]

const severityConfig = {
  high:   { label: 'Cao',   color: 'text-vs-red',    bg: 'bg-vs-red/10 border-vs-red/30' },
  medium: { label: 'Trung', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  low:    { label: 'Thấp',  color: 'text-vs-muted',  bg: 'bg-vs-border/30 border-vs-border' },
}

export function Limitations() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={13}
        titleVi="Hạn chế & Lưu ý"
        titleEn="Limitations & Notes"
        description="Agent Teams là tính năng experimental với một số hạn chế quan trọng cần biết trước khi dùng."
      />

      <InfoBox type="warning">
        Đây là <strong>experimental feature</strong> — Anthropic có thể thay đổi behavior, API, hoặc remove tính năng này bất kỳ lúc nào. Không nên dùng trong production workflows quan trọng mà không có fallback.
      </InfoBox>

      <div className="space-y-3 text-sm">
        {limitations.map((item) => {
          const cfg = severityConfig[item.severity]
          return (
            <div key={item.title} className={`rounded-lg border ${cfg.bg} p-4`}>
              <div className="flex items-start justify-between gap-3">
                <h4 className="text-white font-semibold">{item.title}</h4>
                <span className={`text-[10px] font-mono font-bold uppercase shrink-0 px-2 py-0.5 rounded ${cfg.color}`}>
                  {cfg.label}
                </span>
              </div>
              <p className="text-vs-text text-xs leading-relaxed mt-1.5">{item.detail}</p>
            </div>
          )
        })}
      </div>

      <div className="rounded-lg border border-vs-border overflow-hidden mt-6">
        <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
          <span className="text-white font-semibold text-sm">Roadmap & Tương lai</span>
        </div>
        <div className="p-4 space-y-2 text-xs text-vs-muted">
          <p>Theo documentation của Anthropic, các cải tiến đang được phát triển:</p>
          <ul className="space-y-1.5 ml-3">
            <li>• Hỗ trợ /resume cho in-process teammates</li>
            <li>• Ổn định hơn task list synchronization</li>
            <li>• Hỗ trợ thêm nhiều terminal emulators</li>
            <li>• Metrics và cost tracking chi tiết hơn</li>
          </ul>
          <p className="mt-3">Theo dõi updates tại: <span className="text-vs-accent font-mono">docs.anthropic.com/claude-code</span></p>
        </div>
      </div>
    </div>
  )
}
