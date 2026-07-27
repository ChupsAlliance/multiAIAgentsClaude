import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Presentation } from 'lucide-react'
import { useReplay } from '../hooks/useReplay'
import { ReplayControls } from '../components/mission/ReplayControls'
import { PresentationTimeline } from '../components/mission/PresentationTimeline'

const AUTO_HIDE_MS = 3000

// Tốc độ gõ chữ cơ bản (ký tự/giây) — nhân theo speed để "rút ngắn animation"
// đúng yêu cầu (2x/5x/Instant rút ngắn animation tương ứng).
const BASE_CPS = 45

export function PresentationModePage() {
  const { recordingId } = useParams()
  const navigate = useNavigate()
  const {
    replayMissionState, isPlaying, speed, currentMs, totalMs, stepMarkers, recordingMeta,
    togglePlayPause, changeSpeed, seek, stopReplay,
  } = useReplay(recordingId)

  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimerRef = useRef(null)

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), AUTO_HIDE_MS)
  }, [])

  useEffect(() => {
    scheduleHide()
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current) }
  }, [scheduleHide])

  const handleActivity = useCallback(() => {
    setControlsVisible(true)
    scheduleHide()
  }, [scheduleHide])

  useEffect(() => {
    const onMouseMove = (e) => {
      // Hiện lại khi di chuột tới đáy màn hình (trong vùng 120px cuối), hoặc bất kỳ tương tác nào
      const nearBottom = window.innerHeight - e.clientY < 120
      if (nearBottom) handleActivity()
    }
    const onKeyDown = () => handleActivity()
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [handleActivity])

  const handleExit = useCallback(async () => {
    await stopReplay()
    navigate('/recordings')
  }, [stopReplay, navigate])

  // ESC exits presentation mode
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') handleExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleExit])

  const instant = speed === 'instant'
  const speedMultiplier = instant ? 20 : (typeof speed === 'number' ? speed : 1)
  const charsPerSecond = BASE_CPS * speedMultiplier

  const displayName = recordingMeta?.name || replayMissionState?.description || 'Bản ghi'

  return (
    <div
      data-testid="presentation-mode-page"
      className="fixed inset-0 z-[9997] flex flex-col bg-[#07080d] text-[#ffffff] overflow-hidden"
      onMouseMove={handleActivity}
      onClick={handleActivity}
    >
      {/* Ambient background glow — purely decorative, dark theme fixed regardless of app theme */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-purple-600/20 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-[500px] h-[500px] rounded-full bg-cyan-600/20 blur-[120px]" />
      </div>

      {/* Header */}
      <div className="relative z-10 flex items-center justify-center gap-2.5 pt-8 pb-2 shrink-0">
        <div className="w-9 h-9 rounded-full bg-purple-500/15 border border-purple-400/30 flex items-center justify-center">
          <Presentation size={16} className="text-purple-300" />
        </div>
        <div className="text-center">
          <h1 className="text-base font-semibold tracking-wide">{displayName}</h1>
          <p className="text-[11px] text-[#ffffff66] font-mono">Chế độ trình chiếu — Presentation Mode</p>
        </div>
      </div>

      {/* Timeline */}
      <PresentationTimeline
        state={replayMissionState}
        currentMs={currentMs}
        charsPerSecond={charsPerSecond}
        instant={instant}
      />

      {/* Controls overlay — mờ, tự ẩn sau vài giây không tương tác */}
      <div
        className={`relative z-20 flex justify-center px-6 pb-6 pt-2 shrink-0 transition-opacity duration-500 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="w-full max-w-3xl">
          <ReplayControls
            isPlaying={isPlaying}
            speed={speed}
            currentMs={currentMs}
            totalMs={totalMs}
            stepMarkers={stepMarkers}
            onPlayPause={togglePlayPause}
            onSpeedChange={changeSpeed}
            onSeek={seek}
            onExit={handleExit}
            dim
          />
        </div>
      </div>
    </div>
  )
}
