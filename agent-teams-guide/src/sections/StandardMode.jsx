import { SectionHeader } from '../components/SectionHeader'
import { CodeBlock } from '../components/CodeBlock'
import { InfoBox } from '../components/InfoBox'

const architectureDiagram = `┌─────────────────────────────────────────────┐
│         Lead Agent (Orchestrator)           │
│     "Build a quiz app with React..."        │
└──────┬─────────────────┬─────────────┬──────┘
       │  Agent tool     │  Agent tool │
       ▼                 ▼             ▼
┌────────────┐   ┌────────────┐  ┌──────────┐
│ scaffolder │   │ ui-builder │  │ api-dev  │
│ (Sonnet)   │   │ (Sonnet)   │  │ (Sonnet) │
│            │   │            │  │          │
│ Setup proj │   │ Components │  │ REST API │
│ + configs  │   │ + pages    │  │ + routes │
└──────┬─────┘   └──────┬─────┘  └────┬─────┘
       │                │              │
       └──── BUILD_RESULT: PASS ───────┘
                        │
              Lead verifies integration
              Lead writes README.md
              Lead prints "Mission complete"`

const executionPhases = `# Mỗi agent khi được spawn sẽ theo protocol:

A) SETUP     → cd vào project, đọc code hiện có
B) IMPLEMENT → Viết code HOÀN CHỈNH (không stubs, không TODOs)
C) INSTALL   → Cài dependencies (npm install, pip install, etc.)
D) BUILD     → Chạy build, đọc output, fix nếu lỗi, lặp lại
E) EVIDENCE  → Print BUILD_RESULT: PASS + FILES_WRITTEN

# Agent KHÔNG ĐƯỢC báo cáo "done" nếu build chưa PASS`

const logExample = `[Lead] Spawning scaffolder for Project Setup
[Lead] Spawning ui-builder for UI Components
[Lead] Spawning api-dev for Backend API

[scaffolder] SETUP: Reading existing files...
[scaffolder] IMPLEMENT: Writing package.json, vite.config.ts, tsconfig.json
[scaffolder] INSTALL: Running npm install...
[scaffolder] BUILD: Running npm run build... ✓ 0 errors
[scaffolder] BUILD_RESULT: PASS
[scaffolder] FILES_WRITTEN: package.json, vite.config.ts, tsconfig.json
[scaffolder] Completed: Project scaffolding

[ui-builder] IMPLEMENT: Writing LoginForm.tsx, QuizPage.tsx...
[ui-builder] BUILD: Running npm run build...
[ui-builder] BUILD_RESULT: FAIL: Cannot find module './types/user'
[ui-builder] Fixing: Adding missing type definitions...
[ui-builder] BUILD: Running npm run build... ✓ 0 errors
[ui-builder] BUILD_RESULT: PASS
[ui-builder] FILES_WRITTEN: src/components/LoginForm.tsx, src/types/user.ts

[Lead] Agent results: 3/3 PASS, 0 FAIL
[Lead] Running integration verification...
[Lead] npm run build → ✓ 0 errors, 0 warnings
[Lead] INTEGRATION_VERIFIED: PASS
[Lead] Writing README.md...
[Lead] Mission complete`

export function StandardMode() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={2}
        titleVi="Standard Mode (Mặc định)"
        titleEn="Standard Mode — Stable & Recommended"
        description="Chế độ chạy mặc định, ổn định, phù hợp cho hầu hết mọi task. Lead spawn agents song song, mỗi agent tự verify build, Lead kiểm tra integration cuối cùng."
      />

      <InfoBox type="tip">
        <strong>Khuyến nghị:</strong> Dùng Standard Mode cho hầu hết mọi task. Chỉ chuyển sang Agent Teams Mode khi cần agents giao tiếp real-time với nhau.
      </InfoBox>

      <div className="space-y-6 text-sm leading-relaxed">
        {/* Architecture */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-green rounded-full inline-block"></span>
            Kiến trúc Standard Mode
          </h3>
          <CodeBlock code={architectureDiagram} language="text" />
        </div>

        {/* 4 Phases */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-green rounded-full inline-block"></span>
            Lead orchestration — 4 Phases
          </h3>
          <div className="space-y-3">
            {[
              {
                phase: 'Phase 1',
                title: 'Spawn ALL Agents (song song)',
                detail: 'Lead spawn tất cả agents cùng lúc. Mỗi agent nhận prompt riêng với tasks cụ thể và chạy độc lập.',
                color: 'bg-vs-accent/20 border-vs-accent/40 text-vs-accent',
              },
              {
                phase: 'Phase 2',
                title: 'Review Agent Results',
                detail: 'Sau khi agents xong, Lead kiểm tra output: BUILD_RESULT: PASS hay FAIL? Nếu FAIL → spawn fixer agent.',
                color: 'bg-vs-green/20 border-vs-green/40 text-vs-green',
              },
              {
                phase: 'Phase 3',
                title: 'Integration Verification',
                detail: 'Lead TỰ CHẠY build toàn project. Nếu fail (import errors, type errors) → fix trực tiếp hoặc spawn fix agent. Lặp lại đến khi build PASS.',
                color: 'bg-yellow-500/20 border-yellow-500/40 text-yellow-400',
              },
              {
                phase: 'Phase 4',
                title: 'Documentation & Finish',
                detail: 'Lead viết README.md, tổng hợp kết quả, print "Mission complete". Mission chỉ kết thúc khi build đã verified.',
                color: 'bg-vs-comment/20 border-vs-comment/40 text-vs-comment',
              },
            ].map(({ phase, title, detail, color }) => (
              <div key={phase} className={`rounded-lg border ${color} p-4`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono font-bold">{phase}</span>
                  <span className="text-white font-semibold">{title}</span>
                </div>
                <p className="text-vs-text text-xs">{detail}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Agent Execution Protocol */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-green rounded-full inline-block"></span>
            Agent Execution Protocol (bên trong mỗi agent)
          </h3>
          <CodeBlock code={executionPhases} language="bash" />
        </div>

        {/* Evidence-based verification */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-green rounded-full inline-block"></span>
            Evidence-Based Verification
          </h3>
          <p className="text-vs-text mb-3 ml-3">
            Mỗi agent phải print <strong>evidence lines</strong> theo format chuẩn.
            Lead dùng evidence này để verify — không dựa vào lời nói suông.
          </p>
          <div className="overflow-x-auto rounded-lg border border-vs-border">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-vs-panel">
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Evidence Line</th>
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Ý nghĩa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vs-border">
                {[
                  ['[name] BUILD_RESULT: PASS', 'Build thành công, 0 errors'],
                  ['[name] BUILD_RESULT: FAIL: <lỗi>', 'Build thất bại, kèm error summary'],
                  ['[name] FILES_WRITTEN: a.ts, b.ts', 'Danh sách files đã tạo/sửa'],
                  ['[name] Completed: <task>', 'Task cụ thể đã hoàn tất'],
                  ['[Lead] INTEGRATION_VERIFIED: PASS', 'Lead đã verify build toàn project'],
                ].map(([line, desc]) => (
                  <tr key={line} className="hover:bg-white/5">
                    <td className="px-4 py-2 text-vs-string">{line}</td>
                    <td className="px-4 py-2 text-vs-text">{desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Quality Gates */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-green rounded-full inline-block"></span>
            Quality Gates
          </h3>
          <div className="rounded-lg border border-vs-border overflow-hidden">
            <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
              <span className="text-white font-medium text-sm">Mission FAIL nếu bất kỳ gate nào không met</span>
            </div>
            <div className="p-4 space-y-2">
              {[
                'Tất cả source files viết HOÀN CHỈNH (không TODO, không placeholder, không stub)',
                'Dependencies cài đặt thành công',
                'Build/compile pass với 0 errors',
                'Integration test: tất cả imports resolve, app start không crash',
                'README.md tồn tại với install + run instructions',
              ].map((gate, i) => (
                <div key={i} className="flex items-start gap-2 text-vs-text">
                  <span className="text-vs-green mt-0.5 shrink-0">✓</span>
                  <span className="text-xs">{gate}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Project Type Detection */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-green rounded-full inline-block"></span>
            Tự động nhận diện project type
          </h3>
          <p className="text-vs-text mb-3 ml-3">
            App tự detect project type từ file system và inject build commands phù hợp vào prompt:
          </p>
          <div className="overflow-x-auto rounded-lg border border-vs-border">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="bg-vs-panel">
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Detect file</th>
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Project type</th>
                  <th className="text-left px-4 py-2.5 text-vs-muted font-semibold">Build command</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vs-border">
                {[
                  ['package.json + vite', 'Node.js/Vite', 'npm install && npm run build'],
                  ['package.json + next', 'Node.js/Next.js', 'npm install && npm run build'],
                  ['package.json', 'Node.js', 'npm install && node entry.js'],
                  ['requirements.txt', 'Python', 'pip install -r requirements.txt'],
                  ['Cargo.toml', 'Rust', 'cargo build'],
                  ['go.mod', 'Go', 'go build ./...'],
                  ['pom.xml / build.gradle', 'Java/JVM', 'mvn compile / gradle build'],
                ].map(([file, type, cmd]) => (
                  <tr key={file} className="hover:bg-white/5">
                    <td className="px-4 py-2 text-vs-keyword">{file}</td>
                    <td className="px-4 py-2 text-vs-text">{type}</td>
                    <td className="px-4 py-2 text-vs-string">{cmd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Example log */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-green rounded-full inline-block"></span>
            Ví dụ log output
          </h3>
          <CodeBlock code={logExample} language="bash" />
        </div>

        {/* When to use */}
        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-green rounded-full inline-block"></span>
            Khi nào dùng Standard Mode?
          </h3>
          <ul className="space-y-2 text-vs-text ml-3">
            {[
              ['Build feature mới', 'CRUD, form, page, API endpoint — agents chạy song song'],
              ['Refactor code', 'Mỗi agent refactor 1 module/directory'],
              ['Debug & fix', 'Agents phân tích từ góc khác nhau'],
              ['Viết documentation', 'Agents viết docs cho các module'],
              ['Code review', 'Agents review security, performance, quality song song'],
            ].map(([title, desc]) => (
              <li key={title} className="flex items-start gap-2">
                <span className="text-vs-green mt-0.5 shrink-0">▸</span>
                <span><span className="text-white font-medium">{title}:</span> {desc}</span>
              </li>
            ))}
          </ul>
        </div>

        <InfoBox type="info">
          Standard Mode là chế độ <strong>mặc định</strong> khi tạo mission mới.
          Lead spawn agents, chờ kết quả, tự verify build.
          Agents <strong>không giao tiếp</strong> với nhau — chỉ report kết quả về Lead.
          Đơn giản, ổn định, đủ cho <strong>90% use cases</strong>.
        </InfoBox>
      </div>
    </div>
  )
}
