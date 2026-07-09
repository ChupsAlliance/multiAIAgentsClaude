import { useState, useCallback, useEffect } from 'react'
import { HelpCircle, CheckCircle, SkipForward, Send, AlertCircle } from 'lucide-react'

// ─── QuestionCard ─────────────────────────────────────────────
// Multi-question UI for Agent Question Protocol.
// Shows tabs for each question, options, free text, skip, and submit.
// ──────────────────────────────────────────────────────────────

const TYPE_LABELS = {
  clarification: 'Clarification',
  decision: 'Decision',
  credentials: 'Credentials',
  information: 'Information',
}

function QuestionTab({ index, question, answer, isActive, onClick }) {
  const answered = answer != null && answer !== ''
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
        isActive
          ? 'bg-vs-accent/20 border border-vs-accent text-white'
          : answered
            ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : 'bg-vs-bg border border-vs-border text-vs-muted hover:border-vs-text/30 hover:text-vs-text'
      }`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${
        answered ? 'bg-green-400' : isActive ? 'bg-vs-accent' : 'bg-vs-border'
      }`} />
      {answered
        ? <CheckCircle size={10} />
        : <span className="text-[11px]">Q{index + 1}</span>
      }
    </button>
  )
}

export function QuestionCard({ questions, onSubmit }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [answers, setAnswers] = useState(() =>
    questions.map(() => ({ selectedOption: null, freeText: '', skipped: false }))
  )

  // Reset answers when questions change
  useEffect(() => {
    setAnswers(questions.map(() => ({ selectedOption: null, freeText: '', skipped: false })))
    setActiveIndex(0)
  }, [questions])

  const current = questions[activeIndex]
  const currentAnswer = answers[activeIndex]

  const answeredCount = answers.filter(a =>
    a.skipped || a.selectedOption != null || a.freeText.trim()
  ).length

  const allAnswered = answeredCount === questions.length

  const setAnswer = useCallback((index, update) => {
    setAnswers(prev => prev.map((a, i) => i === index ? { ...a, ...update } : a))
  }, [])

  const handleSelectOption = (option) => {
    setAnswer(activeIndex, { selectedOption: option, skipped: false })
    // Auto-advance to next unanswered question after brief delay
    const next = answers.findIndex((a, i) =>
      i > activeIndex && !a.skipped && a.selectedOption == null && !a.freeText.trim()
    )
    if (next !== -1) setTimeout(() => setActiveIndex(next), 150)
  }

  const handleFreeText = (text) => {
    setAnswer(activeIndex, { freeText: text })
  }

  const handleSkip = () => {
    setAnswer(activeIndex, { skipped: true, selectedOption: null, freeText: '' })
    // Auto-advance to next unanswered question
    const next = answers.findIndex((a, i) =>
      i > activeIndex && !a.skipped && a.selectedOption == null && !a.freeText.trim()
    )
    if (next !== -1) setActiveIndex(next)
  }

  const handleSubmit = () => {
    const formattedAnswers = answers.map((a, i) => {
      if (a.skipped) {
        return {
          question_index: i,
          answer: '__SKIP__',
          note: 'User skipped. Choose the most optimal approach that best fits the current architecture.',
        }
      }
      const answer = a.freeText.trim() || a.selectedOption || ''
      const note = a.selectedOption && a.freeText.trim()
        ? a.freeText.trim()  // Free text is "note" when option also selected
        : ''
      return { question_index: i, answer, note }
    })
    onSubmit(formattedAnswers)
  }

  // Browser notification when questions arrive
  useEffect(() => {
    if (questions.length > 0 && document.hidden && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification('Agent Teams Guide', {
          body: `Lead has ${questions.length} question(s) for you`,
          icon: '/favicon.ico',
        })
      } else if (Notification.permission !== 'denied') {
        Notification.requestPermission()
      }
    }
  }, [questions])

  if (!current) return null

  return (
    <div className="border border-amber-500/40 rounded-lg overflow-hidden bg-amber-500/5 animate-pulse-subtle">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
        <div className="flex items-center gap-2">
          <HelpCircle size={16} className="text-amber-400" />
          <span className="text-sm font-semibold text-amber-300">
            {answeredCount === questions.length
              ? `Đã trả lời ${answeredCount}/${questions.length} câu`
              : `Lead đang hỏi câu ${activeIndex + 1}/${questions.length}`
            }
          </span>
        </div>
        <span className="text-xs text-amber-400/70 font-mono">
          {answeredCount}/{questions.length} answered
        </span>
      </div>

      {/* Tab switcher (only show if multiple questions) */}
      {questions.length > 1 && (
        <div className="flex gap-1.5 px-4 py-2 border-b border-vs-border/30 overflow-x-auto">
          {questions.map((q, i) => (
            <QuestionTab
              key={i}
              index={i}
              question={q}
              answer={
                answers[i]?.skipped ? '__SKIP__'
                : answers[i]?.selectedOption || answers[i]?.freeText || null
              }
              isActive={i === activeIndex}
              onClick={() => setActiveIndex(i)}
            />
          ))}
        </div>
      )}

      {/* Progress bar */}
      <div className="h-0.5 bg-vs-border/30">
        <div
          className="h-full bg-vs-accent transition-all duration-300"
          style={{ width: `${(answeredCount / questions.length) * 100}%` }}
        />
      </div>

      {/* Question content */}
      <div className="px-4 py-3 space-y-3">
        {/* Type badge + question */}
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-vs-border/50 text-vs-muted font-mono uppercase">
              {TYPE_LABELS[current.type] || current.type || 'Question'}
            </span>
            {current.from && (
              <span className="text-[10px] text-vs-muted font-mono">from {current.from}</span>
            )}
          </div>
          <p className="text-sm text-white font-medium leading-relaxed">{current.question}</p>
        </div>

        {/* Context */}
        {current.context && (
          <div className="flex items-start gap-2 bg-vs-bg/60 rounded-md px-3 py-2 border border-vs-border/30">
            <AlertCircle size={12} className="text-vs-muted mt-0.5 shrink-0" />
            <p className="text-xs text-vs-muted leading-relaxed">{current.context}</p>
          </div>
        )}

        {/* Options */}
        {current.options && current.options.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {current.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleSelectOption(opt)}
                className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                  currentAnswer.selectedOption === opt
                    ? 'bg-vs-accent/20 border border-vs-accent text-white'
                    : 'bg-vs-bg border border-vs-border text-vs-muted hover:border-vs-text/30 hover:text-vs-text'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {/* Free text */}
        <textarea
          value={currentAnswer.freeText}
          onChange={e => handleFreeText(e.target.value)}
          placeholder={current.options?.length
            ? 'Additional notes (optional)...'
            : 'Your answer...'
          }
          rows={2}
          className="w-full bg-vs-bg/80 border border-vs-border/50 rounded-md px-3 py-2 text-xs text-vs-text
                     font-mono placeholder-vs-muted/40 resize-none
                     focus:outline-none focus:border-vs-accent/50"
        />

        {/* Skip + Submit row */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={handleSkip}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-mono transition-colors ${
              currentAnswer.skipped
                ? 'bg-vs-muted/20 text-vs-muted border border-vs-muted/30'
                : 'text-vs-muted hover:text-vs-text hover:bg-vs-bg/50'
            }`}
          >
            <SkipForward size={11} />
            {currentAnswer.skipped ? 'Skipped' : 'Skip this question'}
          </button>

          <button
            onClick={handleSubmit}
            disabled={!allAnswered}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-semibold transition-colors ${
              allAnswered
                ? 'bg-vs-accent text-white hover:bg-vs-accent/80'
                : 'bg-vs-border/50 text-vs-muted/50 cursor-not-allowed'
            }`}
          >
            <Send size={12} />
            Submit All Answers
          </button>
        </div>
      </div>
    </div>
  )
}
