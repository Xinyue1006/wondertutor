import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import { ErrorBox, LoadError, Modal, Spinner } from '../../components/ui/Common'
import {
  DAYS, DAY_END, DAY_START, HOURS, PRESETS, addDays, addHours, cellKey, cellsToRanges, clearHours, dayOfDate, eventToRange,
  hourEnd, keepPast, keepsLocked, momentIsPast, moveRange, nowInMalaysia, pastCells, rangeToEvent, rangesToCells, removeRange,
  sameCells, shortDate, weekLabel,
} from '../../lib/availability'
import { useUnsavedWarning } from '../../lib/useUnsavedWarning'

const LOCKED_TIP = 'Booked lesson on this day. Cancel or reschedule it first.'
const LOCK_REFUSED = 'That change would drop an hour with a booked lesson. Cancel or reschedule the lesson first.'
const DISCARD = 'Discard your unsaved changes?'
const TIME_FORMAT = { hour: '2-digit', minute: '2-digit', hour12: false }
const PLUGINS = [timeGridPlugin, interactionPlugin]
const PAST_BLOCK = '#94a3b8'
const PAST_BACKGROUND = '#f1f5f9'
const COPY_WEEKS = 8
const NO_CELLS = new Set()

const dayOf = (dayOfWeek) => DAYS.find((d) => d.value === dayOfWeek)

// A week override replaces the usual hours, so the usual hours do not depend on that week's bookings
const lockedCells = (view, scope) =>
  (scope === 'usual' && view.override ? NO_CELLS : new Set(view.booked.map((b) => cellKey(dayOfDate(b.date), b.startTime))))

// Booked hours always count as on, so saving can never drop one
const workingCells = (view, scope) => new Set([...rangesToCells(scope === 'usual' ? view.usual : view.effective), ...lockedCells(view, scope)])

export default function Availability() {
  const calendar = useRef(null)
  const shownWeek = useRef(null)
  const latestLoad = useRef(0)
  const [view, setView] = useState(null) // the week as the server last sent it
  const [scope, setScope] = useState('usual') // what is being edited: 'usual' or 'week'
  const [saved, setSaved] = useState(null)
  const [cells, setCells] = useState(NO_CELLS) // the one source of truth: FullCalendar only draws and edits it
  const [mode, setMode] = useState('add')
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [notice, setNotice] = useState('')
  const [copyResult, setCopyResult] = useState(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const clearMessages = useCallback(() => {
    setNotice('')
    setSaveError('')
    setCopyResult(null)
  }, [])

  // Without a scope, a week opens on its own hours if it has an override, otherwise on the usual hours
  const showView = useCallback((data, nextScope) => {
    const shown = nextScope ?? (data.override ? 'week' : 'usual')
    const working = workingCells(data, shown)
    shownWeek.current = data.weekStart
    setView(data)
    setScope(shown)
    setCells(working)
    setSaved(working)
  }, [])

  const load = useCallback(async (week, nextScope) => {
    const id = ++latestLoad.current
    setLoadError('')
    try {
      const { data } = week ? await api.get('/tutor/availability', { params: { week } }) : await api.get('/tutor/availability')
      if (id === latestLoad.current) showView(data, nextScope) // a quick Next, Next must not show an older answer
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [showView])
  useEffect(() => { load() }, [load])

  const dirty = saved !== null && !sameCells(cells, saved)
  useUnsavedWarning(dirty)

  const weekStart = view?.weekStart
  const locked = useMemo(() => (view ? lockedCells(view, scope) : NO_CELLS), [view, scope])
  const now = useMemo(() => nowInMalaysia(), [view]) // eslint-disable-line react-hooks/exhaustive-deps
  // Only a dated week has hours that are over; the usual hours apply to weeks still to come
  const past = useMemo(() => (view && scope === 'week' ? pastCells(weekStart, now) : NO_CELLS), [view, scope, weekStart, now])

  // Every edit goes through here, so a stale message never stays next to changed hours and past hours never change
  const edit = useCallback((change) => {
    clearMessages()
    setCells((prev) => keepPast(change(prev), prev, past))
  }, [clearMessages, past])

  // Redrawn from the cell set after every change, so there is no separate event state to keep in sync
  const events = useMemo(() => {
    if (!view) return []
    const active = new Set([...cells].filter((key) => !past.has(key)))
    const over = new Set([...cells].filter((key) => past.has(key)))
    const label = (range) => `${range.startTime}–${range.endTime}`
    return [
      ...cellsToRanges(active).map((range) => ({ ...rangeToEvent(range, weekStart), title: label(range), extendedProps: { kind: 'block', range } })),
      ...cellsToRanges(over).map((range) => ({ ...rangeToEvent(range, weekStart), title: label(range), editable: false, backgroundColor: PAST_BLOCK, borderColor: PAST_BLOCK, extendedProps: { kind: 'pastBlock' } })),
      ...cellsToRanges(past).map((range) => ({ ...rangeToEvent(range, weekStart), display: 'background', backgroundColor: PAST_BACKGROUND, extendedProps: { kind: 'pastBackground' } })),
      ...(locked.size ? view.booked : []).map((b) => ({
        ...rangeToEvent({ dayOfWeek: dayOfDate(b.date), startTime: b.startTime, endTime: hourEnd(b.startTime) }, weekStart),
        display: 'background',
        classNames: ['fc-locked'],
        editable: false,
        extendedProps: { kind: 'locked' },
      })),
    ]
  }, [view, weekStart, cells, past, locked])

  const confirmDiscard = () => !dirty || window.confirm(DISCARD)

  // Previous, Today, Next and the chips move the calendar; datesSet then loads the week it landed on
  function moveCalendar(move) {
    if (!confirmDiscard()) return
    clearMessages()
    move(calendar.current.getApi())
  }

  function onDatesSet(arg) {
    const week = arg.start.toISOString().slice(0, 10)
    if (week === shownWeek.current) return
    shownWeek.current = week
    load(week)
  }

  function changeScope(next) {
    if (next === scope || !confirmDiscard()) return
    clearMessages()
    const working = workingCells(view, next)
    setScope(next)
    setCells(working)
    setSaved(working)
  }

  const inPastHere = (moment) => scope === 'week' && momentIsPast(moment, now)

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
      clearMessages()
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
    if (kind === 'pastBackground') return <></>
    if (kind !== 'block' && kind !== 'pastBlock') return undefined // the shaded preview while dragging a new selection
    return (
      <div className="flex h-full items-start justify-between gap-1 px-1 py-0.5 text-xs font-semibold">
        <span className="min-w-0 leading-tight">{arg.timeText?.replace(' - ', '–') || arg.event.title}</span>
        {kind === 'block' && !arg.isMirror && (
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
        <div className="text-sm font-bold text-navy">{day.short} {arg.date.getUTCDate()}</div>
        <button type="button" onClick={() => edit((prev) => clearHours(prev, locked, day.value))} aria-label={`Clear ${day.label}`} className="min-h-11 px-1 text-xs font-semibold text-brand-600 hover:underline">Clear this day</button>
      </div>
    )
  }

  async function run(action) {
    setBusy(true)
    clearMessages()
    try {
      await action()
    } catch (err) {
      setSaveError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const save = () => run(async () => {
    const slots = cellsToRanges(cells)
    if (scope === 'usual') {
      const { data } = await api.put('/tutor/availability', { slots }, { params: { week: weekStart } })
      showView(data, 'usual')
      const kept = data.changedWeeks.map(shortDate).join(', ')
      setNotice(`Your usual hours have been saved.${kept ? ` These weeks have their own hours and were not changed: ${kept}.` : ''}`)
    } else {
      const { data } = await api.put(`/tutor/availability/weeks/${weekStart}`, { slots })
      showView(data, 'week')
      setNotice(data.override ? 'This week has been saved.' : 'This week now matches your usual hours.')
    }
  })

  const reset = () => {
    if (!window.confirm('Reset this week to your usual hours?')) return
    run(async () => {
      const { data } = await api.delete(`/tutor/availability/weeks/${weekStart}`)
      showView(data)
      setNotice('This week is back to your usual hours.')
    })
  }

  const copyTo = (to) => run(async () => {
    const { data } = await api.post('/tutor/availability/weeks/copy', { from: weekStart, to })
    setCopyOpen(false)
    await load(weekStart, 'week') // the list of changed weeks has moved on
    setCopyResult(data)
  })

  if (loadError) return <LoadError message={loadError} onRetry={() => load(shownWeek.current)} />
  if (!view) return <Spinner />

  const total = cells.size
  const label = weekLabel(weekStart)
  const atFirst = weekStart <= view.limits.first
  const atLast = weekStart >= view.limits.last
  const weekScope = scope === 'week'
  const target = weekScope ? 'this week only' : 'my usual hours'
  const nextWeeks = Array.from({ length: COPY_WEEKS }, (_, i) => addDays(weekStart, (i + 1) * 7)).filter((w) => w <= view.limits.last)
  const navButton = 'btn-outline min-h-11 px-3 text-sm'

  return (
    <div className="mx-auto max-w-[76rem] py-2">
      <div className="mb-5">
        <h1 className="font-display text-3xl font-bold text-navy">My availability</h1>
        <p className="mt-1 text-slate-600">Your usual hours repeat every week. You can also change one week without touching the others.</p>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="card min-w-0 p-4 md:p-5" aria-label="Weekly hours">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => moveCalendar((c) => c.prev())} disabled={atFirst} className={navButton}>Previous</button>
            <button type="button" onClick={() => moveCalendar((c) => c.today())} disabled={atFirst} className={navButton}>Today</button>
            <button type="button" onClick={() => moveCalendar((c) => c.next())} disabled={atLast} className={navButton}>Next</button>
            <h2 className="ml-1 font-display text-lg font-bold text-navy">{weekLabel(weekStart, true)}</h2>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${view.override ? 'bg-accent-100 text-amber-900' : 'bg-brand-50 text-brand-700'}`}>{view.override ? 'Changed for this week' : 'Your usual hours'}</span>
          </div>

          {view.changedWeeks.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-600">Weeks with their own hours:</span>
              {view.changedWeeks.map((w) => (
                <button key={w} type="button" onClick={() => moveCalendar((c) => c.gotoDate(w))} aria-current={w === weekStart ? 'true' : undefined} className="min-h-11 rounded-full border border-brand-200 px-3 font-semibold text-brand-700 hover:bg-brand-50">{weekLabel(w)}</button>
              ))}
            </div>
          )}

          <fieldset className="mt-3 flex flex-wrap items-center gap-x-4 text-sm text-navy">
            <legend className="float-left mr-3 flex min-h-11 items-center font-semibold">Editing:</legend>
            {[['usual', 'My usual hours'], ['week', `This week only (${label})`]].map(([value, text]) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2">
                <input type="radio" name="availability-scope" className="h-4 w-4 accent-brand-500" checked={scope === value} onChange={() => changeScope(value)} /> {text}
              </label>
            ))}
          </fieldset>

          <div className="mb-3 mt-1 flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-lg font-bold text-navy">{total} {total === 1 ? 'hour' : 'hours'} a week</p>
            <ModeSwitch mode={mode} onChange={setMode} />
          </div>

          <Legend />

          {/* The calendar scrolls inside this box on small screens, so the page itself never scrolls sideways */}
          <div className="overflow-x-auto rounded-lg">
            <div className={`wt-calendar min-w-[640px] ${mode === 'remove' ? 'wt-calendar-remove' : ''}`}>
              <FullCalendar
                ref={calendar}
                plugins={PLUGINS}
                initialView="timeGridWeek"
                initialDate={weekStart}
                validRange={{ start: view.limits.first, end: addDays(view.limits.last, 7) }}
                // Runs in UTC with floating dates, so the hours on screen are Malaysia time on any computer
                timeZone="UTC"
                now={`${now.date}T${now.time}:00`}
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
                dayHeaderFormat={{ weekday: 'short', day: 'numeric' }}
                dayHeaderContent={renderDayHeader}
                selectable
                selectMirror
                editable={mode === 'add'}
                eventInteractive
                longPressDelay={300}
                selectLongPressDelay={300}
                selectAllow={(s) => s.start.getUTCDate() === s.end.getUTCDate() && !inPastHere(s.start)}
                eventAllow={(drop, event) => !inPastHere(drop.start) && !inPastHere(event.start)}
                eventOverlap
                selectOverlap
                events={events}
                eventContent={renderEvent}
                select={onSelect}
                eventDrop={onMoveOrResize}
                eventResize={onMoveOrResize}
                datesSet={onDatesSet}
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-600">Drag over the hours to add them (or remove them in Remove mode). Drag a block to move it, or pull its edge to change its length. On a phone, press and hold, then drag. Nothing changes for parents until you save. Using a keyboard? Use Add many hours at once.</p>
          <p className="mt-1 text-xs font-semibold text-navy">Editing now: {target}</p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => edit((prev) => clearHours(prev, locked))} className="btn-outline min-h-11 px-4">Clear all</button>
            {weekScope && view.override && <button type="button" onClick={reset} disabled={busy} className="btn-outline min-h-11 px-4">Reset this week to my usual hours</button>}
            {weekScope && <button type="button" onClick={() => setCopyOpen(true)} disabled={dirty || busy || nextWeeks.length === 0} title={dirty ? 'Save this week first' : undefined} className="btn-outline min-h-11 px-4">Copy this week to…</button>}
            <button type="button" onClick={save} disabled={!dirty || busy} className="btn-primary ml-auto min-h-11 px-5">{busy ? 'Saving…' : weekScope ? 'Save this week' : 'Save usual hours'}</button>
          </div>

          {/* Below the buttons, so the result of Save is in view and a message appearing never moves the calendar during a drag */}
          <div className="mt-3">
            {saveError ? <ErrorBox>{saveError}</ErrorBox> : notice ? (
              <p role="status" className="flex items-center gap-2 rounded-lg bg-ok-50 px-3 py-2.5 text-sm text-green-800"><Icon name="check-circle" className="h-4 w-4 shrink-0" /> {notice}</p>
            ) : copyResult ? <CopyResult result={copyResult} /> : total === 0 ? (
              <p role="status" className="rounded-lg bg-accent-50 px-3 py-2.5 text-sm text-amber-900">{weekScope ? "Parents can't book you this week." : "Parents can't book you until you add hours."}</p>
            ) : null}
          </div>
        </section>

        <AddHours onAdd={(days, from, to) => edit((prev) => addHours(prev, days, from, to))} target={target} />
      </div>

      {copyOpen && <CopyDialog weeks={nextWeeks} changed={view.changedWeeks} busy={busy} onClose={() => setCopyOpen(false)} onCopy={copyTo} />}
    </div>
  )
}

function CopyResult({ result }) {
  return (
    <div role="status" className="space-y-1 rounded-lg bg-brand-50 px-3 py-2.5 text-sm text-navy">
      {result.copied.length > 0 && <p>Copied to: {result.copied.map((w) => weekLabel(w)).join(', ')}.</p>}
      {result.skipped.map((s) => <p key={s.weekStart + s.reason}>Skipped {shortDate(s.weekStart)}: {s.reason}.</p>)}
    </div>
  )
}

function CopyDialog({ weeks, changed, busy, onClose, onCopy }) {
  const [picked, setPicked] = useState([])
  const firstBox = useRef(null)
  // After Modal's own opening focus, which runs later in the same commit and lands on its first button
  useEffect(() => {
    const timer = setTimeout(() => firstBox.current?.focus())
    return () => clearTimeout(timer)
  }, [])
  const toggle = (week, on) => setPicked((p) => (on ? [...p, week] : p.filter((w) => w !== week)))
  const pickFirst = (n) => setPicked(weeks.slice(0, n))

  return (
    <Modal
      open
      onClose={onClose}
      title="Copy this week to…"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-outline min-h-11 px-4">Cancel</button>
          <button type="button" onClick={() => onCopy(picked)} disabled={busy || picked.length === 0} className="btn-primary min-h-11 px-5">{busy ? 'Copying…' : 'Copy'}</button>
        </>
      )}
    >
      <p className="mb-2 text-sm text-slate-600">The saved hours of this week are copied. A week with a booked lesson that would be lost is skipped.</p>
      <ul>
        {weeks.map((week, i) => (
          <li key={week}>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-navy">
              <input ref={i === 0 ? firstBox : undefined} type="checkbox" className="h-4 w-4 accent-brand-500" checked={picked.includes(week)} onChange={(e) => toggle(week, e.target.checked)} />
              {weekLabel(week)}
              {changed.includes(week) && ' '}
              {changed.includes(week) && <span className="text-xs text-amber-800">will be replaced</span>}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => pickFirst(4)} className="btn-outline min-h-11 px-3 text-sm">Next 4 weeks</button>
        <button type="button" onClick={() => pickFirst(8)} className="btn-outline min-h-11 px-3 text-sm">Next 8 weeks</button>
      </div>
    </Modal>
  )
}

function ModeSwitch({ mode, onChange }) {
  return (
    <div role="radiogroup" aria-label="What dragging does" className="flex rounded-lg border border-brand-200 p-0.5 text-sm font-semibold">
      {[['add', 'Add hours'], ['remove', 'Remove hours']].map(([value, text]) => (
        <label key={value} className={`flex min-h-10 cursor-pointer items-center rounded-md px-3 ${mode === value ? 'bg-brand-500 text-white' : 'text-navy hover:bg-brand-50'}`}>
          <input type="radio" name="availability-mode" className="sr-only" checked={mode === value} onChange={() => onChange(value)} />
          {text}
        </label>
      ))}
    </div>
  )
}

function Legend() {
  const items = [
    ['bg-brand-500 text-white', 'check', 'Available'],
    ['bg-slate-200 text-slate-700', 'lock', 'Booked lesson (locked)'],
    ['bg-slate-400', null, 'Already passed'],
    ['border border-slate-200 bg-white', null, 'Not available'],
  ]
  return (
    <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-700">
      {items.map(([cls, icon, text]) => (
        <li key={text} className="flex items-center gap-1.5">
          <span className={`flex h-4 w-4 items-center justify-center rounded ${cls}`} aria-hidden="true">{icon && <Icon name={icon} className="h-3 w-3" strokeWidth={3} />}</span>
          {text}
        </li>
      ))}
    </ul>
  )
}

// "Add many hours at once": never switches off an hour that is already on
function AddHours({ onAdd, target }) {
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
      <p className="mt-1 text-xs text-slate-600">Adding to: {target}</p>
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
