import { useEffect, useRef } from 'react'

/**
 * useAnimationTick — StrictMode-safe requestAnimationFrame hook.
 *
 * Calls `callback(dt)` every frame where dt is time-delta in seconds.
 * Uses a ref for the callback so it never needs to restart the RAF loop
 * when the callback changes (avoids StrictMode double-cancel issues).
 *
 * @param {function(dt: number): void} callback
 */
export function useAnimationTick(callback) {
  const savedCallback = useRef(callback)

  useEffect(() => {
    savedCallback.current = callback
  })

  useEffect(() => {
    let rafId
    let lastTime = 0

    function tick(time) {
      const dt = lastTime === 0 ? 0 : Math.min((time - lastTime) / 1000, 0.1)
      lastTime = time
      savedCallback.current(dt)
      rafId = requestAnimationFrame(tick)
    }

    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, []) // stable — never restarts
}
