import Icon from './Icon'

// Page numbers with ellipses: 1 … 4 5 6 … 12. Always shows the first, last, current and its neighbours.
export function pageList(page, totalPages) {
  const keep = new Set([1, totalPages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= totalPages))
  const out = []
  let prev = 0
  for (const p of [...keep].sort((a, b) => a - b)) {
    if (p - prev > 1) out.push('…')
    out.push(p)
    prev = p
  }
  return out
}

// Standard previous / numbers / next pager. Hidden when everything fits on one page.
export default function Pagination({ page, totalPages, onChange, label = 'Results pages' }) {
  if (totalPages <= 1) return null
  const btn = 'flex h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <nav aria-label={label} className="flex flex-wrap items-center justify-center gap-1.5">
      <button type="button" className={`${btn} border-slate-200 bg-white text-navy hover:border-brand-500`} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        <Icon name="left" className="h-4 w-4" /> <span className="max-sm:sr-only">Previous</span>
      </button>
      {pageList(page, totalPages).map((p, i) =>
        p === '…' ? (
          <span key={`gap${i}`} className="px-1 text-slate-500" aria-hidden="true">…</span>
        ) : (
          <button
            key={p}
            type="button"
            aria-current={p === page ? 'page' : undefined}
            aria-label={`Page ${p}`}
            onClick={() => onChange(p)}
            className={`${btn} ${p === page ? 'border-brand-500 bg-brand-500 text-white' : 'border-slate-200 bg-white text-navy hover:border-brand-500'}`}
          >
            {p}
          </button>
        ),
      )}
      <button type="button" className={`${btn} border-slate-200 bg-white text-navy hover:border-brand-500`} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        <span className="max-sm:sr-only">Next</span> <Icon name="right" className="h-4 w-4" />
      </button>
    </nav>
  )
}
