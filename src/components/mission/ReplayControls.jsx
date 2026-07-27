import { useRef, useCallback, useMemo } from 'react'
import { Play, Pause, LogOut, Zap } from 'lucide-react'

const SPEEDS = [
  { id: 1, label: '1x' },
  { id: 2, label: '2x' },
  { id: 5, label: '5x' },
  { id: 'instant', label: 'Tức thời' },
]

function formatMs(ms) {
  const totalSec = Math.max(0, Math.floor((ms || 0) / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Thanh điều khiển Playback dùng chung: play/pause, tốc độ, thanh tua có mốc bước, thoát.
 * props: { isPlaying, speed, currentMs, totalMs, stepMarkers, onPlayPause, onSpeedChange, onSeek, onExit, dim }
 *  - stepMarkers: [{ ms, type, label }]
 *  - dim: khi true hiển thị dạng overlay mờ (dùng cho Presentation Mode)
 */
export function ReplayControls({
  isPlaying, speed, currentMs, totalMs, stepMarkers = [],
  onPlayPause, onSpeedChange, onSeek, onExit, dim = false,
}) {
  const trackRef = useRef(null)

  const progressPct = totalMs > 0 ? Math.min(100, (currentMs / totalMs) * 100) : 0

  const handleTrackClick = useCallback((e) => {
    const track = trackRef.current
    if (!track || totalMs <= 0) return
    const rect = track.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    onSeek?.(Math.round(ratio * totalMs))
  }, [totalMs, onSeek])

  const markerPositions = useMemo(() => {
    if (totalMs <= 0) return []
    return stepMarkers.map(m => ({ ...m, pct: Math.min(100, Math.max(0, (m.ms / totalMs) * 100)) }))
  }, [stepMarkers, totalMs])

  return (
    <div
      data-testid="replay-controls"
      className={`flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md transition-opacity ${
        dim
          ? 'bg-[#000000b3] border-[#ffffff1a]'
          : 'bg-vs-panel/95 border-vs-border shadow-xl'
      }`}
    >
      {/* Play / Pause */}
      <button
        onClick={onPlayPause}
        title={isPlaying ? 'Tạm dừng' : 'Phát'}
        data-testid="btn-replay-play-pause"
        className={`flex items-center justify-center w-9 h-9 rounded-full shrink-0 transition-colors ${
          dim
            ? 'bg-[#ffffff1a] text-[#ffffff] hover:bg-[#ffffff33]'
            : 'bg-vs-accent text-vs-heading hover:bg-vs-accent/80'
        }`}
      >
        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
      </button>

      {/* Current time */}
      <span className={`text-[11px] font-mono shrink-0 tabular-nums ${dim ? 'text-[#ffffffb3]' : 'text-vs-muted'}`}>
        {formatMs(currentMs)}
      </span>

      {/* Seek track with step markers */}
      <div className="flex-1 min-w-[120px] relative">
        <div
          ref={trackRef}
          onClick={handleTrackClick}
          data-testid="replay-seek-track"
          className={`relative h-1.5 rounded-full cursor-pointer group ${dim ? 'bg-[#ffffff26]' : 'bg-vs-border'}`}
        >
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${dim ? 'bg-[#ffffffb3]' : 'bg-vs-accent'}`}
            style={{ width: `${progressPct}%` }}
          />
          {/* Playhead */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 transition-transform group-hover:scale-125 ${
              dim ? 'bg-[#ffffff] border-[#ffffff80]' : 'bg-vs-accent border-vs-heading'
            }`}
            style={{ left: `${progressPct}%` }}
          />
          {/* Step markers */}
          {markerPositions.map((m, i) => (
            <div
              key={i}
              title={m.label}
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full pointer-events-none ${
                dim ? 'bg-yellow-300/90' : 'bg-yellow-500'
              }`}
              style={{ left: `${m.pct}%` }}
            />
          ))}
        </div>
      </div>

      {/* Total time */}
      <span className={`text-[11px] font-mono shrink-0 tabular-nums ${dim ? 'text-[#ffffffb3]' : 'text-vs-muted'}`}>
        {formatMs(totalMs)}
      </span>

      {/* Speed selector */}
      <div className={`flex items-center gap-0.5 rounded-lg p-0.5 shrink-0 ${dim ? 'bg-[#ffffff1a]' : 'bg-vs-bg border border-vs-border'}`}>
        {SPEEDS.map(s => (
          <button
            key={s.id}
            onClick={() => onSpeedChange?.(s.id)}
            data-testid={`btn-replay-speed-${s.id}`}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono transition-colors ${
              speed === s.id
                ? dim ? 'bg-[#ffffff40] text-[#ffffff]' : 'bg-vs-accent/20 text-vs-accent'
                : dim ? 'text-[#ffffff80] hover:text-[#ffffffcc]' : 'text-vs-muted hover:text-vs-text'
            }`}
          >
            {s.id === 'instant' && <Zap size={9} />}
            {s.label}
          </button>
        ))}
      </div>

      {/* Exit */}
      <button
        onClick={onExit}
        title="Thoát Phát lại"
        data-testid="btn-replay-exit"
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-mono shrink-0 transition-colors ${
          dim
            ? 'text-[#ffffffb3] hover:text-[#ffffff] hover:bg-[#ffffff1a]'
            : 'text-vs-muted hover:text-vs-red hover:bg-vs-red/10'
        }`}
      >
        <LogOut size={12} />
        Thoát Phát lại
      </button>
    </div>
  )
}
