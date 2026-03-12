import { SectionHeader } from '../components/SectionHeader'
import { InfoBox } from '../components/InfoBox'

export function PlanReviewGuide() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={4}
        titleVi="Plan Review — Tùy chỉnh kế hoạch"
        titleEn="Plan Review — Customize the Plan"
        description="Sau khi AI lập kế hoạch, bạn review danh sách agents và tasks. Có thể sắp xếp lại, sửa tên, đổi priority, thêm/xóa tasks, và xem prompt trước khi deploy."
      />

      <div className="space-y-6 text-sm leading-relaxed">
        {/* Overview */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Giao diện Plan Review
          </h3>
          <p className="text-vs-text ml-3 mb-3">
            Plan Review hiển thị agents và tasks dưới dạng collapsible cards. Mỗi agent có:
          </p>
          <div className="rounded-lg border border-vs-border overflow-hidden">
            <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
              <span className="text-white font-medium text-sm">Thành phần trong mỗi Agent Card</span>
            </div>
            <div className="p-4 space-y-2">
              {[
                ['Tên agent', 'Ví dụ: scaffolder, ui-builder, api-dev. Click để sửa tên.'],
                ['Model', 'Chọn Sonnet/Opus/Haiku riêng cho agent này (mặc định: kế thừa từ Lead).'],
                ['Danh sách tasks', 'Có thể kéo-thả sắp xếp, sửa tên, đổi priority, thêm/xóa.'],
                ['Custom instructions', 'Textarea để thêm hướng dẫn đặc biệt cho agent này.'],
                ['Skill file', 'Load file .md/.txt chứa coding standards, API spec, v.v. vào prompt.'],
                ['Nút ▼/▲', 'Expand/collapse agent card.'],
              ].map(([label, desc]) => (
                <div key={label} className="flex items-start gap-2 text-vs-text">
                  <span className="text-vs-accent mt-0.5 shrink-0">▸</span>
                  <span><span className="text-white font-medium">{label}:</span> <span className="text-xs">{desc}</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Task management */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Quản lý Tasks
          </h3>
          <div className="overflow-x-auto rounded-lg border border-vs-border">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-vs-panel">
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Thao tác</th>
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Cách làm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vs-border">
                {[
                  ['Kéo-thả sắp xếp', 'Giữ icon ⠿ (grip) bên trái task → kéo lên/xuống'],
                  ['Sửa tên task', 'Click vào tên task → gõ tên mới → Enter để lưu, Esc để hủy'],
                  ['Đổi priority', 'Click vào chấm tròn màu bên trái → cycle High → Med → Low'],
                  ['Xóa task', 'Hover vào task → nút ✕ xuất hiện bên phải → click để xóa'],
                  ['Thêm task mới', 'Click "+ Thêm task" dưới danh sách → nhập tên → Enter'],
                ].map(([action, how]) => (
                  <tr key={action} className="hover:bg-white/5">
                    <td className="px-4 py-2 text-vs-keyword">{action}</td>
                    <td className="px-4 py-2 text-vs-text">{how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Priority levels */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Mức priority
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {[
              { level: 'High', color: 'bg-red-400', border: 'border-red-400', desc: 'Task quan trọng nhất, làm trước' },
              { level: 'Medium', color: 'bg-yellow-400', border: 'border-yellow-400', desc: 'Mặc định. Task bình thường' },
              { level: 'Low', color: 'bg-green-400', border: 'border-green-400', desc: 'Nice-to-have, có thể bỏ qua' },
            ].map(({ level, color, border, desc }) => (
              <div key={level} className={`rounded-lg border ${border}/40 p-3 flex items-center gap-3`}>
                <span className={`w-3 h-3 rounded-full ${color} shrink-0`} />
                <div>
                  <div className="text-white text-xs font-semibold">{level}</div>
                  <div className="text-vs-muted text-[10px]">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Model per agent */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Chọn model riêng cho từng agent
          </h3>
          <p className="text-vs-text ml-3 mb-3">
            Mỗi agent card có 3 icon model (⚡ Sonnet, 🧠 Opus, 💰 Haiku).
            Click để chọn. Mặc định kế thừa model từ Lead.
          </p>
          <InfoBox type="tip">
            <strong>Mẹo tiết kiệm:</strong> Dùng Opus cho agent chính (kiến trúc, integration)
            và Sonnet cho agents viết code đơn giản. Haiku cho agents viết docs/tests.
          </InfoBox>
        </div>

        {/* Custom instructions */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Custom Instructions
          </h3>
          <p className="text-vs-text ml-3 mb-3">
            Mỗi agent card có textarea <strong>"Custom instructions"</strong> — thêm hướng dẫn đặc biệt.
            Text này được inject thẳng vào prompt của agent đó.
          </p>
          <div className="rounded-lg border border-vs-border overflow-hidden">
            <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
              <span className="text-white font-medium text-sm">Ví dụ custom instructions</span>
            </div>
            <div className="p-4 space-y-2 text-xs text-vs-text font-mono">
              <p className="text-vs-string">"Dùng Tailwind CSS thay vì CSS modules. Import từ @/components/."</p>
              <p className="text-vs-string">"Viết tests với Vitest, không dùng Jest. Coverage tối thiểu 80%."</p>
              <p className="text-vs-string">"API endpoint phải return JSON với format: {'{ success: boolean, data: T, error?: string }'}"</p>
            </div>
          </div>
        </div>

        {/* Skill Files */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-purple-400 rounded-full inline-block"></span>
            Skill Files — Thêm "kỹ năng" cho agent
          </h3>
          <p className="text-vs-text ml-3 mb-3">
            Skill file là file <code className="text-purple-300 bg-purple-500/10 px-1 rounded">.md</code> hoặc{' '}
            <code className="text-purple-300 bg-purple-500/10 px-1 rounded">.txt</code> chứa hướng dẫn chuyên sâu
            cho agent — ví dụ: coding standards, API spec, design system rules, hay framework-specific best practices.
          </p>

          {/* How to load per-agent */}
          <div className="rounded-lg border border-purple-500/30 overflow-hidden mb-4">
            <div className="bg-purple-500/10 px-4 py-2.5 border-b border-purple-500/30">
              <span className="text-purple-300 font-medium text-sm">Cách 1: Load skill cho từng agent</span>
            </div>
            <div className="p-4 space-y-2">
              {[
                'Expand agent card → click "Thêm custom instructions"',
                'Click "Click để chọn skill file (.md, .txt)" → chọn file từ máy',
                'File hiện dạng badge tím — nội dung tự inject vào prompt',
                'Vẫn có thể gõ thêm custom instructions bên dưới (sẽ merge với skill)',
                'Nút ✕ trên badge để gỡ skill file',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-vs-text text-xs">
                  <span className="w-4 h-4 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[9px] font-mono flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bulk Skill */}
          <div className="rounded-lg border border-purple-500/30 overflow-hidden mb-4">
            <div className="bg-purple-500/10 px-4 py-2.5 border-b border-purple-500/30">
              <span className="text-purple-300 font-medium text-sm">Cách 2: Bulk Skill — áp dụng cho nhiều agents cùng lúc</span>
            </div>
            <div className="p-4 space-y-2">
              {[
                'Ở header Plan Review, click nút "Bulk Skill" (icon Layers, màu tím)',
                'Modal mở ra → Bước 1: Chọn skill file',
                'Bước 2: Tick chọn agents muốn áp dụng (mặc định chọn tất cả)',
                'Click "Apply Skill" → file được load cho tất cả agents đã chọn',
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2 text-vs-text text-xs">
                  <span className="w-4 h-4 rounded-full bg-purple-500/20 border border-purple-500/40 text-purple-300 text-[9px] font-mono flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          </div>

          {/* How it works internally */}
          <div className="rounded-lg border border-vs-border overflow-hidden mb-4">
            <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
              <span className="text-white font-medium text-sm">Skill file được dùng thế nào?</span>
            </div>
            <div className="p-4 space-y-2 text-xs text-vs-text">
              <p>
                Khi deploy, nội dung skill file được merge vào prompt của agent dưới section{' '}
                <code className="text-purple-300 bg-purple-500/10 px-1 rounded">{'## Skill Reference'}</code>.
              </p>
              <p>
                Nếu agent đã có custom instructions, skill file được append phía sau.
                Agent nhận cả hai: custom instructions + skill reference.
              </p>
            </div>
          </div>

          {/* Example skill files */}
          <div className="rounded-lg border border-vs-border overflow-hidden">
            <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
              <span className="text-white font-medium text-sm">Ví dụ skill files hữu ích</span>
            </div>
            <div className="p-4 space-y-2 text-xs text-vs-text font-mono">
              {[
                ['react-conventions.md', 'Coding standards: naming, folder structure, hooks pattern, testing'],
                ['api-spec.md', 'OpenAPI/Swagger spec — agent tự generate endpoints đúng contract'],
                ['design-tokens.md', 'Color palette, spacing, typography — agent viết UI consistent'],
                ['error-handling.md', 'Error codes, retry logic, logging format — agent handle errors đúng cách'],
                ['database-schema.md', 'Schema + relations — agent viết queries/migrations chính xác'],
              ].map(([file, desc]) => (
                <div key={file} className="flex items-start gap-2">
                  <span className="text-purple-400 shrink-0">📄</span>
                  <span>
                    <span className="text-purple-300">{file}</span>
                    <span className="text-vs-muted"> — {desc}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <InfoBox type="tip">
            Skill files là cách mạnh nhất để kiểm soát chất lượng output.
            Thay vì viết dài trong textarea, chuẩn bị sẵn <code className="text-purple-300">.md</code> files
            cho từng loại project/framework rồi load vào mỗi lần chạy mission.
          </InfoBox>
        </div>

        {/* Prompt Preview */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Prompt Preview — Xem prompt trước khi deploy
          </h3>
          <p className="text-vs-text ml-3 mb-3">
            Nút <strong>"Prompt Preview"</strong> mở màn hình xem prompt hoàn chỉnh cho từng agent.
            Mỗi agent hiển thị dạng expandable card:
          </p>
          <div className="space-y-2 ml-3">
            {[
              'System prompt + role description',
              'Tasks được assign (với priority)',
              'Custom instructions (nếu có)',
              'Skill file content dưới section "## Skill Reference" (nếu có)',
              'Project context + build commands',
              'Evidence protocol (BUILD_RESULT, FILES_WRITTEN)',
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-vs-text text-xs">
                <span className="text-vs-green mt-0.5 shrink-0">✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
          <InfoBox type="warning">
            Prompt Preview là <strong>read-only</strong>. Muốn thay đổi prompt → quay lại Plan Review,
            sửa tasks/custom instructions → prompt tự động cập nhật.
          </InfoBox>
        </div>

        {/* Action buttons */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Nút hành động
          </h3>
          <div className="space-y-3">
            {[
              { btn: '🚀 Deploy Mission', desc: 'Approve plan → Lead bắt đầu spawn agents → chuyển sang Dashboard.', color: 'text-vs-green' },
              { btn: '← Quay lại Launcher', desc: 'Hủy plan, quay về Launcher để sửa yêu cầu.', color: 'text-vs-muted' },
            ].map(({ btn, desc, color }) => (
              <div key={btn} className="flex items-start gap-3 bg-vs-panel/50 border border-vs-border rounded-lg p-3">
                <span className={`font-semibold text-xs shrink-0 ${color}`}>{btn}</span>
                <p className="text-vs-text text-xs">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
