import { useState, useEffect, useCallback } from 'react'
import { loadLayout, saveLayout } from '../persistence/OfficeLayoutStore'

/**
 * useOfficeLayout — loads and saves the office layout via Electron IPC.
 * Returns { layout, isLoading, saveLayout }
 */
export function useOfficeLayout() {
  const [layout, setLayout] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    loadLayout().then(l => {
      if (!cancelled) {
        setLayout(l)
        setIsLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [])

  const handleSave = useCallback(async (newLayout) => {
    setLayout(newLayout)
    await saveLayout(newLayout)
  }, [])

  return { layout, isLoading, saveLayout: handleSave }
}
