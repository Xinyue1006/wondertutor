import Icon from './ui/Icon'
import { FilterDropdown } from './ui/Common'
import { CHARACTERISTICS } from '../lib/education'
import { DAY_SHORT } from '../lib/format'

export const NO_EXTRA = { minPrice: '', maxPrice: '', minRating: '', days: [], maxDistance: '', mode: '', characteristics: [] }

export const countActive = (x) =>
  [x.minPrice !== '' || x.maxPrice !== '', x.minRating, x.days.length, x.maxDistance, x.mode, x.characteristics.length].filter(Boolean).length

// The "Filters / Price / Rating / Availability / Location / Teaching Mode / Tutor Characteristics" chips,
// shared by Find a Tutor (filters sent to the API) and the match results (filters applied in the browser)
export default function FilterChips({ extra, setExtra, locationName }) {
  const active = countActive(extra)
  const toggle = (key, value) =>
    setExtra({ ...extra, [key]: extra[key].includes(value) ? extra[key].filter((x) => x !== value) : [...extra[key], value] })

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        onClick={() => setExtra(NO_EXTRA)}
        title="Clear all filters"
        className={`flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold ${active ? 'border-brand-500 text-brand-500' : 'border-slate-200 text-navy'}`}
      >
        <Icon name="filter" className="h-4 w-4 text-brand-500" /> Filters
        {active > 0 && <span className="rounded-full bg-brand-500 px-1.5 text-xs text-white">{active}</span>}
      </button>

      <FilterDropdown label="Price" active={extra.minPrice !== '' || extra.maxPrice !== ''}>
        <div className="space-y-3">
          <div className="text-sm font-bold text-navy">Hourly rate (RM)</div>
          <div className="flex items-center gap-2">
            <input type="number" min="0" placeholder="Min" className="input h-10" value={extra.minPrice} onChange={(e) => setExtra({ ...extra, minPrice: e.target.value })} />
            <span className="text-slate-400">–</span>
            <input type="number" min="0" placeholder="Max" className="input h-10" value={extra.maxPrice} onChange={(e) => setExtra({ ...extra, maxPrice: e.target.value })} />
          </div>
          <div className="flex flex-wrap gap-2">
            {[['Under 50', '', 49], ['50 – 70', 50, 70], ['Above 70', 71, '']].map(([l, a, b]) => (
              <button key={l} className="chip px-3 py-1 text-xs" onClick={() => setExtra({ ...extra, minPrice: a, maxPrice: b })}>{l}</button>
            ))}
          </div>
        </div>
      </FilterDropdown>

      <FilterDropdown label="Rating" active={!!extra.minRating} width="w-52">
        {(close) => [['', 'Any rating'], [4, '4.0 & up'], [4.5, '4.5 & up'], [4.8, '4.8 & up']].map(([v, l]) => (
          <button key={l} onClick={() => { setExtra({ ...extra, minRating: v }); close() }}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50 ${extra.minRating === v ? 'font-bold text-brand-500' : 'text-navy'}`}>
            {v !== '' && <Icon name="star" fill className="h-4 w-4 text-accent" />} {l}
          </button>
        ))}
      </FilterDropdown>

      <FilterDropdown label="Availability" active={extra.days.length > 0} width="w-64">
        <div className="mb-2 text-sm font-bold text-navy">Available on</div>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <button key={d} className={`chip px-3 py-1 text-xs ${extra.days.includes(d) ? 'chip-on' : ''}`} onClick={() => toggle('days', d)}>{DAY_SHORT[d]}</button>
          ))}
        </div>
      </FilterDropdown>

      <FilterDropdown label="Location" active={!!extra.maxDistance} width="w-60">
        {(close) => (
          <>
            <div className="mb-1 px-3 text-xs text-slate-500">Distance from {locationName || 'your area'}</div>
            {[['', 'Any distance'], [5, 'Within 5 km'], [10, 'Within 10 km'], [20, 'Within 20 km']].map(([v, l]) => (
              <button key={l} disabled={!locationName && v !== ''} onClick={() => { setExtra({ ...extra, maxDistance: v }); close() }}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50 disabled:opacity-40 ${extra.maxDistance === v ? 'font-bold text-brand-500' : 'text-navy'}`}>{l}</button>
            ))}
            {!locationName && <div className="px-3 pt-1 text-xs text-slate-500">Choose a location first.</div>}
          </>
        )}
      </FilterDropdown>

      <FilterDropdown label="Teaching Mode" active={!!extra.mode} width="w-52">
        {(close) => [['', 'Online or Physical'], ['ONLINE', 'Online'], ['PHYSICAL', 'Physical']].map(([v, l]) => (
          <button key={l} onClick={() => { setExtra({ ...extra, mode: v }); close() }}
            className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-brand-50 ${extra.mode === v ? 'font-bold text-brand-500' : 'text-navy'}`}>{l}</button>
        ))}
      </FilterDropdown>

      <FilterDropdown label="Tutor Characteristics" active={extra.characteristics.length > 0} width="w-64">
        {CHARACTERISTICS.map((c) => (
          <label key={c} className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-navy hover:bg-brand-50">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={extra.characteristics.includes(c)} onChange={() => toggle('characteristics', c)} />
            {c}
          </label>
        ))}
      </FilterDropdown>
    </div>
  )
}

// Same rules the API applies, for the already-loaded match results
export function applyExtra(tutors, x) {
  return tutors.filter((t) => {
    if (x.minPrice !== '' && t.hourlyRate < Number(x.minPrice)) return false
    if (x.maxPrice !== '' && t.hourlyRate > Number(x.maxPrice)) return false
    if (x.minRating && t.rating < Number(x.minRating)) return false
    if (x.mode === 'ONLINE' && !t.offersOnline) return false
    if (x.mode === 'PHYSICAL' && !t.offersPhysical) return false
    if (x.days.length && !x.days.some((d) => t.availableDays.includes(DAY_SHORT[d]))) return false
    if (x.characteristics.length && !x.characteristics.some((c) => t.characteristics.includes(c))) return false
    if (x.maxDistance && t.offersPhysical && !t.offersOnline && t.match?.distanceKm != null && t.match.distanceKm > Number(x.maxDistance)) return false
    return true
  })
}
