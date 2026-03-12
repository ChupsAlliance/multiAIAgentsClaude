import { SectionHeader } from '../components/SectionHeader'
import { CodeBlock } from '../components/CodeBlock'

const codeReviewPrompt = `"Create a code review team for the PR diff in ./pr-changes.patch.
Spawn three reviewers:

- Reviewer 'security': Check for security vulnerabilities.
  Focus on: SQL injection, XSS, auth bypass, hardcoded secrets,
  OWASP Top 10. Output a numbered list of issues with file:line refs.

- Reviewer 'performance': Check for performance issues.
  Focus on: N+1 queries, missing DB indexes, inefficient loops,
  unnecessary re-renders, large bundle size contributors.
  
- Reviewer 'quality': Check code style and best practices.
  Focus on: TypeScript strictness, error handling coverage,
  test coverage gaps, naming conventions.

Have each reviewer work independently on the same diff.
Orchestrator: merge all findings into ./review-report.md,
group by severity (Critical / Major / Minor)."`

const parallelDevPrompt = `"We need to build a notifications system. Split work across 3 agents:

Agent 'backend' (owns /src/services/ and /src/api/):
  1. Create NotificationService class with: create, markRead, markAllRead
  2. Create POST /api/notifications endpoint
  3. Create GET /api/notifications?userId=X endpoint  
  4. Write unit tests for the service

Agent 'frontend' (owns /src/components/ and /src/store/):
  1. Create NotificationBell component with unread count badge
  2. Create NotificationList dropdown component
  3. Add notificationSlice to Redux store
  4. Connect components to API via React Query

Agent 'docs' (owns /docs/ and README.md):
  1. Write API documentation at /docs/api/notifications.md
  2. Add notification setup to README.md
  3. Create usage examples with code snippets

Backend agent: output TypeScript interfaces first so frontend can use them.
Start all agents simultaneously after backend outputs interfaces."`

const debugPrompt = `"Users report the app crashes after sending the second message.
Spawn 4 teammates to investigate different hypotheses simultaneously.
Have them debate and try to disprove each other's theories.

Teammate 1 - 'memory-leak': Hypothesis: memory leak in event listeners.
  Investigate: event listener cleanup in components, subscription patterns.
  
Teammate 2 - 'state-corruption': Hypothesis: Redux state corruption.
  Investigate: reducers, selectors, state mutation patterns.

Teammate 3 - 'websocket': Hypothesis: WebSocket reconnection issue.
  Investigate: WebSocket lifecycle, reconnection logic, message queuing.

Teammate 4 - 'race-condition': Hypothesis: race condition in async code.
  Investigate: async/await usage, Promise chains, concurrent state updates.

Each teammate: document findings in /debug/hypothesis-[name].md
After initial investigation, share findings with each other and 
try to identify which hypothesis best explains the bug.
Orchestrator: create final report at /debug/root-cause-analysis.md"`

const examples = [
  {
    id: 'review',
    title: 'Code Review Team',
    subtitle: 'Parallel PR Review',
    desc: '3 reviewers chạy song song: security, performance, code quality. Phù hợp trước khi merge PR quan trọng.',
    tags: ['3 agents', 'Read-only', 'Review'],
    color: 'border-vs-accent',
    badge: 'bg-vs-accent/20 text-vs-accent',
    prompt: codeReviewPrompt,
  },
  {
    id: 'parallel',
    title: 'Parallel Feature Dev',
    subtitle: 'Backend + Frontend + Docs',
    desc: '3 agents xây dựng tính năng hoàn chỉnh song song: API, UI, và documentation cùng lúc.',
    tags: ['3 agents', 'Write code', 'Feature'],
    color: 'border-vs-green',
    badge: 'bg-vs-green/20 text-vs-green',
    prompt: parallelDevPrompt,
  },
  {
    id: 'debug',
    title: 'Debugging với Competing Hypotheses',
    subtitle: 'Parallel root cause analysis',
    desc: '4 agents test 4 giả thuyết song song, sau đó debate với nhau để tìm root cause. Hiệu quả với bugs khó tái hiện.',
    tags: ['4 agents', 'Investigation', 'Debug'],
    color: 'border-vs-orange',
    badge: 'bg-vs-orange/20 text-vs-orange',
    prompt: debugPrompt,
  },
]

export function RealWorldExamples() {
  return (
    <div className="space-y-6">
      <SectionHeader
        number={11}
        titleVi="Ví dụ thực tế"
        titleEn="Real-world Examples"
        description="3 use case phổ biến nhất với prompt đầy đủ, sẵn sàng copy & paste."
      />

      <div className="space-y-8 text-sm">
        {examples.map((ex, i) => (
          <div key={ex.id} className={`rounded-lg border ${ex.color} overflow-hidden`}>
            <div className="bg-vs-panel px-5 py-3 border-b border-vs-border">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-vs-muted font-mono text-xs">{String(i+1).padStart(2,'0')}.</span>
                    <h3 className="text-white font-bold">{ex.title}</h3>
                  </div>
                  <p className="text-vs-muted text-xs font-mono">{ex.subtitle}</p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {ex.tags.map(tag => (
                    <span key={tag} className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${ex.badge}`}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <p className="text-vs-text text-xs mt-2">{ex.desc}</p>
            </div>
            <div className="p-4">
              <p className="text-vs-muted text-xs mb-2 font-mono uppercase tracking-wide">Prompt</p>
              <CodeBlock code={ex.prompt} language="bash" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
