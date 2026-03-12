import { useState, useEffect, useMemo, useCallback, memo } from 'react'
import { AgentGrid } from './AgentGrid'
import { TaskList } from './TaskList'
import { ActivityLog } from './ActivityLog'
import { FileChangesPanel } from './FileChangesPanel'
import { MessagesPanel } from './MessagesPanel'
import { MissionHeader } from './MissionHeader'
import { RawOutput } from './RawOutput'
import { ThinkingIndicator } from './ThinkingIndicator'
import { InterventionPanel } from './InterventionPanel'
import { ListTodo, Activity, FolderOpen, User, MessageSquare } from 'lucide-react'

const baseTabs = [
  { id: 'tasks',    label: 'Tasks',    icon: ListTodo },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'files',    label: 'Files',    icon: FolderOpen },
]

export const MissionDashboard = memo(function MissionDashboard({ state, isRunning, onStop, onContinue, onNewMission, elapsed, isHistoryView }) {
  const [activeTab, setActiveTab] = useState('tasks')
  const [selectedAgent, setSelectedAgent] = useState(null)

  // Stable refs to state sub-arrays — avoid creating new array refs on every render
  const agents = useMemo(() => state?.agents || [], [state?.agents])
  const logs = useMemo(() => state?.log || [], [state?.log])
  const tasks = useMemo(() => state?.tasks || [], [state?.tasks])
  const messages = useMemo(() => state?.messages || [], [state?.messages])
  const fileChanges = useMemo(() => state?.file_changes || [], [state?.file_changes])
  const rawOutput = useMemo(() => state?.raw_output || [], [state?.raw_output])

  // Show thinking indicator when running but no meaningful agent output yet
  const isThinking = useMemo(() => {
    if (!isRunning) return false
    const meaningful = logs.filter(l => l.log_type !== 'error' && l.agent !== 'System')
    return meaningful.length <= 2
  }, [isRunning, logs])

  // Only show Messages tab when there are actual messages (agent_teams mode)
  const hasMessages = messages.length > 0
  const visibleBaseTabs = hasMessages
    ? baseTabs
    : baseTabs.filter(t => t.id !== 'messages')

  // Reset to tasks tab if messages tab gets hidden
  useEffect(() => {
    if (activeTab === 'messages' && !hasMessages) {
      setActiveTab('tasks')
    }
  }, [hasMessages, activeTab])

  // Build dynamic tabs — add agent tab when one is selected
  const tabs = selectedAgent
    ? [...visibleBaseTabs, { id: 'agent', label: selectedAgent, icon: User }]
    : visibleBaseTabs

  // When agent is selected, auto-switch to its tab
  const handleSelectAgent = useCallback((name) => {
    setSelectedAgent(prev => {
      if (prev === name) {
        setActiveTab(at => at === 'agent' ? 'tasks' : at)
        return null
      }
      setActiveTab('agent')
      return name
    })
  }, [])

  // Filtered logs for selected agent
  const agentLogs = useMemo(
    () => selectedAgent ? logs.filter(l => l.agent === selectedAgent) : [],
    [logs, selectedAgent]
  )

  return (
    <div className="flex flex-col h-full bg-vs-bg rounded-lg border border-vs-border overflow-hidden">
      {/* History view banner */}
      {isHistoryView && (
        <div className="flex items-center justify-between px-4 py-1.5 bg-vs-accent/10 border-b border-vs-accent/30 shrink-0">
          <span className="text-[11px] font-mono text-vs-accent">
            📋 Đang xem mission history (read-only)
          </span>
          <button
            onClick={onNewMission}
            className="text-[10px] font-mono text-vs-muted hover:text-white transition-colors px-2 py-0.5 rounded border border-vs-border hover:border-vs-accent"
          >
            ← Quay lại
          </button>
        </div>
      )}
      {/* Header */}
      <MissionHeader state={state} onStop={isHistoryView ? null : onStop} onNewMission={onNewMission} elapsed={elapsed} />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Agent Grid */}
        <div className="w-56 shrink-0 border-r border-vs-border overflow-y-auto p-3 scrollbar-thin">
          <AgentGrid
            agents={agents}
            logs={logs}
            selectedAgent={selectedAgent}
            onSelectAgent={handleSelectAgent}
          />
        </div>

        {/* Right: Tabbed panel or Thinking indicator */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {isThinking ? (
            <ThinkingIndicator
              log={logs}
              isRunning={isRunning}
            />
          ) : (
            <>
              {/* Tab bar */}
              <div className="flex border-b border-vs-border overflow-x-auto">
                {tabs.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setActiveTab(id)}
                    className={`flex items-center gap-1.5 px-4 py-2 text-xs font-mono transition-colors border-b-2 shrink-0 ${
                      activeTab === id
                        ? 'border-vs-accent text-white bg-vs-accent/5'
                        : 'border-transparent text-vs-muted hover:text-vs-text hover:bg-white/5'
                    }`}
                  >
                    <Icon size={12} />
                    <span className="truncate max-w-[120px]">{label}</span>
                    {id === 'tasks' && tasks.length > 0 && (
                      <span className="ml-1 px-1 rounded bg-vs-accent/20 text-vs-accent text-[10px]">
                        {tasks.filter(t => t.status === 'completed').length}/{tasks.length}
                      </span>
                    )}
                    {id === 'messages' && messages.length > 0 && (
                      <span className="ml-1 px-1 rounded bg-cyan-500/20 text-cyan-300 text-[10px]">
                        {messages.length}
                      </span>
                    )}
                    {id === 'agent' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedAgent(null); setActiveTab('tasks'); }}
                        className="ml-1 text-vs-muted hover:text-white text-[10px]"
                        title="Close agent view"
                      >
                        ×
                      </button>
                    )}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 scrollbar-thin min-h-0">
                {activeTab === 'tasks' && <TaskList tasks={tasks} logs={logs} />}
                {activeTab === 'activity' && <ActivityLog log={logs} />}
                {activeTab === 'messages' && <MessagesPanel messages={messages} />}
                {activeTab === 'files' && <FileChangesPanel changes={fileChanges} />}
                {activeTab === 'agent' && selectedAgent && (
                  <ActivityLog log={agentLogs} title={`Logs: ${selectedAgent}`} />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Intervention panel */}
      <InterventionPanel
        onSend={onContinue}
        isRunning={isRunning}
        disabled={!state}
      />

      {/* Raw output (collapsible at bottom) */}
      <RawOutput lines={rawOutput} />
    </div>
  )
})
