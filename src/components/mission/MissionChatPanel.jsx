import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Send } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'

export function MissionChatPanel({ missionId }) {
  const [chats, setChats] = useState([])
  const [activeChatId, setActiveChatId] = useState(null)
  const [messages, setMessages] = useState([])
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  // Tracks the most recently requested chat id so slow, superseded fetches
  // (from openChat or handleAsk) don't clobber the UI once a newer chat is active.
  const activeChatIdRef = useRef(null)

  const refreshList = async () => {
    const list = await invoke('list_mission_chats', { missionId })
    setChats(list)
  }

  useEffect(() => { refreshList() }, [missionId])

  const openChat = async (chatId) => {
    setActiveChatId(chatId)
    activeChatIdRef.current = chatId
    const chat = await invoke('get_mission_chat', { missionId, chatId })
    if (activeChatIdRef.current === chatId) {
      setMessages(chat?.messages || [])
    }
  }

  const startNewChat = () => {
    setActiveChatId(null)
    activeChatIdRef.current = null
    setMessages([])
  }

  const handleAsk = async () => {
    const trimmed = question.trim()
    if (!trimmed || asking) return
    const askedForChatId = activeChatIdRef.current
    setAsking(true)
    setMessages(prev => [...prev, { role: 'user', content: trimmed, timestamp: Date.now() }])
    setQuestion('')
    try {
      const result = await invoke('ask_mission_chat', { missionId, chatId: askedForChatId, question: trimmed })
      if (activeChatIdRef.current === askedForChatId) {
        activeChatIdRef.current = result.chatId
        setActiveChatId(result.chatId)
        setMessages(prev => [...prev, { role: 'assistant', content: result.answer || `⚠ ${result.error}`, timestamp: Date.now() }])
      }
      await refreshList()
    } finally {
      setAsking(false)
    }
  }

  const handleDelete = async (chatId, e) => {
    e.stopPropagation()
    await invoke('delete_mission_chat', { missionId, chatId })
    if (activeChatId === chatId) startNewChat()
    await refreshList()
  }

  return (
    <div className="flex h-full gap-3">
      <div className="w-48 shrink-0 border-r border-vs-border/50 pr-2 overflow-y-auto">
        <button
          onClick={startNewChat}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 mb-2 rounded-md text-xs font-semibold
                     bg-vs-accent/10 hover:bg-vs-accent/20 text-vs-accent transition-colors"
        >
          <Plus size={12} /> New chat
        </button>
        {chats.map(c => (
          <div
            key={c.id}
            onClick={() => openChat(c.id)}
            className={`group flex items-center justify-between px-2 py-1.5 rounded-md cursor-pointer text-xs font-mono
                        ${activeChatId === c.id ? 'bg-vs-accent/10 text-vs-accent' : 'text-vs-text hover:bg-vs-bg-alt'}`}
          >
            <span className="truncate">{c.title}</span>
            <button onClick={(e) => handleDelete(c.id, e)} className="opacity-0 group-hover:opacity-100 shrink-0 ml-1">
              <Trash2 size={11} />
            </button>
          </div>
        ))}
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto space-y-3 pb-2">
          {messages.map((m, i) => (
            <div key={i} className={`text-xs font-mono ${m.role === 'user' ? 'text-vs-text' : 'text-vs-accent pl-3'}`}>
              {m.role === 'user' ? 'Q: ' : 'A: '}{m.content}
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-2 border-t border-vs-border/50">
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() } }}
            placeholder="Hỏi mission này..."
            className="flex-1 bg-vs-bg border border-vs-border rounded-md px-3 py-2 text-xs text-vs-text font-mono
                       placeholder-vs-muted/40 focus:outline-none focus:border-vs-accent/50"
          />
          <button
            onClick={handleAsk}
            disabled={!question.trim() || asking}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-semibold bg-vs-accent hover:bg-vs-accent/80
                       text-vs-heading disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
