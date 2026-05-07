import { useRef, useCallback, useState, useEffect } from 'react'
import { TileEditor } from './editor/TileEditor'
import { useOfficeLayout } from './hooks/useOfficeLayout'
import { useAgentSync } from './hooks/useAgentSync'

export function VirtualOffice({ missionState, isRunning, logs }) {
  const webviewRef = useRef(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [webviewReady, setWebviewReady] = useState(false)

  const { layout, isLoading, saveLayout } = useOfficeLayout()

  // Absolute paths resolved by the Electron preload
  const { webviewPreload, pixelAgentsDist } = window.electronAPI.getPaths()

  // Normalize paths to file:// URLs. Unix paths start with '/' (2 slashes after scheme);
  // Windows paths start with a drive letter (3 slashes needed before the letter).
  const distSrc = pixelAgentsDist.startsWith('/')
    ? `file://${pixelAgentsDist}/index.html`
    : `file:///${pixelAgentsDist.replace(/\\/g, '/')}/index.html`
  const preloadSrc = webviewPreload.startsWith('/')
    ? `file://${webviewPreload}`
    : `file:///${webviewPreload.replace(/\\/g, '/')}`

  // Handle messages FROM pixel-agents webview
  const handleInbound = useCallback((e) => {
    if (e.channel !== 'pa:out') return
    const data = e.args?.[0]
    if (!data) return
    if (data.type === 'webviewReady') {
      setWebviewReady(true)
    } else if (data.type === 'saveLayout') {
      window.electronAPI.invoke('pa:save-layout', { layout: data.layout }).catch(console.error)
    } else if (data.type === 'saveAgentSeats') {
      window.electronAPI.invoke('pa:save-seats', { seats: data.seats }).catch(console.error)
    }
  }, [])

  // Reset webviewReady when mission stops so the layoutLoaded flush re-fires on next run
  useEffect(() => {
    if (!isRunning) setWebviewReady(false)
  }, [isRunning])

  // Attach/detach ipc-message listener via ref callback
  const webviewCallback = useCallback((node) => {
    if (node) {
      webviewRef.current = node
      node.addEventListener('ipc-message', handleInbound)
    } else {
      webviewRef.current?.removeEventListener('ipc-message', handleInbound)
      webviewRef.current = null
      setWebviewReady(false)
    }
  }, [handleInbound])

  const handleSaveLayout = useCallback(async (newLayout) => {
    await saveLayout(newLayout)
    setEditorOpen(false)
  }, [saveLayout])

  useAgentSync(missionState, isRunning, logs, webviewRef, webviewReady)

  return (
    <div className="relative flex flex-col h-full bg-slate-950">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800 shrink-0">
        <span className="text-xs text-slate-400 font-medium">Virtual Office</span>
        <button
          onClick={() => setEditorOpen(true)}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Edit Office
        </button>
      </div>

      {/* pixel-agents canvas */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-xs">
            Loading office...
          </div>
        ) : (
          <webview
            ref={webviewCallback}
            src={distSrc}
            preload={preloadSrc}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />
        )}
      </div>

      {/* TileEditor modal */}
      {editorOpen && layout && (
        <TileEditor
          layout={layout}
          isRunning={isRunning}
          onSave={handleSaveLayout}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  )
}
