import { useEffect, useId, useRef, useState } from 'react'
import api from '../api/client'
import Icon from './ui/Icon'

const KIND = { area: 'Neighbourhood', town: 'Town', postcode: 'Postcode' }

// "Where are you?" picker for anywhere in Malaysia. Click it and the popular places appear; type a town, a
// neighbourhood or a postcode (or part of one) and the list narrows. Picking is what saves a place: text that is only
// typed is never taken as a place, because then the server could not measure how far tutors are. Someone whose place
// really is not in the data can still use what they typed, and is told what that means.
//
// `value` and `onChange` use the place's label ("Shah Alam, Selangor", "52100 Kuala Lumpur"), which is what is saved.
export default function PlaceSearch({
  label = 'Home area', value, onChange, error, hint, placeholder = 'Search your town or postcode', optional = false, labelClass, id: givenId, quiet = false, disabled = false,
}) {
  const auto = useId()
  const id = givenId || auto
  const listId = `${id}-list`
  const [text, setText] = useState(value || '')
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState([])
  const [popular, setPopular] = useState(true)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(-1)
  const [known, setKnown] = useState(true) // is the saved value a place we can find on the map?
  const asked = useRef(0) // answers that arrive late are ignored
  const picked = useRef(value || '') // what the box shows when it is not being typed in
  const trusted = useRef(null) // the place the person picked from the list: known to be on the map
  const timer = useRef(null)

  const search = (q) => {
    const mine = ++asked.current
    setLoading(true)
    setFailed(false)
    api.get('/public/places', { params: { q: q || undefined, limit: 8 } })
      .then((r) => { if (mine === asked.current) { setResults(r.data.results); setPopular(r.data.popular); setActive(-1) } })
      .catch(() => { if (mine === asked.current) setFailed(true) })
      .finally(() => { if (mine === asked.current) setLoading(false) })
  }

  // A value that came from outside (the saved profile, a form reset) is shown as it is. If it is not one of the places we
  // can find on the map (an older free-typed area), say so under the box.
  useEffect(() => {
    picked.current = value || ''
    setText(value || '')
    if (!value || value === trusted.current) { setKnown(true); return }
    let cancelled = false
    api.get('/public/places', { params: { q: value, limit: 5 } })
      .then((r) => { if (!cancelled) setKnown(r.data.results.some((p) => p.label === value)) })
      .catch(() => { if (!cancelled) setKnown(true) })
    return () => { cancelled = true }
  }, [value])

  useEffect(() => () => clearTimeout(timer.current), [])

  const choose = (place) => {
    picked.current = place
    trusted.current = place
    setText(place)
    setKnown(true)
    setOpen(false)
    setActive(-1)
    onChange(place)
  }
  const useTyped = () => {
    const typed = text.trim()
    picked.current = typed
    trusted.current = null
    setKnown(false)
    setOpen(false)
    onChange(typed)
  }
  const clear = () => {
    picked.current = ''
    trusted.current = null
    setText('')
    setKnown(true)
    onChange('')
    setOpen(true)
    search('')
  }

  const onInput = (e) => {
    const t = e.target.value
    setText(t)
    setOpen(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => search(t.trim()), 180) // wait for a pause in typing
  }
  const onFocus = () => {
    setOpen(true)
    if (!results.length) search(text === value ? '' : text.trim())
  }

  // The last row is "my place is not listed", shown once something has been typed
  const typed = text.trim()
  const offerCustom = typed.length >= 2 && !results.some((r) => r.label.toLowerCase() === typed.toLowerCase()) && !popular
  const rows = [...results.map((r) => ({ ...r, key: r.label })), ...(offerCustom ? [{ key: '__custom', custom: true }] : [])]

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); setText(value || ''); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(rows.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' && open) {
      e.preventDefault() // never submit the form while a list is open
      const row = rows[active]
      if (row) row.custom ? useTyped() : choose(row.label)
    }
  }

  const activeId = active >= 0 ? `${id}-opt-${active}` : undefined

  return (
    <div>
      <label htmlFor={id} className={labelClass || 'mb-1.5 block text-sm font-bold text-navy'}>{label}{optional && <span className="font-normal text-slate-600"> (optional)</span>}</label>
      <div className="relative">
        <Icon name="pin" className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-brand-500" />
        <input
          id={id} data-field="address" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeId}
          autoComplete="off" spellCheck={false} maxLength={100} disabled={disabled}
          className="input h-11 pl-10 pr-10" placeholder={placeholder} value={text}
          onChange={onInput} onFocus={onFocus} onKeyDown={onKeyDown}
          onBlur={() => { setOpen(false); setText(picked.current) }} // text that was not picked is not a place: show the saved one again
          aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : `${id}-hint`}
        />
        {value && !disabled ? (
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={clear} aria-label={`Clear ${label.toLowerCase()}`}
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
            <Icon name="x" className="h-4 w-4" />
          </button>
        ) : <Icon name="search" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />}

        {open && (
          <ul id={listId} role="listbox" aria-label={popular ? 'Popular places' : 'Places that match'}
            className="pop-in absolute left-0 right-0 top-12 z-30 max-h-72 overflow-y-auto rounded-xl border border-brand-100 bg-white py-1 shadow-xl">
            {popular && !failed && <li role="presentation" className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-slate-600">Popular places</li>}
            {failed && <li role="presentation" className="px-3 py-3 text-sm text-red-700">The places could not be loaded. Check your connection and try again.</li>}
            {!failed && !loading && results.length === 0 && typed && <li role="presentation" className="px-3 py-3 text-sm text-slate-600">No place matches “{typed}”. Try a nearby town or your postcode.</li>}
            {rows.map((r, i) => (
              <li
                key={r.key} id={`${id}-opt-${i}`} role="option" aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()} onClick={() => (r.custom ? useTyped() : choose(r.label))} onMouseEnter={() => setActive(i)}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3 text-sm ${i === active ? 'bg-brand-50' : ''} ${r.custom ? 'border-t border-slate-100 font-semibold text-brand-700' : 'text-navy'}`}
              >
                {r.custom
                  ? <span>My place is not listed: use “{typed}”</span>
                  : <><span className="min-w-0 truncate font-medium">{r.label}</span><span className="shrink-0 text-xs text-slate-600">{KIND[r.kind]}</span></>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p id={`${id}-error`} className="mt-1 flex items-center gap-1.5 text-sm font-medium text-red-700"><Icon name="info" className="h-4 w-4 shrink-0" /> {error}</p>
      ) : quiet && (known || !value) ? null : (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-600">
          {value && !known
            ? <span className="text-amber-800">We cannot place “{value}” on the map, so tutors will not be ranked by how close they are. Pick a town or postcode from the list for that.</span>
            : hint || 'Type a town or your postcode. We use it to show how far tutors are from you, and we do not keep your street address.'}
        </p>
      )}
      <span className="sr-only" role="status" aria-live="polite">{open && !loading && !failed ? `${results.length} place${results.length === 1 ? '' : 's'} found` : ''}</span>
    </div>
  )
}
