import { useState, useEffect, useRef } from 'react'
import { Send } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'

export function AskMissionPanel() {
  const [question, setQuestion] = useState('')
  const [pairs, setPairs] = useState([])
  const [asking, setAsking] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    const unlisten = window.electronAPI?.on('mission:companion-answer', (data) => {
      // The backend stamps its own fresh `timestamp` at process-close time, which never
      // matches the client-side `timestamp` we generated at submit time — so match on the
      // question text instead (shared verbatim between request and event payload), guarded
      // by `pending === true` so a stale identical past question can't be re-matched. Only
      // the most recent pending match is updated, in case more than one pending pair with
      // the same question text somehow exists.
      setPairs(prev => {
        const lastPendingIdx = prev.map(p => p.pending && p.question === data.question).lastIndexOf(true)
        if (lastPendingIdx === -1) return prev
        return prev.map((p, i) => i === lastPendingIdx ? { ...p, answer: data.answer, pending: false } : p)
      })
    })
    return () => unlisten && unlisten()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [pairs])

  const handleAsk = async () => {
    const trimmed = question.trim()
    if (!trimmed || asking) return
    const timestamp = Date.now()
    setPairs(prev => [...prev, { question: trimmed, answer: null, pending: true, timestamp }])
    setQuestion('')
    setAsking(true)
    try {
      const result = await invoke('ask_mission_live', { question: trimmed })
      setPairs(prev => prev.map(p => p.timestamp === timestamp
        ? { ...p, answer: result.error ? `⚠ ${result.error}` : result.answer, pending: false }
        : p))
    } catch (err) {
      setPairs(prev => prev.map(p => p.timestamp === timestamp ? { ...p, answer: `⚠ ${err.message}`, pending: false } : p))
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 scrollbar-thin pb-2">
        {pairs.length === 0 && (
          <p className="text-[11px] text-vs-muted font-mono">
            Hỏi bất cứ điều gì về mission đang chạy — không làm gián đoạn Lead.
          </p>
        )}
        {pairs.map((p) => (
          <div key={p.timestamp} className="space-y-1">
            <div className="text-xs text-vs-text font-mono">Q: {p.question}</div>
            <div className="text-xs text-vs-accent font-mono pl-3">
              {p.pending ? 'Đang suy nghĩ…' : `A: ${p.answer ?? '(no answer)'}`}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 pt-2 border-t border-vs-border/50">
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk() } }}
          placeholder="Hỏi mission đang chạy..."
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
  )
}
