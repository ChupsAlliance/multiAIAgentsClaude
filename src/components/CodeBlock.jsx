import { useEffect, useRef, useState } from 'react'
import Prism from 'prismjs'
import { Copy, Check } from 'lucide-react'

export function CodeBlock({ code, language = 'bash', filename, className = '' }) {
  const codeRef = useRef(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (codeRef.current) Prism.highlightElement(codeRef.current)
  }, [code, language])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      const el = document.createElement('textarea')
      el.value = code
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={`rounded-lg overflow-hidden border border-vs-border ${className}`}>
      {/* Window chrome */}
      <div className="flex items-center justify-between px-4 py-2 bg-vs-panel border-b border-vs-border">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
          <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
          <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
          {filename && (
            <span className="ml-2 text-xs text-vs-muted font-mono">{filename}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-vs-muted font-mono uppercase tracking-wide">{language}</span>
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-colors no-drag
              ${copied ? 'text-vs-comment bg-vs-comment/20' : 'text-vs-muted hover:text-vs-text hover:bg-white/10'}`}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      {/* Code */}
      <div className="overflow-x-auto bg-[#1a1a1a]">
        <pre className="p-4 m-0 text-sm leading-relaxed">
          <code ref={codeRef} className={`language-${language}`}>{code.trim()}</code>
        </pre>
      </div>
    </div>
  )
}
