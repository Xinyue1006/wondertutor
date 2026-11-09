import { useCallback, useEffect, useRef, useState } from 'react'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import { ErrorBox, LoadError, Spinner } from '../../components/ui/Common'
import { DAYS, DAY_END, HOURS, PRESETS, addHours, cellKey, cellsOnLine, cellsToRanges, clearHours, hourEnd, rangesToCells, sameCells } from '../../lib/availability'

const LOCKED_TIP = 'Booked lesson on this day. Cancel or reschedule it first.'
const UNSAVED = 'You have unsaved changes to your availability. Leave without saving?'
const HOLD_MS = 300 // on touch, how long a press lasts before a drag paints instead of scrolling

// Booked hours always count as on, so saving can never drop one
function fromServer(data) {
  const locked = new Set(data.locked.map((l) => cellKey(l.dayOfWeek, l.startTime)))
  return { locked, cells: new Set([...rangesToCells(data.slots), ...locked]) }
}

// Asks before leaving with unsaved work: closing or reloading the tab, and links clicked inside the app
function useUnsavedWarning(dirty) {
  useEffect(() => {
    if (!dirty) return
    const beforeUnload = (e) => e.preventDefault()
    const onLinkClick = (e) => {
      const link = e.target.closest?.('a[href]')
      if (!link || link.target === '_blank' || link.origin !== window.location.origin) return
      if (!window.confirm(UNSAVED)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', onLinkClick, true) // capture: runs before the router handles the link
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', onLinkClick, true)
    }
  }, [dirty])
}

export default function Availability() {
  const [saved, setSaved] = useState(null) // the schedule as last loaded or saved
  const [cells, setCells] = useState(new Set())
  const [locked, setLocked] = useState(new Set())
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const drag = useRef(null)
  const gridBox = useRef(null)

  const apply = useCallback((data) => {
    const next = fromServer(data)
    setLocked(next.locked)
    setCells(next.cells)
    setSaved(next.cells)
  }, [])

  const load = useCallback(async () => {
    setLoadError('')
    try {
      apply((await api.get('/tutor/availability')).data)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [apply])
  useEffect(() => { load() }, [load])

  const dirty = saved !== null && !sameCells(cells, saved)
  useUnsavedWarning(dirty)

  // Once a held finger is painting, stop the browser scrolling. Must be a non-passive native listener to be allowed to.
  const ready = saved !== null
  useEffect(() => {
    const box = gridBox.current
    if (!box) return
    const stopScroll = (e) => { if (drag.current?.painted) e.preventDefault() }
    box.addEventListener('touchmove', stopScroll, { passive: false })
    return () => box.removeEventListener('touchmove', stopScroll)
  }, [ready])

  // Every edit goes through here, so a stale "saved" or error message never stays next to changed hours
  const edit = useCallback((change) => {
    setNotice('')
    setSaveError('')
    setCells(change)
  }, [])

  const paint = useCallback((key, on) => {
    if (locked.has(key)) return
    edit((prev) => {
      if (prev.has(key) === on) return prev
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [edit, locked])

  // Drag ends wherever the pointer is released, even outside the grid
  useEffect(() => {
    const finish = (e) => {
      const d = drag.current
      drag.current = null
      clearTimeout(d?.timer)
      if (d && !d.painted && e.type === 'pointerup') paint(d.key, d.on) // a tap
    }
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }
  }, [paint])

  // The pressed cell decides paint-on or paint-off for the whole drag. A mouse paints at once. On touch a quick tap
  // toggles when the finger lifts, a swipe is left to the browser to scroll (it sends pointercancel, so nothing
  // changes), and only a press held for HOLD_MS starts painting.
  function startDrag(e, key) {
    if (e.button) return
    const on = !cells.has(key)
    const d = { key, last: key, on, painted: false }
    drag.current = d
    if (e.pointerType !== 'touch') {
      d.painted = true
      paint(key, on)
      return
    }
    d.timer = setTimeout(() => {
      if (drag.current !== d) return
      d.painted = true
      paint(key, on)
    }, HOLD_MS)
  }

  function moveDrag(e) {
    const d = drag.current
    if (!d?.painted) return
    // A touch stays attached to the cell it began on, so the cell under the finger has to be looked up
    const key = document.elementFromPoint?.(e.clientX, e.clientY)?.closest?.('[data-cell]')?.dataset.cell
    if (!key) return
    for (const k of cellsOnLine(d.last, key)) paint(k, d.on)
    d.last = key
  }

  async function save() {
    setBusy(true)
    setSaveError('')
    setNotice('')
    try {
      apply((await api.put('/tutor/availability', { slots: cellsToRanges(cells) })).data)
      setNotice('Your availability has been saved.')
    } catch (err) {
      setSaveError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <LoadError message={loadError} onRetry={load} />
  if (saved === null) return <Spinner />

  const total = cells.size

  return (
    <div className="mx-auto max-w-[76rem] py-2">
      <div className="mb-5">
        <h1 className="font-display text-3xl font-bold text-navy">My availability</h1>
        <p className="mt-1 text-slate-600">Your weekly hours, repeated every week. Parents can only book the hours you switch on.</p>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="card min-w-0 p-4 md:p-5" aria-label="Weekly hours">
          <p className="mb-3 font-display text-lg font-bold text-navy">{total} {total === 1 ? 'hour' : 'hours'} a week</p>

          <Legend />

          {/* The grid scrolls inside this box on small screens, so the page itself never scrolls sideways */}
          <div ref={gridBox} className="overflow-x-auto rounded-lg border border-brand-100" onPointerMove={moveDrag} onContextMenu={(e) => { if (drag.current) e.preventDefault() }}>
            <div role="group" aria-label="Availability by day and hour" className="grid w-max min-w-full select-none grid-cols-[5.75rem_repeat(7,minmax(4.75rem,1fr))]">
              <div className="sticky left-0 z-10 border-b border-r border-brand-100 bg-brand-25" />
              {DAYS.map((day) => (
                <div key={day.value} className="border-b border-brand-100 bg-brand-25 px-1 py-1.5 text-center">
                  <div className="text-sm font-bold text-navy">{day.short}</div>
                  <button type="button" onClick={() => edit((prev) => clearHours(prev, locked, day.value))} aria-label={`Clear ${day.label}`} className="min-h-11 px-1 text-xs font-semibold text-brand-600 hover:underline">Clear this day</button>
                </div>
              ))}

              {HOURS.map((hour) => (
                <Row key={hour} hour={hour} cells={cells} locked={locked} onPress={startDrag} onKeyToggle={(key) => paint(key, !cells.has(key))} />
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-600">Click or tap an hour to switch it on or off. To set several, drag with a mouse, or press and hold on a phone and then drag. Nothing changes for parents until you press Save availability.</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => edit((prev) => clearHours(prev, locked))} className="btn-outline min-h-11 px-4">Clear all</button>
            <button type="button" onClick={save} disabled={!dirty || busy} className="btn-primary ml-auto min-h-11 px-5">{busy ? 'Saving…' : 'Save availability'}</button>
          </div>

          {/* Below the buttons, so the result of Save is in view and a message appearing never moves the grid during a drag */}
          <div className="mt-3">
            {saveError ? <ErrorBox>{saveError}</ErrorBox> : notice ? (
              <p role="status" className="flex items-center gap-2 rounded-lg bg-ok-50 px-3 py-2.5 text-sm text-green-800"><Icon name="check-circle" className="h-4 w-4 shrink-0" /> {notice}</p>
            ) : total === 0 ? (
              <p role="status" className="rounded-lg bg-accent-50 px-3 py-2.5 text-sm text-amber-900">Parents can't book you until you add hours.</p>
            ) : null}
          </div>
        </section>

        <AddHours onAdd={(days, from, to) => edit((prev) => addHours(prev, days, from, to))} />
      </div>
    </div>
  )
}

function Legend() {
  const items = [
    ['bg-brand-500 text-white', 'check', 'Available'],
    ['bg-slate-200 text-slate-700', 'lock', 'Booked lesson (locked)'],
    ['border border-slate-200 bg-white', null, 'Not available'],
  ]
  return (
    <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700">
      {items.map(([cls, icon, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className={`flex h-4 w-4 items-center justify-center rounded ${cls}`} aria-hidden="true">{icon && <Icon name={icon} className="h-3 w-3" strokeWidth={3} />}</span>
          {label}
        </li>
      ))}
    </ul>
  )
}

function Row({ hour, cells, locked, onPress, onKeyToggle }) {
  return (
    <>
      <div className="sticky left-0 z-10 flex items-center justify-center border-b border-r border-brand-100 bg-white whitespace-nowrap text-xs font-medium text-slate-600">{hour}–{hourEnd(hour)}</div>
      {DAYS.map((day) => {
        const key = cellKey(day.value, hour)
        const isLocked = locked.has(key)
        const on = cells.has(key)
        const name = `${day.label} ${hour} to ${hourEnd(hour)}${isLocked ? ', booked lesson, locked' : ''}`
        return (
          <button
            key={key}
            type="button"
            data-cell={key}
            aria-pressed={on}
            aria-label={name}
            disabled={isLocked}
            title={isLocked ? LOCKED_TIP : undefined}
            onPointerDown={(e) => onPress(e, key)}
            // Pointer presses are handled above; a click with detail 0 comes from Space or Enter
            onClick={(e) => { if (e.detail === 0) onKeyToggle(key) }}
            className={`flex h-11 touch-manipulation items-center justify-center border-b border-r border-brand-100 ${
              isLocked ? 'cursor-not-allowed bg-slate-200 text-slate-700' : on ? 'bg-brand-500 text-white hover:bg-brand-600' : 'bg-white text-transparent hover:bg-brand-50'
            }`}
          >
            {(on || isLocked) && <Icon name={isLocked ? 'lock' : 'check'} className="h-4 w-4" strokeWidth={isLocked ? 2 : 3} />}
          </button>
        )
      })}
    </>
  )
}

// "Add many hours at once": never switches off an hour that is already on
function AddHours({ onAdd }) {
  const [days, setDays] = useState([])
  const [from, setFrom] = useState('17:00')
  const [to, setTo] = useState('21:00')
  const [error, setError] = useState('')

  const toggleDay = (value, on) => setDays((d) => (on ? [...d, value] : d.filter((x) => x !== value)))

  function add() {
    if (!days.length) return setError('Choose at least one day.')
    if (from >= to) return setError('The end time must be later than the start time.')
    setError('')
    onAdd(days, from, to)
  }

  return (
    <section className="card h-fit p-5" aria-labelledby="add-hours-title">
      <h2 id="add-hours-title" className="font-display text-lg font-bold text-navy">Add many hours at once</h2>
      <fieldset className="mt-3">
        <legend className="mb-1 text-sm font-semibold text-navy">Days</legend>
        <div className="grid grid-cols-2 gap-x-3">
          {DAYS.map((day) => (
            <label key={day.value} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-navy">
              <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={days.includes(day.value)} onChange={(e) => toggleDay(day.value, e.target.checked)} /> {day.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <label className="block text-sm font-semibold text-navy">From
          <select className="input mt-1 h-11" value={from} onChange={(e) => setFrom(e.target.value)}>
            {HOURS.map((h) => <option key={h}>{h}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-navy">To
          <select className="input mt-1 h-11" value={to} onChange={(e) => setTo(e.target.value)}>
            {[...HOURS.slice(1), DAY_END].map((h) => <option key={h}>{h}</option>)}
          </select>
        </label>
      </div>
      <ErrorBox className="mt-3">{error}</ErrorBox>
      <button type="button" onClick={add} className="btn-primary mt-3 min-h-11 w-full">Add</button>

      <h3 className="mt-5 text-sm font-semibold text-navy">Quick add</h3>
      <div className="mt-2 space-y-2">
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => { setError(''); onAdd(p.days, p.from, p.to) }} className="btn-outline min-h-11 w-full px-3 text-sm">{p.label}</button>
        ))}
      </div>
    </section>
  )
}
