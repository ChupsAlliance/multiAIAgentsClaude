import { SpeechBubble } from './SpeechBubble'

// Import all 6 character sprite sheets — Vite bundles these as valid URLs
import char0 from '../assets/sprites/char_0.png'
import char1 from '../assets/sprites/char_1.png'
import char2 from '../assets/sprites/char_2.png'
import char3 from '../assets/sprites/char_3.png'
import char4 from '../assets/sprites/char_4.png'
import char5 from '../assets/sprites/char_5.png'

const SPRITE_URLS = [char0, char1, char2, char3, char4, char5]

// Sprite sheet: 4 cols × 7 rows, each frame 16×32px
// Row mapping:
const ROW = {
  walkDown: 0, walkUp: 1, walkRight: 2,
  typingDown: 3, typingRight: 4,
  readingDown: 5, readingRight: 6,
}

// Direction constants matching AgentStateMapper
const DIR = { DOWN: 0, LEFT: 1, RIGHT: 2, UP: 3 }

/**
 * Returns { row, col, flip } for the current agent state + animation frame.
 * flip=true means apply scaleX(-1) (LEFT direction reuses RIGHT frames).
 */
function getFrameCoords(agentState, animFrame, dir) {
  const frame = animFrame ?? 0

  if (agentState === 'spawning') {
    const col = frame % 3
    if (dir === DIR.UP) return { row: ROW.walkUp, col, flip: false }
    if (dir === DIR.RIGHT) return { row: ROW.walkRight, col, flip: false }
    if (dir === DIR.LEFT) return { row: ROW.walkRight, col, flip: true }
    return { row: ROW.walkDown, col, flip: false }
  }

  if (agentState === 'reading') {
    const col = frame % 2
    if (dir === DIR.RIGHT) return { row: ROW.readingRight, col, flip: false }
    if (dir === DIR.LEFT) return { row: ROW.readingRight, col, flip: true }
    return { row: ROW.readingDown, col, flip: false }
  }

  // coding, working, waiting, managing, celebrating, idle → typing animation
  const col = frame % 2
  if (dir === DIR.RIGHT) return { row: ROW.typingRight, col, flip: false }
  if (dir === DIR.LEFT) return { row: ROW.typingRight, col, flip: true }
  return { row: ROW.typingDown, col, flip: false }
}

/**
 * AgentSprite — renders one agent as a positioned CSS sprite.
 *
 * Props:
 *   agent     — { name, characterIndex, state, deskSlot, speechBubble, speechBubbleExpiry }
 *   tileSize  — display pixels per tile
 *   animFrame — current animation frame index (0-3, driven by parent)
 *   animDir   — Direction constant (0=DOWN,1=LEFT,2=RIGHT,3=UP)
 */
export function AgentSprite({ agent, tileSize, animFrame, animDir }) {
  const ts = tileSize

  // Position — use desk tile or fallback to top-left area
  const tileX = agent.deskSlot?.tile?.x ?? 2
  const tileY = agent.deskSlot?.tile?.y ?? 2

  const spriteUrl = SPRITE_URLS[agent.characterIndex % 6]
  const { row, col, flip } = getFrameCoords(agent.state, animFrame, animDir ?? 0)

  // Sprite is 2 tiles tall (16×32 native)
  const spriteW = ts
  const spriteH = ts * 2

  // Center horizontally on tile, anchor bottom to tile top
  const left = tileX * ts + (ts - spriteW) / 2
  const top = tileY * ts - spriteH + ts

  // speech bubble visible?
  const now = Date.now()
  const bubbleText = agent.speechBubble &&
    (!agent.speechBubbleExpiry || now < agent.speechBubbleExpiry)
    ? agent.speechBubble : null

  const SHORT_NAME_MAX = 10
  const shortName = agent.name.length > SHORT_NAME_MAX
    ? agent.name.slice(0, SHORT_NAME_MAX - 1) + '…'
    : agent.name

  return (
    <div style={{
      position: 'absolute',
      left,
      top,
      width: spriteW,
      height: spriteH,
      zIndex: 10 + tileY, // z-sort by tile row
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
    }}>
      {/* Speech bubble (above sprite) */}
      <SpeechBubble text={bubbleText} />

      {/* Sprite frame */}
      <div style={{
        width: spriteW,
        height: spriteH,
        backgroundImage: `url(${spriteUrl})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: `-${col * ts}px -${row * ts * 2}px`,
        backgroundSize: `${4 * ts}px ${14 * ts}px`,
        imageRendering: 'pixelated',
        transform: flip ? 'scaleX(-1)' : 'none',
        flexShrink: 0,
      }} />

      {/* Name label */}
      <div style={{
        position: 'absolute',
        top: spriteH + 1,
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 8,
        fontFamily: 'monospace',
        color: 'rgba(255,255,255,0.8)',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}>
        {shortName}
      </div>
    </div>
  )
}
