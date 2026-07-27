import { useState, useEffect, useRef } from 'react'

// ── Unicode-safe character splitting ──
// Vietnamese text combines base letters with combining diacritics (tone marks,
// breve/circumflex modifiers) which can be represented as separate Unicode code
// points (NFD) or precomposed (NFC). Splitting naively with `str[i]` (UTF-16
// code units) can break some CJK/emoji but is safe for Vietnamese NFC text —
// still, we use the Intl.Segmenter grapheme iterator when available for full
// correctness (handles combining marks, emoji, surrogate pairs uniformly).
function splitGraphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    try {
      const seg = new Intl.Segmenter('vi', { granularity: 'grapheme' })
      return Array.from(seg.segment(text), s => s.segment)
    } catch (_) {
      // fall through
    }
  }
  // Fallback: Array.from handles surrogate pairs (emoji) correctly but not
  // combining diacritics — acceptable fallback for older environments.
  return Array.from(text)
}

/**
 * Hiệu ứng gõ chữ (typewriter) — hiển thị dần từng ký tự.
 * Hỗ trợ Unicode tiếng Việt đầy đủ (dùng Intl.Segmenter để tách grapheme
 * đúng, tránh vỡ ký tự có dấu).
 *
 * props:
 *  - text: string — nội dung cần hiển thị
 *  - charsPerSecond: number — tốc độ gõ (điều chỉnh theo replay speed)
 *  - onDone: () => void — gọi khi gõ xong
 *  - as: string — thẻ HTML bao ngoài (mặc định 'span')
 *  - className: string
 *  - instant: boolean — nếu true, hiển thị toàn bộ ngay lập tức (dùng cho tốc độ "Tức thời")
 */
export function TypewriterText({ text, charsPerSecond = 40, onDone, as: Tag = 'span', className = '', instant = false }) {
  const graphemes = useRef([])
  const [visibleCount, setVisibleCount] = useState(instant ? null : 0)
  const intervalRef = useRef(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    graphemes.current = splitGraphemes(text || '')

    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    if (instant || charsPerSecond <= 0) {
      setVisibleCount(graphemes.current.length)
      onDoneRef.current?.()
      return
    }

    setVisibleCount(0)
    const intervalMs = Math.max(1000 / Math.max(charsPerSecond, 1), 4)
    let count = 0
    intervalRef.current = setInterval(() => {
      count += 1
      if (count >= graphemes.current.length) {
        setVisibleCount(graphemes.current.length)
        clearInterval(intervalRef.current)
        intervalRef.current = null
        onDoneRef.current?.()
      } else {
        setVisibleCount(count)
      }
    }, intervalMs)

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [text, charsPerSecond, instant])

  const shown = instant
    ? (text || '')
    : graphemes.current.slice(0, visibleCount ?? 0).join('')

  const isTyping = !instant && (visibleCount ?? 0) < graphemes.current.length

  return (
    <Tag data-testid="typewriter-text" className={className}>
      {shown}
      {isTyping && <span className="inline-block w-[0.5em] h-[1em] align-middle bg-current opacity-70 animate-pulse ml-0.5" />}
    </Tag>
  )
}
