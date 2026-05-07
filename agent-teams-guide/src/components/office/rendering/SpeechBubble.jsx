// SpeechBubble.jsx — CSS speech bubble shown above an agent tile
export function SpeechBubble({ text }) {
  if (!text) return null
  const MAX_CHARS = 24
  const label = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS - 1) + '…' : text

  return (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%)',
      marginBottom: 4,
      whiteSpace: 'nowrap',
      zIndex: 20,
      pointerEvents: 'none',
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.92)',
        border: '1px solid rgba(0,0,0,0.15)',
        borderRadius: 4,
        padding: '2px 5px',
        fontSize: 9,
        fontFamily: 'monospace',
        color: '#222',
        lineHeight: 1.4,
      }}>
        {label}
      </div>
      {/* Tail */}
      <div style={{
        width: 0, height: 0,
        borderLeft: '4px solid transparent',
        borderRight: '4px solid transparent',
        borderTop: '4px solid rgba(255,255,255,0.92)',
        margin: '0 auto',
      }} />
    </div>
  )
}
