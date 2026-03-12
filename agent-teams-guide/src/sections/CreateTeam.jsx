import { SectionHeader } from '../components/SectionHeader'
import { CodeBlock } from '../components/CodeBlock'
import { InfoBox } from '../components/InfoBox'

const basicPrompt = `# Prompt cơ bản — Claude tự quyết định team size và roles
"Create an agent team to build a user authentication feature.
Use 3 teammates to work in parallel."

# → Claude sẽ tự phân công vai trò phù hợp`

const rolePrompt = `# Chỉ định rõ role cho từng teammate
"Create an agent team to review PR #142. Spawn three reviewers:
- One focused on security implications
- One checking performance impact  
- One validating test coverage

Have them each review independently then share findings."

# → Mỗi teammate nhận đúng nhiệm vụ được giao`

const planApproval = `# Yêu cầu approve plan trước khi code
"Spawn an architect teammate to refactor the authentication module.
Require plan approval before they make any changes."

# → Teammate sẽ dừng lại, đề xuất plan, chờ bạn confirm`

const modelPrompt = `# Chỉ định model cho teammates
"Create a team with 4 teammates to refactor these modules in parallel.
Use claude-sonnet-4-6 for each teammate."

# Mặc định teammates dùng cùng model với lead`

export function CreateTeam() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={7}
        titleVi="Agent Teams Mode (Thử nghiệm)"
        titleEn="Agent Teams Mode — Experimental"
        description="Chế độ thử nghiệm cho phép agents giao tiếp trực tiếp với nhau. Dùng Standard Mode cho hầu hết tasks."
      />

      <div className="space-y-5 text-sm">
        <InfoBox type="warning">
          Agent Teams là tính năng <strong>experimental</strong> — cần đặt biến môi trường{' '}
          <code className="text-vs-accent">CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1</code>.
          App tự động bật khi chọn Agent Teams mode ở Launcher.
        </InfoBox>

        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Prompt cơ bản
          </h3>
          <CodeBlock code={basicPrompt} language="bash" />
        </div>

        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Chỉ định role cụ thể
          </h3>
          <CodeBlock code={rolePrompt} language="bash" />
        </div>

        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Yêu cầu plan approval trước khi thực thi
          </h3>
          <CodeBlock code={planApproval} language="bash" />
        </div>

        <div>
          <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 bg-vs-accent rounded-full inline-block"></span>
            Chỉ định model cho teammates
          </h3>
          <CodeBlock code={modelPrompt} language="bash" />
        </div>

        <div className="rounded-lg border border-vs-border overflow-hidden">
          <div className="bg-vs-panel px-4 py-2.5 border-b border-vs-border">
            <span className="text-white font-medium text-sm">Workflow sau khi tạo team</span>
          </div>
          <div className="p-4">
            <ol className="space-y-2.5 text-vs-text">
              {[
                'Lead nhận prompt → phân tích → quyết định team size & roles',
                'Spawn teammates (mỗi teammate = 1 Claude session độc lập)',
                'Lead tạo shared task list, assign tasks cho từng teammate',
                'Teammates chạy song song, cập nhật task status',
                'Teammates có thể message nhau trực tiếp',
                'Lead tổng hợp kết quả, cleanup team khi xong',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full bg-vs-accent/20 border border-vs-accent/40 text-vs-accent text-xs font-mono flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-sm">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <InfoBox type="tip">
          Bắt đầu với <strong>3-5 teammates</strong> là lý tưởng. Mỗi teammate nên có 5-6 tasks để đủ productivity. Nhiều hơn 5 teammates thì overhead điều phối tăng đáng kể.
        </InfoBox>
      </div>
    </div>
  )
}
