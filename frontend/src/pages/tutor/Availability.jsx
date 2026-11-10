import { useCallback, useEffect, useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import { ErrorBox, LoadError, Spinner } from '../../components/ui/Common'
import {
  DAYS, DAY_END, DAY_START, HOURS, PRESETS, REF_MONDAY, addHours, cellKey, cellsToRanges, clearHours, eventToRange,
  hourEnd, keepsLocked, moveRange, rangeToEvent, rangesToCells, removeRange, sameCells,
} from '../../lib/availability'
import { useUnsavedWarning } from '../../lib/useUnsavedWarning'

const LOCKED_TIP = 'Booked lesson on this day. Cancel or reschedule it first.'
const LOCK_REFUSED = 'That change would drop an hour with a booked lesson. Cancel or reschedule the lesson first.'
const TIME_FORMAT = { hour: '2-digit', minute: '2-digit', hour12: false }
const PLUGINS = [timeGridPlugin, interactionPlugin]

const dayOf = (dayOfWeek) => DAYS.find((d) => d.value === dayOfWeek)

// Booked hours always count as on, so saving can never drop one
function fromServer(data) {
  const locked = new Set(data.locked.map((l) => cellKey(l.dayOfWeek, l.startTime)))
  return { locked, cells: new Set([...rangesToCells(data.slots), ...locked]), lockedHours: data.locked }
}

export default function Availability() {
  const [saved, setSaved] = useState(null) // the schedule as last loaded or saved
  const [cells, setCells] = useState(new Set()) // the one source of truth: FullCalendar only draws and edits it
  const [locked, setLocked] = useState(new Set())
  const [lockedHours, setLockedHours] = useState([])
  const [mode, setMode] = useState('add')
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const apply = useCallback((data) => {
    const next = fromServer(data)
    setLocked(next.locked)
    setLockedHours(next.lockedHours)
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

  // Every edit goes through here, so a stale "saved" or error message never stays next to changed hours
  const edit = useCallback((change) => {
    setNotice('')
    setSaveError('')
    setCells(change)
  }, [])

  // Redrawn from the cell set after every change, so there is no separate event state to keep in sync
  const events = useMemo(() => [
    ...cellsToRanges(cells).map((range) => ({ ...rangeToEvent(range), title: `${range.startTime}–${range.endTime}`, extendedProps: { kind: 'block', range } })),
    ...lockedHours.map((l) => ({
      ...rangeToEvent({ dayOfWeek: l.dayOfWeek, startTime: l.startTime, endTime: hourEnd(l.startTime) }),
      display: 'background',
      classNames: ['fc-locked'],
      editable: false,
      extendedProps: { kind: 'locked' },
    })),
  ], [cells, lockedHours])

  function onSelect(info) {
    const range = eventToRange(info.start, info.end)
    edit((prev) => (mode === 'add' ? addHours(prev, [range.dayOfWeek], range.startTime, range.endTime) : removeRange(prev, range, locked)))
    info.view?.calendar.unselect()
  }

  // Model-level lock check: FullCalendar has already moved the block on screen, so a refused change is reverted
  function onMoveOrResize(info) {
    const next = moveRange(cells, eventToRange(info.oldEvent.start, info.oldEvent.end), eventToRange(info.event.start, info.event.end))
    if (!keepsLocked(next, locked)) {
      info.revert()
      setNotice('')
      setSaveError(LOCK_REFUSED)
      return
    }
    edit(() => next)
  }

  function renderEvent(arg) {
    const { kind, range } = arg.event.extendedProps
    if (kind === 'locked') {
      return (
        <div title={LOCKED_TIP} className="flex h-full items-center justify-center text-slate-700">
          <Icon name="lock" className="h-4 w-4" />
          <span className="sr-only">Booked lesson, locked</span>
        </div>
      )
    }
    if (kind !== 'block') return undefined // the shaded preview while dragging a new selection
    return (
      <div className="flex h-full items-start justify-between gap-1 px-1 py-0.5 text-xs font-semibold">
        <span className="min-w-0 leading-tight">{arg.timeText?.replace(' - ', '–') || arg.event.title}</span>
        {!arg.isMirror && (
          // A plain click on the block does nothing, so a tap while scrolling on a phone can never delete hours
          <button type="button" onClick={() => edit((prev) => removeRange(prev, range, locked))} aria-label={`Remove ${dayOf(range.dayOfWeek).label} ${range.startTime} to ${range.endTime}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-white/25">
            <Icon name="x" className="h-3.5 w-3.5" strokeWidth={3} />
          </button>
        )}
      </div>
    )
  }

  function renderDayHeader(arg) {
    const day = dayOf(arg.date.getUTCDay())
    return (
      <div className="py-0.5 text-center">
        <div className="text-sm font-bold text-navy">{day.short}</div>
        <button type="button" onClick={() => edit((prev) => clearHours(prev, locked, day.value))} aria-label={`Clear ${day.label}`} className="min-h-11 px-1 text-xs font-semibold text-brand-600 hover:underline">Clear this day</button>
      </div>
    )
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-lg font-bold text-navy">{total} {total === 1 ? 'hour' : 'hours'} a week</p>
            <ModeSwitch mode={mode} onChange={setMode} />
          </div>

          <Legend />

          {/* The calendar scrolls inside this box on small screens, so the page itself never scrolls sideways */}
          <div className="overflow-x-auto rounded-lg">
            <div className={`wt-calendar min-w-[640px] ${mode === 'remove' ? 'wt-calendar-remove' : ''}`}>
              <FullCalendar
                plugins={PLUGINS}
                initialView="timeGridWeek"
                initialDate={REF_MONDAY}
                timeZone="UTC"
                locale="en-gb"
                firstDay={1}
                headerToolbar={false}
                allDaySlot={false}
                nowIndicator={false}
                height="auto"
                slotMinTime={`${DAY_START}:00`}
                slotMaxTime={`${DAY_END}:00`}
                slotDuration="01:00:00"
                snapDuration="01:00:00"
                slotLabelFormat={TIME_FORMAT}
                slotLabelContent={(arg) => `${arg.text}–${hourEnd(arg.text)}`}
                eventTimeFormat={TIME_FORMAT}
                displayEventEnd
                dayHeaderFormat={{ weekday: 'short' }}
                dayHeaderContent={renderDayHeader}
                selectable
                selectMirror
                editable={mode === 'add'}
                eventInteractive
                longPressDelay={300}
                selectLongPressDelay={300}
                selectAllow={(s) => s.start.getUTCDate() === s.end.getUTCDate()}
                eventOverlap
                selectOverlap
                events={events}
                eventContent={renderEvent}
                select={onSelect}
                eventDrop={onMoveOrResize}
                eventResize={onMoveOrResize}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-600">Drag over the hours to add them (or remove them in Remove mode). Drag a block to move it, or pull its edge to change its length. On a phone, press and hold, then drag. Nothing changes for parents until you press Save availability. Using a keyboard? Use Add many hours at once.</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => edit((prev) => clearHours(prev, locked))} className="btn-outline min-h-11 px-4">Clear all</button>
            <button type="button" onClick={save} disabled={!dirty || busy} className="btn-primary ml-auto min-h-11 px-5">{busy ? 'Saving…' : 'Save availability'}</button>
          </div>

          {/* Below the buttons, so the result of Save is in view and a message appearing never moves the calendar during a drag */}
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

function ModeSwitch({ mode, onChange }) {
  return (
    <div role="radiogroup" aria-label="What dragging does" className="flex rounded-lg border border-brand-200 p-0.5 text-sm font-semibold">
      {[['add', 'Add hours'], ['remove', 'Remove hours']].map(([value, label]) => (
        <label key={value} className={`flex min-h-10 cursor-pointer items-center rounded-md px-3 ${mode === value ? 'bg-brand-500 text-white' : 'text-navy hover:bg-brand-50'}`}>
          <input type="radio" name="availability-mode" className="sr-only" checked={mode === value} onChange={() => onChange(value)} />
          {label}
        </label>
      ))}
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
