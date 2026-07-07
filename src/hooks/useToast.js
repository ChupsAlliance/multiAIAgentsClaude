import { useContext, useMemo } from 'react'
import { ToastContext } from '../components/ui/ToastProvider'

const DURATIONS = { error: 6000, warn: 5000, success: 3000, info: 4000 }

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')

  const toast = useMemo(() => {
    const make = (type) => (title, message, action) =>
      ctx.addToast({ type, title, message, duration: DURATIONS[type], action })
    return {
      error:   make('error'),
      warn:    make('warn'),
      success: make('success'),
      info:    make('info'),
    }
  }, [ctx.addToast])

  return { toast }
}
