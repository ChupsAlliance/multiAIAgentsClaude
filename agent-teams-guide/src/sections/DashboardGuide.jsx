import { SectionHeader } from '../components/SectionHeader'
import { InfoBox } from '../components/InfoBox'

export function DashboardGuide() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={5}
        titleVi="Dashboard — Giám sát Mission"
        titleEn="Dashboard — Monitor & Control"
        description="Dashboard hiển thị real-time: agents đang làm gì, tasks hoàn thành bao nhiêu, files đã sửa, và cho phép can thiệp mid-run."
      />

      <div className="space-y-6 text-sm leading-relaxed">
        {/* Layout */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Layout tổng quan
          </h3>
          <div className="rounded-lg border border-vs-border overflow-hidden">
            <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
              <span className="text-white font-medium text-sm">Dashboard = 4 vùng chính</span>
            </div>
            <div className="p-4 space-y-2">
              {[
                ['Header (trên cùng)', 'Tên mission, status badge, thời gian chạy, nút Stop/New Mission'],
                ['Agent Grid (bên trái)', 'Danh sách agents dạng card. Click agent → mở tab riêng bên phải'],
                ['Tab Panel (bên phải)', '5 tab: Tasks, Activity, Messages, Files, Agent [name]'],
                ['Intervention Panel (dưới)', 'Textarea gửi lệnh bổ sung cho Lead khi mission đang chạy'],
                ['Raw Output (cuối)', 'Collapsible — xem raw stream-json output từ Claude CLI'],
              ].map(([zone, desc]) => (
                <div key={zone} className="flex items-start gap-2 text-vs-text">
                  <span className="text-vs-accent mt-0.5 shrink-0">▸</span>
                  <span><span className="text-white font-medium">{zone}:</span> <span className="text-xs">{desc}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Agent Grid */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Agent Grid — Theo dõi agents
          </h3>
          <p className="text-vs-text ml-3 mb-3">
            Bên trái Dashboard hiện danh sách agents. Mỗi card hiện:
          </p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { field: 'Tên agent', desc: 'scaffolder, ui-builder, api-dev...' },
              { field: 'Model', desc: 'Sonnet/Opus/Haiku — icon + màu' },
              { field: 'Status', desc: 'Running (xanh pulse), Completed (xanh tĩnh), Error (đỏ)' },
              { field: 'Task đang làm', desc: 'Task hiện tại hoặc "Completed: X tasks"' },
            ].map(({ field, desc }) => (
              <div key={field} className="rounded-lg border border-vs-border/50 p-3">
                <div className="text-white text-xs font-semibold">{field}</div>
                <div className="text-vs-muted text-[10px] mt-1">{desc}</div>
              </div>
            ))}
          </div>
          <InfoBox type="tip">
            <strong>Click vào agent card</strong> → mở tab riêng bên phải,
            hiện log chỉ của agent đó. Click lần nữa để đóng.
          </InfoBox>
        </div>

        {/* Tabs */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Các tab trong Dashboard
          </h3>
          <div className="space-y-3">
            {[
              {
                tab: 'Tasks',
                icon: '📋',
                desc: 'Danh sách tất cả tasks từ plan. Hiện status (pending/running/completed), agent được assign, và progress bar tổng thể.',
                badge: '3/5 — hiện completed/total',
              },
              {
                tab: 'Activity',
                icon: '📊',
                desc: 'Log hoạt động parsed — hiện agent nào đang làm gì, tool calls (Read, Write, Bash...), kết quả build, errors. Mỗi dòng có icon + màu theo loại.',
                badge: null,
              },
              {
                tab: 'Messages',
                icon: '💬',
                desc: 'Chỉ hiện khi dùng Agent Teams mode. Hiện DM giữa agents, broadcast, shutdown requests. Mỗi message có sender → recipient.',
                badge: 'Chỉ Agent Teams',
              },
              {
                tab: 'Files',
                icon: '📁',
                desc: 'Danh sách files đã tạo/sửa trong mission. Hiện file path, agent nào sửa, loại thay đổi (created/modified).',
                badge: null,
              },
              {
                tab: 'Agent [name]',
                icon: '👤',
                desc: 'Tab động — xuất hiện khi click agent ở Agent Grid. Hiện log riêng của agent đó, giúp focus theo dõi 1 agent. Nút × để đóng.',
                badge: 'Dynamic tab',
              },
            ].map(({ tab, icon, desc, badge }) => (
              <div key={tab} className="rounded-lg border border-vs-border overflow-hidden">
                <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border flex items-center gap-2">
                  <span>{icon}</span>
                  <span className="text-white font-medium text-sm">{tab}</span>
                  {badge && (
                    <span className="ml-auto text-[9px] font-mono bg-vs-accent/20 text-vs-accent px-1.5 py-0.5 rounded">{badge}</span>
                  )}
                </div>
                <div className="p-3">
                  <p className="text-vs-text text-xs">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Intervention Panel */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Intervention Panel — Can thiệp mid-run
          </h3>
          <p className="text-vs-text ml-3 mb-3">
            Ở dưới Dashboard có textarea + nút Send. Khi mission đang chạy, bạn có thể gửi lệnh bổ sung cho Lead agent.
          </p>
          <div className="overflow-x-auto rounded-lg border border-vs-border">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-vs-panel">
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Ví dụ lệnh</th>
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Hiệu quả</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vs-border">
                {[
                  ['Dùng Tailwind thay CSS modules', 'Lead chuyển hướng dẫn cho agents đang chạy'],
                  ['Thêm trang About vào app', 'Lead spawn thêm agent hoặc giao task mới'],
                  ['Ưu tiên build trước, docs sau', 'Lead điều chỉnh thứ tự priority'],
                  ['Dừng agent api-dev', 'Lead gửi shutdown request cho agent cụ thể'],
                  ['Run tests sau khi build xong', 'Lead thêm bước verification cuối'],
                ].map(([cmd, effect]) => (
                  <tr key={cmd} className="hover:bg-white/5">
                    <td className="px-4 py-2 text-vs-string">"{cmd}"</td>
                    <td className="px-4 py-2 text-vs-text">{effect}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <InfoBox type="warning">
            Lệnh bổ sung được gửi cho <strong>Lead agent</strong>, không trực tiếp cho subagents.
            Lead sẽ tự quyết định cách thực hiện. Kết quả phụ thuộc vào context hiện tại của Lead.
          </InfoBox>
        </div>

        {/* Custom agent config */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Custom Agent Config (nâng cao)
          </h3>
          <p className="text-vs-text ml-3 mb-3">
            Trong Intervention Panel, nút <strong>"+ Agent"</strong> cho phép define agent tùy chỉnh:
          </p>
          <div className="space-y-2 ml-3">
            {[
              'Tên agent (ví dụ: fixer, tester)',
              'Nhiệm vụ cụ thể',
              'Model (Sonnet/Opus/Haiku)',
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-vs-text text-xs">
                <span className="text-vs-accent mt-0.5 shrink-0">▸</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
          <p className="text-vs-muted text-xs ml-3 mt-2">
            Agent config được đính kèm vào lệnh gửi cho Lead, giúp Lead spawn đúng agent theo yêu cầu.
          </p>
        </div>

        {/* Stop / New Mission / History View */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Điều khiển Mission
          </h3>
          <div className="space-y-3">
            {[
              { btn: '⏹ Stop', desc: 'Dừng mission ngay lập tức. Tất cả agents bị kill. Code đã viết vẫn còn trên disk.', color: 'text-red-400' },
              { btn: '🔄 New Mission', desc: 'Reset state, quay về Launcher tạo mission mới. Mission cũ lưu vào history.', color: 'text-vs-accent' },
              { btn: '📋 History View', desc: 'Khi xem mission cũ từ history → banner "read-only" hiện trên cùng. Nút "← Quay lại" để trở về Launcher.', color: 'text-vs-muted' },
            ].map(({ btn, desc, color }) => (
              <div key={btn} className="flex items-start gap-3 bg-vs-panel/50 border border-vs-border rounded-lg p-3">
                <span className={`font-semibold text-xs shrink-0 ${color}`}>{btn}</span>
                <p className="text-vs-text text-xs">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Raw Output */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Raw Output — Debug view
          </h3>
          <p className="text-vs-text ml-3">
            Cuối Dashboard có panel <strong>Raw Output</strong> (collapsible). Hiện raw stream-json
            output trực tiếp từ Claude CLI — không parsed. Hữu ích khi cần debug hoặc xem
            chính xác Claude nhận/trả gì. Click header để expand/collapse.
          </p>
        </div>
      </div>
    </div>
  )
}
