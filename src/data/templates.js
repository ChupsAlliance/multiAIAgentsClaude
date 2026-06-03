// Template definitions — each has fields to fill in
export const TEMPLATES = [
  {
    id: 'code-review',
    icon: '🔍',
    label: 'Code Review',
    desc: '3 reviewers song song: security, performance, quality',
    defaultTeamSize: 3,
    fields: [
      { id: 'target', label: 'Target (file, folder, hoặc PR diff)', placeholder: 'e.g. ./src/auth/, ./pr.patch', required: true },
      { id: 'focus',  label: 'Focus area đặc biệt (optional)',       placeholder: 'e.g. API security, database queries', required: false },
    ],
    buildPrompt: (f) => `Create a code review team for: ${f.target || 'the current codebase'}
Spawn three reviewers working in parallel:

- Reviewer 'security': Check for security vulnerabilities.
  Focus on: SQL injection, XSS, CSRF, auth bypass, hardcoded secrets, insecure deserialization.${f.focus ? `\n  Extra focus: ${f.focus}` : ''}
  Output: numbered list with file:line refs and severity (Critical/High/Medium/Low).
  Write findings to .claude-agent-team/review-security.md

- Reviewer 'performance': Check for performance issues.
  Focus on: N+1 queries, missing DB indexes, inefficient loops, memory leaks, large bundle imports.
  Output: numbered list with file:line refs and estimated impact.
  Write findings to .claude-agent-team/review-performance.md

- Reviewer 'quality': Check code style and best practices.
  Focus on: TypeScript strictness, error handling coverage, test coverage gaps, naming, dead code.
  Output: numbered list with file:line refs.
  Write findings to .claude-agent-team/review-quality.md

After all reviewers complete, lead: merge all findings into .claude-agent-team/review-report.md
Group by severity: Critical → Major → Minor. Include total issue count per category.`,
  },
  {
    id: 'feature',
    icon: '⚡',
    label: 'Tính năng mới',
    desc: 'Backend + Frontend + Tests song song',
    defaultTeamSize: 3,
    fields: [
      { id: 'feature_name', label: 'Tên tính năng',        placeholder: 'e.g. user-notifications',        required: true },
      { id: 'description',  label: 'Mô tả ngắn',           placeholder: 'e.g. Real-time push notifications for users', required: true },
      { id: 'tech_stack',   label: 'Tech stack (optional)', placeholder: 'e.g. Express + React + PostgreSQL', required: false },
    ],
    buildPrompt: (f) => `Build the "${f.feature_name}" feature: ${f.description}
${f.tech_stack ? `Tech stack: ${f.tech_stack}` : ''}

Spawn 3 teammates working in parallel with strict directory ownership:

Agent 'backend' (ONLY touches /src/api/ and /src/services/):
  1. Design and output TypeScript interfaces to .claude-agent-team/api-design-${f.feature_name || 'feature'}.md FIRST
  2. Create ${f.feature_name}Service with CRUD operations
  3. Create REST API endpoints (GET, POST, PUT, DELETE)
  4. Write unit tests
  5. Update .claude-agent-team/progress-${f.feature_name || 'feature'}.md when done

Agent 'frontend' (ONLY touches /src/components/ and /src/pages/):
  WAIT for backend to output interfaces to .claude-agent-team/api-design-${f.feature_name || 'feature'}.md first
  1. Create React components using the interfaces
  2. Add state management (Redux slice or React Query)
  3. Connect components to API endpoints
  4. Update .claude-agent-team/progress-${f.feature_name || 'feature'}.md when done

Agent 'tests' (ONLY touches /src/__tests__/ and /e2e/):
  1. Write integration tests for API endpoints
  2. Write E2E test scenarios
  3. Update .claude-agent-team/progress-${f.feature_name || 'feature'}.md when done

Lead: coordinate, resolve blockers, create final summary.`,
  },
  {
    id: 'debug',
    icon: '🔬',
    label: 'Debug Bug',
    desc: 'Nhiều hypothesis test song song, debate để tìm root cause',
    defaultTeamSize: 3,
    fields: [
      { id: 'bug_desc',   label: 'Mô tả bug',             placeholder: 'e.g. App crashes after sending second message', required: true },
      { id: 'reproduce',  label: 'Cách reproduce',         placeholder: 'e.g. Login → send msg → send msg → crash', required: false },
      { id: 'hypotheses', label: 'Số hypothesis (2-5)',    placeholder: '3', required: false, type: 'number' },
    ],
    buildPrompt: (f) => {
      const n = Math.min(5, Math.max(2, parseInt(f.hypotheses) || 3))
      const hyps = [
        ['memory-leak', 'Memory leak or event listener not cleaned up', '/src/components/ for cleanup patterns'],
        ['state-corruption', 'Redux/state corruption on second action', '/src/store/ for reducer logic'],
        ['race-condition', 'Race condition in async/concurrent code', '/src/ for async patterns and Promise chains'],
        ['network', 'WebSocket or HTTP connection issue', '/src/ for network/socket code'],
        ['third-party', 'Third-party library bug or misconfiguration', 'package.json and library usage'],
      ].slice(0, n)
      return `Bug report: "${f.bug_desc}"
${f.reproduce ? `Steps to reproduce: ${f.reproduce}` : ''}

Spawn ${n} teammates to investigate competing hypotheses SIMULTANEOUSLY.
Each teammate writes findings to their file and actively tries to DISPROVE other hypotheses.

${hyps.map((h, i) => `Teammate ${i+1} - '${h[0]}':
  Hypothesis: ${h[1]}
  Investigate: ${h[2]}
  Write findings to: .claude-agent-team/hypothesis-${i+1}.md
  Include: evidence for, evidence against, files checked, confidence level (1-10)`).join('\n\n')}

After initial investigation (all teammates complete hypothesis files):
- Teammates: read each other's .claude-agent-team/hypothesis-*.md files
- Debate: respond to strongest competing evidence
- Lead: synthesize debate, identify most likely cause
- Lead: write root cause + fix to .claude-agent-team/root-cause-analysis.md`
    },
  },
  {
    id: 'research',
    icon: '📚',
    label: 'Research',
    desc: 'Nhiều góc nhìn độc lập, tổng hợp thành report',
    defaultTeamSize: 3,
    fields: [
      { id: 'topic',    label: 'Chủ đề nghiên cứu',      placeholder: 'e.g. Migrating from REST to GraphQL', required: true },
      { id: 'context',  label: 'Context dự án (optional)', placeholder: 'e.g. Node.js + React, 50k users/day', required: false },
    ],
    buildPrompt: (f) => `Research topic: "${f.topic}"
${f.context ? `Project context: ${f.context}` : ''}

Spawn 3 teammates to research different perspectives SIMULTANEOUSLY:

Teammate 'pros':
  Investigate advantages, benefits, and ideal use cases of "${f.topic}".
  Look for: performance gains, developer experience improvements, ecosystem support, real-world success stories.
  Write to: .claude-agent-team/pros.md

Teammate 'cons':
  Investigate disadvantages, risks, and failure cases of "${f.topic}".
  Look for: hidden complexity, migration costs, team learning curve, edge cases that break.
  Write to: .claude-agent-team/cons.md

Teammate 'alternatives':
  Research 2-3 alternative approaches to "${f.topic}".
  For each: brief description, pros/cons vs main topic, real-world usage.
  Write comparison table to: .claude-agent-team/alternatives.md

After all complete:
- Each teammate reads others' files and adds rebuttals if warranted
- Lead: synthesize into final recommendation at .claude-agent-team/summary.md
  Include: recommendation (Go / No-go / Conditional), rationale, risks to watch`,
  },
  {
    id: 'migration',
    icon: '🚀',
    label: 'Migration',
    desc: 'Migrate codebase song song: planner, executor, validator',
    defaultTeamSize: 3,
    fields: [
      { id: 'from',     label: 'Migrate từ',           placeholder: 'e.g. JavaScript, REST API, v1', required: true },
      { id: 'to',       label: 'Migrate sang',         placeholder: 'e.g. TypeScript, GraphQL, v2', required: true },
      { id: 'scope',    label: 'Phạm vi (optional)',   placeholder: 'e.g. /src/api/ only, ~50 files', required: false },
    ],
    buildPrompt: (f) => `Migration task: "${f.from}" → "${f.to}"
${f.scope ? `Scope: ${f.scope}` : ''}

Spawn 3 teammates:

Teammate 'architect' runs FIRST:
  1. Analyze the codebase to be migrated
  2. Create step-by-step migration plan
  3. List all files/modules to change with estimated complexity
  4. Write plan to: .claude-agent-team/migration-plan.md
  5. Identify any breaking changes and note them clearly
  Signal lead when plan is ready.

Teammate 'executor' (starts AFTER architect completes plan):
  1. Read .claude-agent-team/migration-plan.md
  2. Execute migration step by step
  3. Update .claude-agent-team/migration-progress.md after each file batch
  4. If blocked, write blocker to progress file and ask lead

Teammate 'validator' (runs IN PARALLEL with executor):
  1. Run existing tests on already-migrated files
  2. Identify regressions
  3. Write test results to: .claude-agent-team/migration-tests.md
  4. Alert executor if critical tests fail

Lead: coordinate timeline, resolve conflicts between executor and validator.`,
  },
  {
    id: 'security-audit',
    icon: '🛡️',
    label: 'Security Audit',
    desc: 'Toàn bộ codebase: OWASP, dependencies, secrets, config',
    defaultTeamSize: 4,
    fields: [
      { id: 'target',     label: 'Phạm vi audit',      placeholder: 'e.g. /src/, or full codebase', required: true },
      { id: 'app_type',   label: 'Loại app',           placeholder: 'e.g. REST API, Next.js fullstack, CLI tool', required: false },
    ],
    buildPrompt: (f) => `Security audit for: ${f.target}
${f.app_type ? `Application type: ${f.app_type}` : ''}

Spawn 4 security-focused teammates in parallel:

Teammate 'owasp':
  Check for OWASP Top 10 vulnerabilities:
  - Injection (SQL, Command, LDAP)
  - Broken authentication / session management
  - XSS (reflected, stored, DOM-based)
  - Insecure direct object references
  - Security misconfiguration
  Write to: .claude-agent-team/audit-owasp.md with file:line refs

Teammate 'secrets':
  Scan for exposed secrets and sensitive data:
  - Hardcoded API keys, passwords, tokens
  - .env files committed to repo
  - Private keys, certificates
  - PII in logs or error messages
  Write to: .claude-agent-team/audit-secrets.md

Teammate 'deps':
  Audit dependencies:
  - Known CVEs in dependencies (check package.json / requirements.txt)
  - Outdated packages with security patches available
  - Suspicious or typosquatting packages
  Write to: .claude-agent-team/audit-deps.md

Teammate 'config':
  Audit security configuration:
  - CORS settings
  - HTTP security headers (CSP, HSTS, etc.)
  - Authentication flow and token handling
  - Rate limiting and input validation
  Write to: .claude-agent-team/audit-config.md

Lead: create executive summary at .claude-agent-team/security-report.md
Priority order: Critical → High → Medium → Low
Include: total findings count, most critical issues, recommended immediate actions.`,
  },
  {
    id: 'documentation',
    icon: '📝',
    label: 'Tạo Documentation',
    desc: 'API docs, README, code comments song song',
    defaultTeamSize: 3,
    fields: [
      { id: 'scope',    label: 'Phạm vi',         placeholder: 'e.g. /src/api/, entire project', required: true },
      { id: 'audience', label: 'Đối tượng đọc',  placeholder: 'e.g. internal devs, external API users', required: false },
    ],
    buildPrompt: (f) => `Create comprehensive documentation for: ${f.scope}
${f.audience ? `Target audience: ${f.audience}` : ''}

Spawn 3 documentation teammates in parallel:

Teammate 'api-docs':
  Document all API endpoints and interfaces:
  - List every endpoint with method, path, params, response schema
  - Include example request/response for each
  - Note authentication requirements
  Write to: ./docs/api-reference.md

Teammate 'readme':
  Create/update README.md and setup guides:
  - Project overview and purpose
  - Prerequisites and installation steps
  - Configuration options with examples
  - Quick start guide
  - Troubleshooting section
  Write to: ./docs/setup-guide.md and update ./README.md

Teammate 'code-comments':
  Add JSDoc/TSDoc comments to undocumented functions and classes:
  - Focus on public APIs and complex logic
  - Add @param, @returns, @throws annotations
  - Add @example where helpful
  Update files in place.

Lead: create docs/index.md with overview and links to all documentation.`,
  },
  {
    id: 'refactor',
    icon: '♻️',
    label: 'Refactor',
    desc: 'Phân tích, lên kế hoạch, và refactor theo module',
    defaultTeamSize: 3,
    fields: [
      { id: 'target',   label: 'Code cần refactor',    placeholder: 'e.g. /src/utils/, legacy auth module', required: true },
      { id: 'goal',     label: 'Mục tiêu refactor',    placeholder: 'e.g. break into smaller modules, add TypeScript, improve testability', required: true },
    ],
    buildPrompt: (f) => `Refactor task: "${f.target}"
Goal: ${f.goal}

Spawn 3 teammates:

Teammate 'analyzer' runs FIRST:
  1. Analyze ${f.target} thoroughly
  2. Map all dependencies (what calls this code, what this code calls)
  3. Identify: code smells, complexity hotspots, missing tests, coupling issues
  4. Propose refactored architecture with module breakdown
  5. Write analysis + plan to: .claude-agent-team/refactor-plan.md
  Must complete before executor starts.

Teammate 'executor' (starts AFTER analyzer completes):
  1. Read .claude-agent-team/refactor-plan.md
  2. Implement refactoring step by step
  3. Maintain backward compatibility (exports/APIs unchanged unless noted in plan)
  4. Update .claude-agent-team/migration-progress.md after each step

Teammate 'test-guard' (runs IN PARALLEL with executor):
  1. Ensure existing tests still pass after each executor batch
  2. Write new tests for refactored code
  3. Report test coverage delta to .claude-agent-team/test-coverage.md
  4. Block executor if critical tests regress

Lead: resolve conflicts, ensure no breaking changes slip through.`,
  },
]
