import { useState } from 'react'
import { Eye, Edit3, ChevronDown, ChevronRight, Play, ArrowLeft, Save, FolderOpen } from 'lucide-react'

function generateAgentPrompt(agent, tasks, projectPath) {
  const agentTasks = tasks.filter(t =>
    (t.assigned_agent || t.agent) === agent.name
  )
  const taskList = agentTasks.map((t, i) =>
    `${i + 1}. ${t.title}${t.priority === 'high' ? ' [HIGH PRIORITY]' : ''}`
  ).join('\n')

  return `You are "${agent.name}" — ${agent.role}.

Working directory: ${projectPath}

## Your Tasks
${taskList || '(No tasks assigned)'}

${agent.customPrompt ? `## Additional Instructions\n${agent.customPrompt}\n` : ''}
## Rules
1. cd into the working directory first
2. Complete ALL tasks listed above
3. Write files, install dependencies, run commands, debug any errors
4. Do NOT stop until all tasks are done AND verified working
5. Print "[${agent.name}] Starting: <task>" before each task
6. Print "[${agent.name}] Completed: <task>" after each task

## Quality Requirements (CRITICAL)
You are shipping PRODUCTION code, not just writing files. For EVERY piece of work:
1. **Install dependencies** — if you create code that uses packages (express, playwright, etc.), run \`npm install\` to install them
2. **Run and verify** — if you create a server, start it and verify it responds correctly (e.g., curl/fetch a test request)
3. **Run tests** — if you write tests, EXECUTE them and ensure they PASS. Do not just create test files
4. **Debug until green** — if tests fail or code errors, fix and re-run until everything passes
5. **Never leave broken code** — if something doesn't work, you MUST fix it before marking the task as completed
6. **Self-verify checklist** before reporting completion:
   - [ ] All files created and saved
   - [ ] Dependencies installed (npm install, pip install, etc.)
   - [ ] Code compiles / lints without errors
   - [ ] Server starts successfully (if applicable)
   - [ ] Tests pass (if applicable)
   - [ ] Manual smoke test performed (curl, open browser, etc.)`
}

function PromptCard({ agent, prompt, onEdit, onSave }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(prompt)

  const handleSave = () => {
    onSave(editValue)
    setEditing(false)
  }

  return (
    <div className="border border-vs-border rounded-lg overflow-hidden bg-vs-panel">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-white/5"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded
            ? <ChevronDown size={12} className="text-vs-muted shrink-0" />
            : <ChevronRight size={12} className="text-vs-muted shrink-0" />
          }
          <span className="text-xs font-bold text-white truncate">{agent.name}</span>
          <span className="text-[10px] text-vs-muted font-mono truncate">({agent.role})</span>
          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
            agent.model === 'opus' ? 'bg-purple-400/10 text-purple-400' :
            agent.model === 'haiku' ? 'bg-green-400/10 text-green-400' :
            'bg-blue-400/10 text-blue-400'
          }`}>
            {agent.model || 'sonnet'}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!editing && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(true); setEditing(true); }}
              className="p-1 hover:bg-white/10 rounded text-vs-muted hover:text-white"
              title="Chỉnh sửa prompt"
            >
              <Edit3 size={11} />
            </button>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-vs-border">
          {editing ? (
            <div className="p-3">
              <textarea
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                className="w-full bg-vs-bg border border-vs-border rounded p-3 text-xs font-mono
                           text-vs-text focus:outline-none focus:border-vs-accent resize-y min-h-[200px]"
                rows={12}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1 px-3 py-1.5 bg-vs-accent text-white rounded text-xs hover:bg-vs-accent2"
                >
                  <Save size={10} /> Lưu
                </button>
                <button
                  onClick={() => { setEditing(false); setEditValue(prompt); }}
                  className="flex items-center gap-1 px-3 py-1.5 border border-vs-border text-vs-text rounded text-xs hover:bg-white/5"
                >
                  Hủy
                </button>
              </div>
            </div>
          ) : (
            <pre className="p-3 text-[10px] font-mono text-vs-text whitespace-pre-wrap leading-relaxed max-h-[250px] overflow-y-auto scrollbar-thin">
              {prompt}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export function PromptPreview({ agents, tasks, projectPath, onConfirm, onBack }) {
  const [prompts, setPrompts] = useState(() =>
    Object.fromEntries(
      agents.map(a => [a.name, generateAgentPrompt(a, tasks, projectPath)])
    )
  )

  const handleUpdatePrompt = (agentName, newPrompt) => {
    setPrompts(prev => ({ ...prev, [agentName]: newPrompt }))
  }

  const handleConfirm = () => {
    // Pass the (possibly edited) prompts along with agents/tasks
    const agentsWithPrompts = agents.map(a => ({
      ...a,
      customPrompt: prompts[a.name] || '',
    }))
    onConfirm(agentsWithPrompts, tasks)
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Eye size={14} className="text-vs-accent" />
            Xem trước Prompts
          </h2>
          <p className="text-[10px] text-vs-muted font-mono mt-0.5">
            Kiểm tra và chỉnh sửa prompt cho từng agent trước khi deploy
          </p>
        </div>
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-3 py-1.5 border border-vs-border text-vs-text rounded text-xs hover:bg-white/5"
        >
          <ArrowLeft size={10} /> Quay lại
        </button>
      </div>

      {/* Project path */}
      <div className="flex items-center gap-2 px-3 py-2 bg-vs-panel rounded border border-vs-border text-[10px] font-mono">
        <FolderOpen size={11} className="text-vs-muted shrink-0" />
        <span className="text-vs-muted">Project:</span>
        <span className="text-vs-text truncate">{projectPath}</span>
      </div>

      {/* Agent prompts */}
      <div className="space-y-2">
        {agents.map(agent => (
          <PromptCard
            key={agent.name}
            agent={agent}
            prompt={prompts[agent.name]}
            onSave={(newPrompt) => handleUpdatePrompt(agent.name, newPrompt)}
          />
        ))}
      </div>

      {/* Deploy button */}
      <div className="flex gap-2 pt-2 border-t border-vs-border">
        <button
          onClick={handleConfirm}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-vs-green/20 text-vs-green
                     border border-vs-green/30 rounded-lg text-xs font-mono font-bold
                     hover:bg-vs-green/30 transition-colors"
        >
          <Play size={12} />
          Deploy Mission
        </button>
      </div>
    </div>
  )
}
