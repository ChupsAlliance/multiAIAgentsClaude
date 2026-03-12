import { SectionHeader } from '../components/SectionHeader'
import { CodeBlock } from '../components/CodeBlock'
import { InfoBox } from '../components/InfoBox'

const goodExample = `# ✅ TỐT: Tasks độc lập, mỗi teammate sở hữu directory riêng

"Build a blog application. Assign as follows:
- Agent 'database': Create Prisma schema + migrations
  → Only touches: /prisma/
  
- Agent 'api': Create REST API endpoints
  → Only touches: /src/api/
  
- Agent 'frontend': Create React components
  → Only touches: /src/components/ and /src/pages/
  
- Agent 'tests': Write integration tests
  → Only touches: /src/__tests__/

Start all agents simultaneously. 
Database agent outputs TypeScript types for api and frontend to use."`

const badExample = `# ❌ XẤU: Nhiều agents cùng chỉnh 1 file → race condition!

"Have all agents work on src/index.ts simultaneously and
each adds their feature to the same file"

# Kết quả: Merge conflicts, mất code, behavior không đoán được`

const hookConfig = `# src-tauri hooks (nếu cần gate quality)
# TeammateIdle hook: chạy khi teammate sắp idle
# Exit code 2 = yêu cầu teammate tiếp tục làm việc

# TaskCompleted hook: chạy khi task được mark complete  
# Exit code 2 = ngăn task được mark complete`

export function BestPractices() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={10}
        titleVi="Best Practices"
        titleEn="Best Practices"
        description="Các nguyên tắc để dùng Agent Teams hiệu quả và tránh những vấn đề phổ biến."
      />

      <div className="space-y-6 text-sm">
        {/* Team size */}
        <div className="rounded-lg border border-vs-border overflow-hidden">
          <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
            <span className="text-white font-semibold">1. Team size tối ưu</span>
          </div>
          <div className="p-4 grid grid-cols-3 gap-3">
            {[
              { size: '1-2', status: 'warning', label: 'Quá ít', desc: 'Overhead không đáng, dùng single agent' },
              { size: '3-5', status: 'good',    label: 'Lý tưởng', desc: 'Đủ parallel, dễ quản lý, chi phí hợp lý' },
              { size: '6+',  status: 'danger',  label: 'Cẩn thận', desc: 'Overhead tăng, token cost tuyến tính' },
            ].map(({ size, status, label, desc }) => (
              <div key={size} className={`rounded-lg border p-3 text-center
                ${status === 'good'    ? 'border-vs-green bg-vs-green/10' :
                  status === 'warning' ? 'border-yellow-500 bg-yellow-500/10' :
                                         'border-vs-red bg-vs-red/10'}`}>
                <div className="text-2xl font-bold font-mono text-white">{size}</div>
                <div className={`text-xs font-semibold mt-1
                  ${status === 'good' ? 'text-vs-green' : status === 'warning' ? 'text-yellow-400' : 'text-vs-red'}`}>
                  {label}
                </div>
                <div className="text-[11px] text-vs-muted mt-1">{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Task sizing */}
        <div className="rounded-lg border border-vs-border overflow-hidden">
          <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
            <span className="text-white font-semibold">2. Task sizing</span>
          </div>
          <div className="p-4 space-y-2">
            {[
              ['❌', 'Quá nhỏ', '"Add a console.log to line 42" — overhead > benefit'],
              ['❌', 'Quá lớn', '"Rewrite the entire codebase" — không check-in được'],
              ['✅', 'Vừa đúng', '"Implement the user profile API endpoint with tests"'],
            ].map(([icon, label, example]) => (
              <div key={label} className="flex items-start gap-3">
                <span className="text-lg shrink-0">{icon}</span>
                <div>
                  <span className="font-medium text-white">{label}:</span>
                  <span className="text-vs-muted ml-2 font-mono text-xs">{example}</span>
                </div>
              </div>
            ))}
            <p className="text-vs-muted text-xs mt-2">
              Rule of thumb: mỗi task nên mất <strong className="text-vs-text">5-30 phút</strong> nếu làm thủ công.
            </p>
          </div>
        </div>

        {/* File ownership */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            3. Tránh file conflicts — mỗi teammate sở hữu directory riêng
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            <CodeBlock code={goodExample} language="bash" />
            <CodeBlock code={badExample} language="bash" />
          </div>
        </div>

        {/* Cost */}
        <div className="rounded-lg border border-vs-border overflow-hidden">
          <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
            <span className="text-white font-semibold">4. Chi phí token</span>
          </div>
          <div className="p-4 space-y-2 text-vs-text">
            <p>Token usage <strong>tăng tuyến tính</strong> theo số teammates:</p>
            <ul className="space-y-1.5 ml-3 text-vs-muted">
              <li>• 3 teammates = ~3x token cost của 1 agent</li>
              <li>• Mỗi teammate có context window độc lập = phải load context riêng</li>
              <li>• Phù hợp với: research, code review, tính năng mới phức tạp</li>
              <li>• Không phù hợp với: tasks đơn giản, sửa bug nhỏ</li>
            </ul>
          </div>
        </div>

        {/* When NOT to use */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-red rounded-full inline-block"></span>
            5. Khi nào KHÔNG nên dùng Agent Teams
          </h3>
          <ul className="space-y-2 ml-3">
            {[
              'Task có thể hoàn thành trong vài phút với 1 agent',
              'Tasks phụ thuộc tuần tự (A phải xong trước B)',
              'Khi cần đọc/ghi nhiều file chung không tránh được',
              'Debug bug nhỏ, sửa typo, thêm comment',
              'Khi budget token hạn chế',
            ].map(item => (
              <li key={item} className="flex items-start gap-2 text-vs-text text-sm">
                <span className="text-vs-red mt-0.5 shrink-0">✕</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <InfoBox type="tip">
          <strong>Rule of thumb:</strong> Nếu task có thể chia thành 3+ phần <em>độc lập hoàn toàn</em> và mỗi phần mất &gt; 10 phút — Agent Teams sẽ tiết kiệm thời gian đáng kể.
        </InfoBox>
      </div>
    </div>
  )
}
