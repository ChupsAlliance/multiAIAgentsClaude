import { SHORTCUT_GROUPS } from '../../hooks/useAppHotkeys'

export function ShortcutsHelpModal({ isOpen, onClose }) {
  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-vs-surface border border-vs-border rounded-lg shadow-xl w-full max-w-lg mx-4 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-vs-border">
          <h2 className="text-sm font-semibold text-vs-text font-mono">Phím tắt</h2>
          <button
            onClick={onClose}
            className="text-vs-muted hover:text-vs-text transition-colors text-xs font-mono"
          >
            Esc
          </button>
        </div>

        {/* Groups */}
        <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map(({ group, shortcuts }) => (
            <div key={group}>
              <h3 className="text-[10px] font-semibold text-vs-muted uppercase tracking-wider mb-2 font-mono">
                {group}
              </h3>
              <div className="space-y-1">
                {shortcuts.map(({ keys, description }) => (
                  <div key={keys} className="flex items-center justify-between py-1">
                    <span className="text-sm text-vs-text font-mono">{description}</span>
                    <kbd className="px-2 py-0.5 bg-vs-bg border border-vs-border rounded text-xs font-mono text-vs-muted">
                      {keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
