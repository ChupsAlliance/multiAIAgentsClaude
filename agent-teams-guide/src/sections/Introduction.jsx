import { SectionHeader } from '../components/SectionHeader'
import { CodeBlock } from '../components/CodeBlock'
import { InfoBox } from '../components/InfoBox'

const diagram = `┌─────────────────────────────────────────────┐
│           Agent Teams Guide App             │
│    Launcher → Plan Review → Dashboard       │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│         Lead Agent (Orchestrator)           │
│         Claude CLI + stream-json            │
└──────┬─────────────────┬─────────────┬──────┘
       │  Agent tool     │  Agent tool │
       ▼                 ▼             ▼
┌────────────┐   ┌────────────┐  ┌──────────┐
│  Agent A   │   │  Agent B   │  │ Agent C  │
│ (Backend)  │   │ (Frontend) │  │ (Tests)  │
│            │   │            │  │          │
│ Viết code  │   │ Viết code  │  │ Viết code│
│ Build ✓    │   │ Build ✓    │  │ Build ✓  │
└────────────┘   └────────────┘  └──────────┘
       │                │              │
       └──── Lead verifies build ──────┘
                  Mission complete`

export function Introduction() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={1}
        titleVi="Giới thiệu"
        titleEn="Introduction"
        description="Agent Teams Guide giúp bạn điều phối đội ngũ AI agents để thực hiện các dự án phần mềm — từ build feature mới, refactor code, đến debug và viết documentation."
      />

      <div className="space-y-5 text-sm leading-relaxed">
        {/* What is this app */}
        <div>
          <h3 className="text-white font-semibold mb-2 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Ứng dụng này làm gì?
          </h3>
          <p className="text-vs-text ml-3">
            Bạn mô tả yêu cầu bằng ngôn ngữ tự nhiên → AI lập kế hoạch → bạn review & approve
            → <span className="text-vs-keyword font-mono">Lead agent</span> spawn nhiều{' '}
            <span className="text-vs-keyword font-mono">subagents</span> song song, mỗi agent thực hiện
            phần việc riêng → tất cả được verify build trước khi báo hoàn tất.
          </p>
        </div>

        {/* Architecture */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Kiến trúc tổng quan
          </h3>
          <CodeBlock code={diagram} language="text" />
        </div>

        {/* Two Execution Modes */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Hai chế độ thực thi
          </h3>
          <div className="overflow-x-auto rounded-lg border border-vs-border">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-vs-panel">
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold"></th>
                  <th className="text-left px-4 py-2.5 text-vs-green font-semibold">
                    Standard Mode
                    <span className="ml-1.5 text-[9px] font-mono bg-vs-green/20 text-vs-green px-1.5 py-0.5 rounded">{'Mặc định'}</span>
                  </th>
                  <th className="text-left px-4 py-2.5 text-yellow-400 font-semibold">
                    Agent Teams Mode
                    <span className="ml-1.5 text-[9px] font-mono bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">{'Thử nghiệm'}</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vs-border">
                {[
                  ['Trạng thái', 'Ổn định, đã test kỹ', 'Experimental'],
                  ['Giao tiếp', 'Agents độc lập, report về Lead', 'Agents DM nhau qua SendMessage'],
                  ['Monitoring', 'Lead chờ kết quả, verify cuối', 'Lead active monitor, can thiệp real-time'],
                  ['Error recovery', 'Spawn fixer agent', 'Gửi DM yêu cầu fix, reassign'],
                  ['Phù hợp', 'Mọi task thông thường', 'Tasks cần agents phối hợp chặt'],
                  ['UI tab Messages', 'Không', 'Có — hiện DM/broadcast'],
                ].map(([k, v1, v2]) => (
                  <tr key={k} className="hover:bg-white/5">
                    <td className="px-4 py-2 text-vs-text font-medium">{k}</td>
                    <td className="px-4 py-2 text-vs-green">{v1}</td>
                    <td className="px-4 py-2 text-yellow-400">{v2}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Mission workflow */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Mission Workflow (cả 2 modes)
          </h3>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {[
              { step: '1', label: 'Launcher', desc: 'Nhập yêu cầu + chọn project', color: 'bg-vs-accent/20 border-vs-accent/40' },
              { step: '2', label: 'Plan Review', desc: 'Review agents + tasks', color: 'bg-vs-accent/20 border-vs-accent/40' },
              { step: '3', label: 'Deploy', desc: 'Lead spawn agents', color: 'bg-vs-green/20 border-vs-green/40' },
              { step: '4', label: 'Dashboard', desc: 'Giám sát real-time', color: 'bg-vs-green/20 border-vs-green/40' },
            ].map(({ step, label, desc, color }, i) => (
              <div key={step} className="flex items-center gap-2 shrink-0">
                <div className={`rounded-lg border ${color} px-4 py-3 text-center min-w-[120px]`}>
                  <div className="text-vs-accent text-xs font-mono font-bold">{step}</div>
                  <div className="text-white text-sm font-semibold">{label}</div>
                  <div className="text-vs-muted text-[10px]">{desc}</div>
                </div>
                {i < 3 && <span className="text-vs-muted text-lg">{'→'}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Key features */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Tính năng chính
          </h3>
          <ul className="space-y-2 text-vs-text ml-3">
            {[
              ['Evidence-based verification', 'Agents phải print BUILD_RESULT — Lead verify bằng evidence, không tin lời nói suông'],
              ['Auto project detection', 'App tự nhận dạng Node.js/Vite/Python/Rust/Go và inject build commands'],
              ['Retry loop', 'Build fail → fix → rebuild. Không dừng cho đến khi pass'],
              ['Can thiệp mid-run', 'Gửi lệnh bổ sung khi mission đang chạy'],
              ['@mention files', 'Gõ @ trong textarea để đính kèm file từ project'],
              ['Drag & Drop', 'Kéo file/folder vào Launcher làm tài liệu tham khảo'],
            ].map(([title, desc]) => (
              <li key={title} className="flex items-start gap-2">
                <span className="text-vs-accent mt-0.5 shrink-0">{'▸'}</span>
                <span><span className="text-white font-medium">{title}:</span> {desc}</span>
              </li>
            ))}
          </ul>
        </div>

        <InfoBox type="tip">
          Bắt đầu với <strong>Standard Mode</strong> — ổn định và đủ mạnh cho hầu hết mọi task.
          Chỉ chuyển sang Agent Teams Mode khi bạn cần agents giao tiếp trực tiếp với nhau.
        </InfoBox>
      </div>
    </div>
  )
}
