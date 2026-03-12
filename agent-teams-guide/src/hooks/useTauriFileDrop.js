/**
 * Hook to handle Tauri v2 native file drag-and-drop.
 *
 * On Windows, Tauri intercepts OS drag-drop events, so HTML5 onDrop
 * does NOT receive files. This hook uses getCurrentWebview().onDragDropEvent()
 * to get the actual file paths from the OS.
 *
 * Usage:
 *   const { isDragging } = useTauriFileDrop(handleDrop)
 *   // handleDrop receives string[] of file paths
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'

export function useTauriFileDrop(onDrop) {
  const [isDragging, setIsDragging] = useState(false)
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop

  useEffect(() => {
    let unlisten
    getCurrentWebview().onDragDropEvent((event) => {
      const { type } = event.payload
      if (type === 'enter') {
        setIsDragging(true)
      } else if (type === 'leave') {
        setIsDragging(false)
      } else if (type === 'drop') {
        setIsDragging(false)
        const paths = event.payload.paths || []
        if (paths.length > 0 && onDropRef.current) {
          onDropRef.current(paths)
        }
      }
    }).then(fn => { unlisten = fn })

    return () => {
      if (unlisten) unlisten()
    }
  }, [])

  return { isDragging }
}
