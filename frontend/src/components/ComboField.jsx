import { useId, useState } from 'react'
import Icon from './ui/Icon'

// A field you can type in AND pick from: suggestions narrow down as you type, and the chevron opens the full list.
// Built by hand instead of using <datalist> so there is exactly one arrow and it looks the same in every browser.
// Keyboard: ArrowDown/ArrowUp move through the list, Enter picks, Escape closes.
export default function ComboField({ icon, label, value, onChange, options, placeholder, required = false, error }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const typed = value.trim().toLowerCase()
  // When the box already holds an exact option, show the whole list so the parent can switch easily
  const shown = !typed || options.some((o) => o.toLowerCase() === typed) ? options : options.filter((o) => o.toLowerCase().includes(typed))
  const listOpen = open && shown.length > 0

  const pick = (o) => { onChange(o); setOpen(false); setActive(-1) }

  function onKeyDown(e) {
    if (e.key === 'Escape') return setOpen(false)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((i) => Math.min(shown.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && listOpen && active >= 0) {
      e.preventDefault() // choose the highlighted option instead of submitting the form
      pick(shown[active])
    }
  }

  return (
    <div className="relative flex min-h-14 min-w-0 flex-1 items-center gap-2 border-slate-100 px-2 md:border-l md:first:border-l-0">
      <Icon name={icon} className="h-5 w-5 shrink-0 text-brand-500" />
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block whitespace-nowrap text-xs font-bold text-navy">
          {label}{required && <span className="text-red-700" aria-hidden="true"> *</span>}
        </label>
        <input
          id={id}
          className="w-full bg-transparent py-0.5 text-sm text-slate-700 outline-none placeholder:text-slate-500"
          placeholder={placeholder}
          value={value}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-required={required}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onBlur={() => { setOpen(false); setActive(-1) }}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1) }}
          onKeyDown={onKeyDown}
        />
      </div>
      {/* onMouseDown keeps the input focused so the list does not close before the click lands */}
      <button type="button" tabIndex={-1} aria-label={`Show ${label} options`} onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o) }} className="flex h-11 w-8 shrink-0 items-center justify-center text-navy">
        <Icon name="down" className="h-4 w-4" />
      </button>
      {error && <span className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-red-600" aria-hidden="true" />}
      {listOpen && (
        <ul id={`${id}-list`} role="listbox" aria-label={`${label} options`} className="absolute left-0 top-full z-30 mt-2 max-h-52 w-full min-w-[12rem] overflow-auto rounded-xl border border-brand-100 bg-white py-1 text-sm shadow-card">
          {shown.map((o, i) => (
            <li key={o} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(o) }} className={`min-h-10 cursor-pointer px-3 py-2.5 text-slate-700 hover:bg-brand-50 ${i === active ? 'bg-brand-50' : ''}`}>
              {o}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
