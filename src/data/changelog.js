/**
 * Structured changelog data for in-app "What's New" display.
 * Each entry = one version. Items within a version are grouped by type.
 *
 * type:  'added' | 'changed' | 'fixed' | 'improved'
 * badge: optional short label shown as colored tag
 */

export const APP_VERSION = '0.1.0'

export const changelog = [
  {
    version: '0.1.0',
    date: '2026-03-14',
    title: 'First Release',
    highlights: [
      'Mission Control pipeline: Planning \u2192 ReviewPlan \u2192 Deploy \u2192 Execution',
      'Agent Teams + Standard execution modes',
      'In-app Changelog',
    ],
    items: [
      // ── Core ──
      { type: 'added', badge: 'Core',
        text: 'Mission lifecycle: Planning \u2192 ReviewPlan \u2192 PromptPreview \u2192 Deploy \u2192 Execution \u2192 Done' },
      { type: 'added', badge: 'Core',
        text: '2 execution modes: Agent Teams (TeamCreate/SendMessage) v\u00e0 Standard (Agent tool)' },
      { type: 'added', badge: 'Core',
        text: 'Replan \u2014 y\u00eau c\u1ea7u Lead l\u00ean plan m\u1edbi n\u1ebfu plan \u0111\u1ea7u kh\u00f4ng \u1ed5n' },
      { type: 'added', badge: 'Core',
        text: 'Intervention Panel \u2014 chat v\u1edbi Lead khi mission \u0111ang ch\u1ea1y' },
      { type: 'added', badge: 'Core',
        text: 'Stop Mission \u2014 d\u1eebng b\u1ea5t c\u1ee9 l\u00fac n\u00e0o, kill t\u1ea5t c\u1ea3 child processes' },

      // ── PlanReview ──
      { type: 'added', badge: 'PlanReview',
        text: 'Ch\u1ec9nh s\u1eeda agents: th\u00eam/b\u1edbt/\u0111\u1ed5i t\u00ean/\u0111\u1ed5i model (sonnet/opus/haiku)' },
      { type: 'added', badge: 'PlanReview',
        text: 'Ch\u1ec9nh s\u1eeda tasks: th\u00eam/b\u1edbt/s\u1eeda detail, drag-and-drop th\u1ee9 t\u1ef1' },
      { type: 'added', badge: 'PlanReview',
        text: 'PromptPreview \u2014 xem v\u00e0 ch\u1ec9nh raw prompt tr\u01b0\u1edbc khi deploy' },
      { type: 'added', badge: 'PlanReview',
        text: 'Bulk Skill \u2014 \u00e1p d\u1ee5ng m\u1ed9t skill file cho nhi\u1ec1u agents c\u00f9ng l\u00fac' },
      { type: 'added', badge: 'PlanReview',
        text: '"Set all" model buttons v\u1edbi active state highlight' },

      // ── Agent ──
      { type: 'added', badge: 'Agent',
        text: 'Agent model sync: model user ch\u1ecdn \u1edf PlanReview truy\u1ec1n ch\u00ednh x\u00e1c \u0111\u1ebfn Dashboard' },
      { type: 'added', badge: 'Agent',
        text: 'AgentCard: t\u00ean, role, model, status, current task' },
      { type: 'added', badge: 'Agent',
        text: 'Auto-detect agent roles t\u1eeb t\u00ean (e.g., "backend-api" \u2192 Backend Developer)' },

      // ── History / Fork ──
      { type: 'added', badge: 'History',
        text: 'Continue from History: full lifecycle (Planning \u2192 ReviewPlan \u2192 Deploy)' },
      { type: 'added', badge: 'History',
        text: 'Previous Work injection: t\u00f3m t\u1eaft tasks, logs, file changes t\u1eeb mission c\u0169' },
      { type: 'added', badge: 'History',
        text: 'Forked badge hi\u1ec3n th\u1ecb "\u21b3 t\u1eeb: <parent>" cho missions \u0111\u01b0\u1ee3c fork' },
      { type: 'added', badge: 'History',
        text: 'View (read-only) v\u00e0 Continue (ti\u1ebfp t\u1ee5c) modes' },

      // ── Intelligence ──
      { type: 'added', badge: 'Smart',
        text: 'Auto-detect project type: Vite, Next.js, Python, Rust, Go, Java' },
      { type: 'added', badge: 'Smart',
        text: 'Project-specific build gates trong deploy prompt' },
      { type: 'added', badge: 'Smart',
        text: 'Vietnamese detection \u2192 t\u1ef1 \u0111\u1ed9ng inject LANGUAGE REQUIREMENT' },

      // ── Prompt ──
      { type: 'added', badge: 'Prompt',
        text: 'External prompt templates (.md) \u2014 d\u1ec5 ch\u1ec9nh m\u00e0 kh\u00f4ng c\u1ea7n rebuild' },
      { type: 'added', badge: 'Prompt',
        text: '@mention: g\u00f5 @ \u0111\u1ec3 t\u00ecm v\u00e0 attach files t\u1eeb project' },
      { type: 'added', badge: 'Prompt',
        text: 'Reference materials: drag-drop files/folders/images v\u00e0o launcher' },

      // ── Dashboard ──
      { type: 'added', badge: 'Dashboard',
        text: 'Real-time log stream, file changes tracking, task tracking' },
      { type: 'added', badge: 'Dashboard',
        text: 'Agent status board v\u1edbi Spawning/Working/Idle/Done/Error' },
      { type: 'added', badge: 'Dashboard',
        text: 'Raw output panel xem stdout/stderr t\u1eeb Claude CLI' },

      // ── UI/UX ──
      { type: 'added', badge: 'UI',
        text: 'VS Code dark theme, sidebar navigation, onboarding page' },
      { type: 'added', badge: 'UI',
        text: 'Docs page: ARCHITECTURE.md, USER_GUIDE.md, FUNCTION_REFERENCE.md trong app' },

      // ── Build ──
      { type: 'added', badge: 'Build',
        text: 'Electron + Vite, Windows NSIS installer, patch system (apply-patch.bat)' },
      { type: 'added', badge: 'Build',
        text: '123 static analysis tests + CDP QC scripts' },

      // ── Fixes ──
      { type: 'fixed',
        text: 'ReviewPlan stuck: mission k\u1ebft th\u00fac khi \u0111ang \u1edf ReviewPlan \u2192 UI b\u1ecb stuck' },
      { type: 'fixed',
        text: 'Agent Teams env flag not set trong continue_mission' },
      { type: 'fixed',
        text: 'Planning phase blocked: thi\u1ebfu --dangerously-skip-permissions' },
      { type: 'fixed',
        text: 'Hydration race condition v\u1edbi ReviewPlan states' },
      { type: 'fixed',
        text: 'PlanReview state b\u1ecb m\u1ea5t khi v\u00e0o PromptPreview r\u1ed3i Back' },
      { type: 'fixed',
        text: '"Set all" model kh\u00f4ng gi\u1eef state khi edit th\u1ee9 kh\u00e1c' },
    ],
  },
  {
    version: '0.0.0',
    date: '2026-03-10',
    title: 'Internal Preview',
    highlights: [
      'Claude Code Agent Teams documentation app',
      'Playground for testing Claude CLI commands',
    ],
    items: [
      { type: 'added', badge: 'Docs',
        text: 'Documentation viewer v\u1edbi VS Code theme' },
      { type: 'added', badge: 'Docs',
        text: '10 sections h\u01b0\u1edbng d\u1eabn Claude Code Agent Teams' },
      { type: 'added', badge: 'Playground',
        text: 'Test Claude CLI commands tr\u1ef1c ti\u1ebfp trong app' },
      { type: 'added', badge: 'Setup',
        text: 'Onboarding page ki\u1ec3m tra Claude CLI + API key' },
      { type: 'added', badge: 'UI',
        text: 'Tauri desktop app v\u1edbi WebView2 (Windows)' },
    ],
  },
]
