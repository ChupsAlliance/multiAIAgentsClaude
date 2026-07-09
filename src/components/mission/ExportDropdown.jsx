// src/components/mission/ExportDropdown.jsx
import { useState, useRef, useEffect } from 'react'
import { Download, ChevronDown, Loader2 } from 'lucide-react'
import { downloadJSON, downloadHTML, generateHTML, generateFilename } from '../../utils/exportPlan'
import { planToMarkdown } from '../../utils/planMarkdown'

/**
 * ExportDropdown — a toolbar button that reveals 4 export options:
 *   Markdown (.md)  → IPC export_plan_markdown
 *   JSON (.json)    → client-side download
 *   HTML (.html)    → client-side download
 *   PDF (.pdf)      → IPC export_plan_pdf (Electron printToPDF)
 *
 * Props:
 *   missionState  — full mission state object (id, description, agents, tasks, …)
 *   projectPath   — string path to the project directory
 *   onToast       — (type: 'success'|'error', msg: string) => void
 *   externalOpen  — boolean; when toggled, opens/closes the dropdown (e.g. from ctrl+e)
 */
export function ExportDropdown({ missionState, projectPath, onToast, externalOpen }) {
  const [open, setOpen] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const ref = useRef(null)

  // Respond to external open toggle (e.g. ctrl+e hotkey)
  const prevExternalOpen = useRef(externalOpen)
  useEffect(() => {
    if (externalOpen !== prevExternalOpen.current) {
      prevExternalOpen.current = externalOpen
      setOpen(prev => !prev)
    }
  }, [externalOpen])

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Close on Escape
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleMarkdown = async () => {
    setOpen(false)
    try {
      const { agents = [], tasks = [], project_path, requirement, mission_context } = missionState || {}
      const markdown = planToMarkdown(agents, tasks, {
        projectPath: project_path || projectPath,
        requirement,
        mission_context,
      })
      await window.electron.ipcRenderer.invoke('export_plan_markdown', {
        markdown,
        projectPath: project_path || projectPath,
      })
      onToast?.('success', `Đã xuất ${generateFilename(missionState?.description, 'md')}`)
    } catch (err) {
      onToast?.('error', `Xuất thất bại: ${err.message}`)
    }
  }

  const handleJSON = () => {
    setOpen(false)
    try {
      downloadJSON(missionState)
      onToast?.('success', `Đã xuất ${generateFilename(missionState?.description, 'json')}`)
    } catch (err) {
      onToast?.('error', `Xuất thất bại: ${err.message}`)
    }
  }

  const handleHTML = () => {
    setOpen(false)
    try {
      downloadHTML(missionState)
      onToast?.('success', `Đã xuất ${generateFilename(missionState?.description, 'html')}`)
    } catch (err) {
      onToast?.('error', `Xuất thất bại: ${err.message}`)
    }
  }

  const handlePDF = async () => {
    setOpen(false)
    setPdfLoading(true)
    try {
      const htmlContent = generateHTML(missionState)
      const result = await window.electron.ipcRenderer.invoke('export_plan_pdf', {
        htmlContent,
        description: missionState?.description,
      })
      if (result?.success) {
        onToast?.('success', `Đã xuất PDF`)
      } else if (result?.error !== 'cancelled') {
        onToast?.('error', `Xuất PDF thất bại: ${result?.error || 'unknown'}`)
      }
    } catch (err) {
      onToast?.('error', `Xuất PDF thất bại: ${err.message}`)
    } finally {
      setPdfLoading(false)
    }
  }

  const items = [
    { label: 'Markdown (.md)', onClick: handleMarkdown },
    { label: 'JSON (.json)', onClick: handleJSON },
    { label: 'HTML (.html)', onClick: handleHTML },
    { label: 'PDF (.pdf)', onClick: handlePDF, loading: pdfLoading },
  ]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(prev => !prev)}
        disabled={pdfLoading}
        className="flex items-center gap-1 px-2 py-1 text-xs font-mono border border-vs-border text-vs-muted rounded hover:text-vs-text hover:border-vs-text/30 transition-colors disabled:opacity-50"
        title="Xuất ra file (Ctrl+E)"
      >
        {pdfLoading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
        Xuất
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-vs-surface border border-vs-border rounded-md shadow-lg z-20 overflow-hidden">
          {items.map(({ label, onClick, loading }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={loading}
              className="w-full text-left px-3 py-2 text-xs font-mono text-vs-text hover:bg-vs-accent/10 hover:text-vs-accent transition-colors disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
