export function SectionHeader({ number, titleVi, titleEn, description }) {
  return (
    <div className="mb-8 pb-5 border-b border-vs-border">
      <div className="flex items-baseline gap-3 mb-1">
        <span className="text-vs-muted font-mono text-sm shrink-0">
          {String(number).padStart(2, '0')}.
        </span>
        <h2 className="text-2xl font-bold text-white leading-tight">{titleVi}</h2>
      </div>
      {titleEn && (
        <p className="text-vs-keyword font-mono text-sm ml-8">{titleEn}</p>
      )}
      {description && (
        <p className="mt-3 text-vs-text text-sm leading-relaxed ml-8 max-w-2xl">
          {description}
        </p>
      )}
    </div>
  )
}
