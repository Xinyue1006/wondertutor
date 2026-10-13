import { useState } from 'react'
import Icon from './ui/Icon'

// A field you can type in AND pick from: suggestions narrow down as you type, and the chevron opens the full list.
// Built by hand instead of using <datalist> so there is exactly one arrow and it looks the same in every browser.
export default function ComboField({ icon, label, value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false)
  const typed = value.trim().toLowerCase()
  // When the box already holds an exact option, show the whole list so the parent can switch easily
  const shown = !typed || options.some((o) => o.toLowerCase() === typed) ? options : options.filter((o) => o.toLowerCase().includes(typed))

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2 border-slate-100 px-2 sm:border-l sm:first:border-l-0">
      <Icon name={icon} className="h-5 w-5 shrink-0 text-brand-500" />
      <div className="min-w-0 flex-1">
        <span className="block whitespace-nowrap text-xs font-bold text-navy">{label}</span>
        <input
          className="mt-0.5 w-full bg-transparent text-sm text-slate-600 outline-none placeholder:text-slate-400"
          placeholder={placeholder}
          value={value}
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        />
      </div>
      {/* onMouseDown keeps the input focused so the list does not close before the click lands */}
      <button type="button" tabIndex={-1} aria-label={`Show ${label} options`} onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o) }} className="shrink-0 text-navy">
        <Icon name="down" className="h-4 w-4" />
      </button>
      {open && shown.length > 0 && (
        <ul role="listbox" className="absolute left-0 top-full z-30 mt-2 max-h-52 w-full min-w-[12rem] overflow-auto rounded-xl border border-brand-100 bg-white py-1 text-sm shadow-card">
          {shown.map((o) => (
            <li key={o}>
              <button
                type="button"
                role="option"
                aria-selected={o === value}
                onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false) }}
                className="block w-full px-3 py-1.5 text-left text-slate-700 hover:bg-brand-50"
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
