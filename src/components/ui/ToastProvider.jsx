import { createContext, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, AlertTriangle, CheckCircle, Info, X } from 'lucide-react'

export const ToastContext = createContext(null)

const ICONS = {
  error:   { Icon: AlertCircle,   cls: 'border-red-500/40 bg-red-950/80 text-red-200',       icon: 'text-red-400' },
  warn:    { Icon: AlertTriangle,  cls: 'border-yellow-500/40 bg-yellow-950/80 text-yellow-200', icon: 'text-yellow-400' },
  success: { Icon: CheckCircle,   cls: 'border-green-500/40 bg-green-950/80 text-green-200',  icon: 'text-green-400' },
  info:    { Icon: Info,           cls: 'border-blue-500/40 bg-blue-950/80 text-blue-200',    icon: 'text-blue-400' },
}

function Toast({ toast, onDismiss }) {
  const { Icon, cls, icon } = ICONS[toast.type]
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 shadow-lg font-mono text-[11px] ${cls}`}
    >
      <Icon size={13} className={`${icon} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className="font-semibold leading-tight">{toast.title}</div>
        {toast.message && (
          <div className="opacity-70 mt-0.5 leading-snug break-words">{toast.message}</div>
        )}
        {toast.action && (
          <button
            onClick={() => { toast.action.onClick(); onDismiss(toast.id) }}
            className="mt-1.5 text-[10px] underline underline-offset-2 opacity-80 hover:opacity-100"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        aria-label="Đóng thông báo"
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
      >
        <X size={12} />
      </button>
    </div>
  )
}

function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 w-80 pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((toast) => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6)
    setToasts(prev => [{ ...toast, id }, ...prev].slice(0, 5))
    setTimeout(() => removeToast(id), toast.duration)
  }, [removeToast])

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      {createPortal(
        <ToastStack toasts={toasts} onDismiss={removeToast} />,
        document.body
      )}
    </ToastContext.Provider>
  )
}
