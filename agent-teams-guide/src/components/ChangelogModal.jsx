import { useState, useEffect, useCallback } from 'react'
import { X, Sparkles, Bug, RefreshCw, ArrowUp, ChevronDown, ChevronRight, Tag } from 'lucide-react'
import { changelog, APP_VERSION } from '../data/changelog'

const SEEN_KEY = 'changelog_seen_version'

const TYPE_CONFIG = {
  added:    { label: 'New',      color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', icon: Sparkles },
  changed:  { label: 'Changed',  color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',    icon: RefreshCw },
  improved: { label: 'Improved', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',  icon: ArrowUp },
  fixed:    { label: 'Fixed',    color: 'bg-red-500/15 text-red-400 border-red-500/30',       icon: Bug },
}

const BADGE_COLORS = {
  Core:       'bg-blue-500/20 text-blue-300',
  PlanReview: 'bg-violet-500/20 text-violet-300',
  Agent:      'bg-cyan-500/20 text-cyan-300',
  History:    'bg-amber-500/20 text-amber-300',
  Smart:      'bg-emerald-500/20 text-emerald-300',
  Prompt:     'bg-pink-500/20 text-pink-300',
  Dashboard:  'bg-orange-500/20 text-orange-300',
  UI:         'bg-indigo-500/20 text-indigo-300',
  Build:      'bg-gray-500/20 text-gray-300',
  Docs:       'bg-teal-500/20 text-teal-300',
  Playground: 'bg-lime-500/20 text-lime-300',
  Setup:      'bg-sky-500/20 text-sky-300',
}

/**
 * Hook: returns { showChangelog, shouldAutoShow, openChangelog, closeChangelog, markSeen }
 */
export function useChangelog() {
  const [showChangelog, setShowChangelog] = useState(false)
  const [shouldAutoShow, setShouldAutoShow] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem(SEEN_KEY)
    if (seen !== APP_VERSION) {
      setShouldAutoShow(true)
    }
  }, [])

  const openChangelog = useCallback(() => setShowChangelog(true), [])
  const closeChangelog = useCallback(() => {
    setShowChangelog(false)
    localStorage.setItem(SEEN_KEY, APP_VERSION)
    setShouldAutoShow(false)
  }, [])
  const markSeen = useCallback(() => {
    localStorage.setItem(SEEN_KEY, APP_VERSION)
    setShouldAutoShow(false)
  }, [])

  return { showChangelog, shouldAutoShow, openChangelog, closeChangelog, markSeen }
}

/**
 * Changelog modal component — "What's New" popup
 */
export function ChangelogModal({ open, onClose }) {
  const [expandedVersions, setExpandedVersions] = useState(() => {
    // Auto-expand current version, collapse others
    return { [APP_VERSION]: true }
  })

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const toggleVersion = (v) => {
    setExpandedVersions(prev => ({ ...prev, [v]: !prev[v] }))
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[85vh] mx-4 bg-vs-sidebar border border-vs-border rounded-xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-vs-border bg-gradient-to-r from-vs-accent/10 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-vs-accent/20 border border-vs-accent/40 flex items-center justify-center">
              <Sparkles size={18} className="text-vs-accent" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">What's New</h2>
              <p className="text-[10px] text-vs-muted font-mono">
                Agent Teams Guide v{APP_VERSION}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-vs-muted hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {changelog.map((release) => {
            const isExpanded = expandedVersions[release.version]
            const isCurrent = release.version === APP_VERSION
            const itemsByType = {}
            for (const item of release.items) {
              if (!itemsByType[item.type]) itemsByType[item.type] = []
              itemsByType[item.type].push(item)
            }

            return (
              <div key={release.version} className={`rounded-lg border overflow-hidden ${
                isCurrent ? 'border-vs-accent/40 bg-vs-accent/5' : 'border-vs-border/50 bg-vs-panel/30'
              }`}>
                {/* Version header — clickable */}
                <button
                  onClick={() => toggleVersion(release.version)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
                >
                  {isExpanded
                    ? <ChevronDown size={14} className="text-vs-muted shrink-0" />
                    : <ChevronRight size={14} className="text-vs-muted shrink-0" />
                  }
                  <Tag size={14} className={isCurrent ? 'text-vs-accent shrink-0' : 'text-vs-muted shrink-0'} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-bold text-white font-mono">v{release.version}</span>
                    {isCurrent && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-mono bg-vs-accent/20 text-vs-accent border border-vs-accent/30">
                        current
                      </span>
                    )}
                    <span className="ml-2 text-[11px] text-vs-muted">{release.title}</span>
                  </div>
                  <span className="text-[10px] text-vs-muted font-mono shrink-0">{release.date}</span>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3">
                    {/* Highlights */}
                    {release.highlights && release.highlights.length > 0 && (
                      <div className="bg-vs-bg/50 rounded-md px-3 py-2 border border-vs-border/30">
                        <p className="text-[9px] uppercase tracking-wider text-vs-muted font-mono mb-1.5">Highlights</p>
                        <ul className="space-y-1">
                          {release.highlights.map((h, i) => (
                            <li key={i} className="text-[11px] text-vs-text flex items-start gap-2">
                              <span className="text-vs-accent mt-0.5 shrink-0">&bull;</span>
                              {h}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Items grouped by type */}
                    {Object.entries(itemsByType).map(([type, items]) => {
                      const config = TYPE_CONFIG[type] || TYPE_CONFIG.added
                      const Icon = config.icon
                      return (
                        <div key={type}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono font-semibold border ${config.color}`}>
                              <Icon size={9} />
                              {config.label}
                            </span>
                            <span className="text-[9px] text-vs-muted font-mono">{items.length} items</span>
                          </div>
                          <ul className="space-y-0.5 ml-1">
                            {items.map((item, i) => (
                              <li key={i} className="flex items-start gap-2 text-[11px] text-vs-text/90 leading-relaxed">
                                <span className="text-vs-muted mt-1 shrink-0 text-[8px]">&bull;</span>
                                <span className="flex-1">
                                  {item.badge && (
                                    <span className={`inline-block mr-1.5 px-1.5 py-0 rounded text-[8px] font-mono ${BADGE_COLORS[item.badge] || 'bg-vs-border text-vs-muted'}`}>
                                      {item.badge}
                                    </span>
                                  )}
                                  {item.text}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-vs-border flex items-center justify-between bg-vs-panel/30">
          <p className="text-[10px] text-vs-muted font-mono">
            {changelog.length} versions &middot; CHANGELOG.md
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-[11px] font-mono font-semibold
                       bg-vs-accent/20 text-vs-accent border border-vs-accent/30
                       hover:bg-vs-accent/30 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
