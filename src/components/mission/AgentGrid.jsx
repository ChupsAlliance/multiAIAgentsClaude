import { memo } from 'react'
import { AgentCard } from './AgentCard'
import { Users } from 'lucide-react'

export const AgentGrid = memo(function AgentGrid({ agents = [], logs = [], selectedAgent, onSelectAgent }) {
  if (agents.length === 0) {
    return (
      <div className="flex items-center gap-2 text-vs-muted text-xs font-mono py-6 justify-center">
        <Users size={14} />
        <span>Chờ agents khởi tạo...</span>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-widest text-vs-muted font-mono px-1">
        Agents ({agents.length})
      </p>
      <div className="space-y-2">
        {agents.map((agent) => (
          <AgentCard
            key={agent.name}
            agent={agent}
            logs={logs}
            isSelected={selectedAgent === agent.name}
            onSelect={() => onSelectAgent(agent.name)}
          />
        ))}
      </div>
    </div>
  )
})
