import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import TutorPageHeader from '../../components/TutorPageHeader'
import { ErrorBox, LoadError, Modal, Spinner } from '../../components/ui/Common'
import {
  DAYS, DAY_END, DAY_START, HOURS, MAX_QUICK_ADD, MODE_LABELS, PRESETS, addDays, addHours, applyLockChanges, cellKey, cellsToRanges, clearHours, dateOfDay, dayOfDate,
  eventToRange, hourEnd, keepPast, keepsLocked, malaysiaLabel, modeChoices, modeOf, momentIsPast, moveRange, nowInMalaysia, pastCells, rangeToEvent,
  quickAddDetails, rangesToCells, rangesToModes, removeRange, sameCells, sameModes, setCellModes, shortDate, shownMode, weekLabel,
} from '../../lib/availability'
import { useUnsavedWarning } from '../../lib/useUnsavedWarning'

const BOOKED_TIP = 'Booked lesson. Cancel or reschedule it first.'
const PASSED_TIP = 'Already passed'
const LOCK_REFUSED = 'That change would drop a booked or held hour, so it was undone.'
const DISCARD = 'Discard your unsaved changes?'
const TIME_FORMAT = { hour: '2-digit', minute: '2-digit', hour12: false }
const PLUGINS = [timeGridPlugin, interactionPlugin]
const COPY_WEEKS = 8
const REFRESH_MS = 60_000
const NO_CELLS = new Set()
const NO_MODES = new Map()

const dayOf = (dayOfWeek) => DAYS.find((d) => d.value === dayOfWeek)
const isHeld = (hour) => hour.state === 'PENDING_PAYMENT'

const scopeHours = (view, scope) => (scope === 'usual' ? view.usual : view.effective)

// A week override replaces the usual hours, so the usual hours do not depend on that week's bookings
const lockedCells = (view, scope) =>
  (scope === 'usual' && view.override ? NO_CELLS : new Set(view.booked.map((b) => cellKey(dayOfDate(b.date), b.startTime))))

// Booked hours always count as on, so saving can never drop one
const workingCells = (view, scope) => new Set([...rangesToCells(scopeHours(view, scope)), ...lockedCells(view, scope)])

export default function Availability() {
  const calendar = useRef(null)
  const shownWeek = useRef(null)
  const latestLoad = useRef(0)
  const [view, setView] = useState(null) // the week as the server last sent it
  const [scope, setScope] = useState('usual') // what is being edited: 'usual' or 'week'
  const [saved, setSaved] = useState(null)
  const [cells, setCells] = useState(NO_CELLS) // the one source of truth: FullCalendar only draws and edits it
  const [modes, setModes] = useState(NO_MODES) // teaching mode of each hour in `cells`
  const [savedModes, setSavedModes] = useState(NO_MODES)
  const [picked, setPicked] = useState(null) // the teaching mode new hours get
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
  const showHours = useCallback((data, shown) => {
    const working = workingCells(data, shown)
    const workingModes = rangesToModes(scopeHours(data, shown))
    setScope(shown)
    setCells(working)
    setSaved(working)
    setModes(workingModes)
    setSavedModes(workingModes)
  }, [])

  const showView = useCallback((data, nextScope) => {
    shownWeek.current = data.weekStart
    setView(data)
    showHours(data, nextScope ?? (data.override ? 'week' : 'usual'))
  }, [showHours])

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

  const dirty = saved !== null && (!sameCells(cells, saved) || !sameModes(cells, modes, savedModes))
  useUnsavedWarning(dirty)

  const weekStart = view?.weekStart
  const locked = useMemo(() => (view ? lockedCells(view, scope) : NO_CELLS), [view, scope])
  // The hour that has just started is over for booking, so the greyed hours follow the clock
  const [now, setNow] = useState(() => nowInMalaysia())
  useEffect(() => {
    const tick = () => setNow((prev) => {
      const next = nowInMalaysia()
      return next.date === prev.date && next.time === prev.time ? prev : next
    })
    const timer = setInterval(tick, REFRESH_MS)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', tick)
    }
  }, [])
  // Only a dated week has hours that are over; the usual hours apply to weeks still to come
  const past = useMemo(() => (view && scope === 'week' ? pastCells(weekStart, now) : NO_CELLS), [view, scope, weekStart, now])

  // A held hour frees itself, so the week on screen is re-read. Only the booked and held hours change, never unsaved edits.
  useEffect(() => {
    if (!view || busy) return undefined
    let current = true // false once the week, the scope or a save has moved on
    async function refreshHeld() {
      try {
        const { data } = await api.get('/tutor/availability', { params: { week: view.weekStart } })
        if (!current || JSON.stringify([data.booked, data.changedWeeks]) === JSON.stringify([view.booked, view.changedWeeks])) return
        const next = { ...view, booked: data.booked, changedWeeks: data.changedWeeks }
        const update = (prev) => applyLockChanges(prev, lockedCells(view, scope), lockedCells(next, scope), rangesToCells(scopeHours(view, scope)))
        setView(next)
        setCells(update)
        setSaved(update)
      } catch {
        // The next refresh tries again
      }
    }
    const timer = setInterval(refreshHeld, REFRESH_MS)
    window.addEventListener('focus', refreshHeld)
    return () => {
      current = false
      clearInterval(timer)
      window.removeEventListener('focus', refreshHeld)
    }
  }, [view, scope, busy])

  // Every edit goes through here, so a stale message never stays next to changed hours and past hours never change
  const edit = useCallback((change) => {
    clearMessages()
    setCells((prev) => keepPast(change(prev), prev, past))
  }, [clearMessages, past])

  const choices = modeChoices(view?.offers)
  const teachAs = choices.includes(picked) ? picked : choices[choices.length - 1]
  const frozen = useMemo(() => new Set([...locked, ...past]), [locked, past])
  const paint = (ranges, as = teachAs) => setModes((prev) => setCellModes(prev, ranges, as, frozen))

  // Redrawn from the cell set after every change, so there is no separate event state to keep in sync
  const events = useMemo(() => {
    if (!view) return []
    const active = new Set([...cells].filter((key) => !past.has(key)))
    const label = (range) => `${range.startTime}–${range.endTime}`
    return [
      ...cellsToRanges(active, modes).map((range) => ({ ...rangeToEvent(range, weekStart), title: label(range), extendedProps: { kind: 'block', range } })),
      ...cellsToRanges(past).map((range) => ({ ...rangeToEvent(range, weekStart), display: 'background', classNames: ['fc-passed'], extendedProps: { kind: 'passed', range } })),
      ...(locked.size ? view.booked : []).map((b) => ({
        ...rangeToEvent({ dayOfWeek: dayOfDate(b.date), startTime: b.startTime, endTime: hourEnd(b.startTime) }, weekStart),
        display: 'background',
        classNames: ['fc-locked', isHeld(b) ? 'fc-held' : 'fc-booked'],
        editable: false,
        extendedProps: { kind: 'locked', hour: b },
      })),
    ]
  }, [view, weekStart, cells, modes, past, locked])

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
    showHours(view, next)
  }

  const inPastHere = (moment) => scope === 'week' && momentIsPast(moment, now)

  function onSelect(info) {
    const range = eventToRange(info.start, info.end)
    if (mode === 'add') {
      edit((prev) => addHours(prev, [range.dayOfWeek], range.startTime, range.endTime))
      paint([range])
    } else edit((prev) => removeRange(prev, range, locked))
    info.view?.calendar.unselect()
  }

  // Model-level lock check: FullCalendar has already moved the block on screen, so a refused change is reverted
  function onMoveOrResize(info) {
    const from = eventToRange(info.oldEvent.start, info.oldEvent.end)
    const to = eventToRange(info.event.start, info.event.end)
    const next = moveRange(cells, from, to)
    if (!keepsLocked(next, locked)) {
      info.revert()
      clearMessages()
      setSaveError(LOCK_REFUSED)
      return
    }
    edit(() => next)
    paint([to], modeOf(modes, cellKey(from.dayOfWeek, from.startTime))) // a block keeps its teaching mode
  }

  function renderEvent(arg) {
    const { kind, range, hour } = arg.event.extendedProps
    if (kind === 'locked') return <LockedHour hour={hour} />
    if (kind === 'passed') return <PassedHours range={range} weekStart={weekStart} />
    if (kind !== 'block') return undefined // the shaded preview while dragging a new selection
    return (
      <div className="relative flex h-full items-start justify-between gap-1 px-1 py-px text-xs font-semibold">
        <span className="min-w-0 text-[11px] leading-[13px]">
          <span className="block">{arg.timeText?.replace(' - ', '–') || arg.event.title}</span>
          {range && <span className="block font-medium">{MODE_LABELS[shownMode(range.mode, view.offers)]}</span>}
        </span>
        {!arg.isMirror && (
          // A plain click on the block does nothing, so a tap while scrolling on a phone can never delete hours.
          // On touch the 40 px target sits over the block's corner: a 70 px column cannot hold it beside the text.
          <button type="button" onClick={() => edit((prev) => removeRange(prev, range, locked))} aria-label={`Remove ${dayOf(range.dayOfWeek).label} ${range.startTime} to ${range.endTime}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-white/25 pointer-coarse:absolute pointer-coarse:right-0 pointer-coarse:top-0 pointer-coarse:h-10 pointer-coarse:w-10 pointer-coarse:items-start pointer-coarse:justify-end pointer-coarse:p-1">
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
        <button type="button" onClick={() => edit((prev) => clearHours(prev, locked, day.value))} aria-label={`Clear ${day.label}`} className="min-h-11 min-w-11 px-1 text-xs font-semibold text-brand-600 hover:underline"><span className="sm:hidden">Clear</span><span className="hidden sm:inline">Clear this day</span></button>
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
    const slots = cellsToRanges(cells, modes)
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

  // Saved straight away and separate from the hours, so unsaved hours on the calendar stay as they are
  async function savePresets(presets) {
    const { data } = await api.put('/tutor/availability/quick-add', { presets })
    setView((current) => ({ ...current, quickAdd: data.quickAdd }))
  }

  if (loadError) return <LoadError message={loadError} onRetry={() => load(shownWeek.current)} />
  if (!view) return <Spinner />

  const total = cells.size
  const shownLocks = locked.size ? view.booked : []
  const heldCount = shownLocks.filter(isHeld).length
  const available = [...cells].filter((key) => !locked.has(key) && !past.has(key)).length
  const label = weekLabel(weekStart)
  const atFirst = weekStart <= view.limits.first
  const atLast = weekStart >= view.limits.last
  const weekScope = scope === 'week'
  const target = weekScope ? 'this week only' : 'my usual hours'
  const nextWeeks = Array.from({ length: COPY_WEEKS }, (_, i) => addDays(weekStart, (i + 1) * 7)).filter((w) => w <= view.limits.last)
  const navButton = 'btn-outline min-h-11 px-3 text-sm'
  const actionButton = 'btn-outline min-h-11 flex-1 basis-[calc(50%-0.375rem)] px-4 sm:flex-none sm:basis-auto'

  return (
    <div>
      <TutorPageHeader
        title="My availability"
        subtitle="Plan when and how you teach. Set your usual hours, or adjust one week at a time."
        right={<Link to="/tutor/availability/dates" className="btn-outline min-h-11"><Icon name="edit" className="h-4 w-4" />Set different hours for one date</Link>}
      />

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="card min-w-0 p-4 md:p-5" aria-label="Weekly hours">
          <div className="mb-4 flex items-center gap-2 border-b border-brand-100 pb-4">
            <Icon name="calendar" className="h-5 w-5 text-brand-500" />
            <h2 className="text-lg font-bold text-navy">Teaching schedule</h2>
            <span className="ml-auto text-xs font-medium text-slate-500">Malaysia time</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => moveCalendar((c) => c.prev())} disabled={atFirst} className={navButton}>Previous</button>
            <button type="button" onClick={() => moveCalendar((c) => c.today())} disabled={atFirst} className={navButton}>Today</button>
            <button type="button" onClick={() => moveCalendar((c) => c.next())} disabled={atLast} className={navButton}>Next</button>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <h2 className="font-display text-lg font-bold text-navy sm:ml-1">{weekLabel(weekStart, true)}</h2>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${view.override ? 'bg-accent-100 text-amber-900' : 'bg-brand-50 text-brand-700'}`}>{view.override ? 'Changed for this week' : 'Your usual hours'}</span>
            </div>
          </div>

          {view.changedWeeks.length > 0 && (
            <div className="mt-2 flex flex-nowrap items-center gap-2 overflow-x-auto text-xs sm:flex-wrap">
              <span className="shrink-0 text-slate-600">Weeks with their own hours:</span>
              {view.changedWeeks.map((w) => (
                <button key={w} type="button" onClick={() => moveCalendar((c) => c.gotoDate(w))} aria-current={w === weekStart ? 'true' : undefined} className="min-h-11 shrink-0 rounded-full border border-brand-200 px-3 font-semibold text-brand-700 hover:bg-brand-50">{weekLabel(w)}</button>
              ))}
            </div>
          )}

          <fieldset className="mt-3 flex min-w-0 flex-col gap-x-4 text-sm text-navy sm:flex-row sm:flex-wrap sm:items-center">
            <legend className="float-left mr-3 flex min-h-11 items-center font-semibold">Editing:</legend>
            {[['usual', 'My usual hours'], ['week', `This week only (${label})`]].map(([value, text]) => (
              <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2">
                <input type="radio" name="availability-scope" className="h-4 w-4 accent-brand-500" checked={scope === value} onChange={() => changeScope(value)} /> {text}
              </label>
            ))}
          </fieldset>

          <div className="mb-3 mt-1 flex flex-wrap items-center justify-between gap-3">
            <WeekSummary available={available} booked={shownLocks.length - heldCount} held={heldCount} />
            <ModeSwitch mode={mode} onChange={setMode} />
          </div>

          <TeachAs choices={choices} value={teachAs} onChange={setPicked} />

          <Legend />

          {/* The calendar scrolls inside this box on small screens, so the page itself never scrolls sideways */}
          <div className="overflow-x-auto overscroll-x-contain rounded-lg">
            <div className={`wt-calendar min-w-[560px] ${mode === 'remove' ? 'wt-calendar-remove' : ''}`}>
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
          <p className="mt-2 text-xs text-slate-600 sm:hidden">Swipe sideways to see all seven days.</p>
          <p className="mt-2 text-xs text-slate-600">Choose the teaching mode, then drag over the hours to add them (or remove them in Remove mode). On a phone, press and hold, then drag.<span className="hidden sm:inline"> To change the mode of hours you already have, choose the mode and add them again with Add many hours at once. Drag a block to move it, or pull its edge to change its length. Nothing changes for parents until you save. Using a keyboard? Use Add many hours at once.</span></p>
          <p className="mt-1 text-xs font-semibold text-navy">Editing now: {target}</p>

          {/* On phones the outer box dissolves, so the Save row can stick against the whole section */}
          <div className="contents sm:mt-4 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <div className="mt-4 flex flex-wrap items-stretch gap-3 sm:contents">
              <button type="button" onClick={() => edit((prev) => clearHours(prev, locked))} className={actionButton}>Clear all</button>
              {weekScope && view.override && <button type="button" onClick={reset} disabled={busy} className={actionButton}>Reset this week to my usual hours</button>}
              {weekScope && <button type="button" onClick={() => setCopyOpen(true)} disabled={dirty || busy || nextWeeks.length === 0} title={dirty ? 'Save this week first' : undefined} className={actionButton}>Copy this week to…</button>}
            </div>
            <div className="sticky bottom-0 z-10 -mx-4 mt-3 border-t border-brand-100 bg-white/95 px-4 py-3 backdrop-blur sm:static sm:z-auto sm:mx-0 sm:ml-auto sm:mt-0 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
              <button type="button" onClick={save} disabled={!dirty || busy} className="btn-primary min-h-11 w-full px-5 sm:w-auto">{busy ? 'Saving…' : weekScope ? 'Save this week' : 'Save usual hours'}</button>
            </div>
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

        <AddHours
          target={target}
          modeLabel={MODE_LABELS[teachAs]}
          teachAs={teachAs}
          onPickMode={setPicked}
          presets={view.quickAdd ?? PRESETS}
          onSavePresets={savePresets}
          onAdd={(days, from, to, as) => {
            edit((prev) => addHours(prev, days, from, to))
            paint(days.map((dayOfWeek) => ({ dayOfWeek, startTime: from, endTime: to })), choices.includes(as) ? as : teachAs)
          }}
        />
      </div>

      {copyOpen && <CopyDialog weeks={nextWeeks} changed={view.changedWeeks} busy={busy} onClose={() => setCopyOpen(false)} onCopy={copyTo} />}
    </div>
  )
}

function LockedHour({ hour }) {
  const held = isHeld(hour)
  const day = dayOf(dayOfDate(hour.date)).label
  return (
    <div
      role="img"
      aria-label={`${day} ${shortDate(hour.date)} ${hour.startTime}, ${held ? 'pending payment' : 'booked'}`}
      title={held ? `Held until ${malaysiaLabel(hour.holdUntil)} while the parent pays. It is released if they don't.` : BOOKED_TIP}
      className="flex h-full items-center justify-center"
    >
      <Icon name={held ? 'clock' : 'lock'} className="h-4 w-4" />
    </div>
  )
}

function PassedHours({ range, weekStart }) {
  const date = dateOfDay(weekStart, range.dayOfWeek)
  return (
    <div title={PASSED_TIP} aria-label={`${dayOf(range.dayOfWeek).label} ${shortDate(date)} ${range.startTime} to ${range.endTime}, passed`} role="img" className="flex h-full justify-center pt-1 text-xs">
      Passed
    </div>
  )
}

function WeekSummary({ available, booked, held }) {
  const items = [[available, 'Available'], [booked, 'Booked'], [held, 'Pending payment']]
  return (
    <div className="w-full sm:w-auto">
      <h3 id="your-week" className="font-display text-lg font-bold text-navy">Your week</h3>
      <ul aria-labelledby="your-week" className="flex flex-wrap gap-x-4 text-sm text-slate-700">
        {items.map(([count, text]) => <li key={text}><b className="text-navy">{count}</b> {text}</li>)}
      </ul>
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
      width="max-w-lg max-h-[90dvh]!"
      footer={(
        <>
          <button type="button" onClick={onClose} className="btn-outline min-h-11 px-4">Cancel</button>
          <button type="button" onClick={() => onCopy(picked)} disabled={busy || picked.length === 0} className="btn-primary min-h-11 px-5">{busy ? 'Copying…' : 'Copy'}</button>
        </>
      )}
    >
      <p className="mb-2 text-sm text-slate-600">The saved hours of this week are copied. A week with a booked or held hour that would be lost is skipped.</p>
      <ul className="max-h-[40dvh] overflow-y-auto">
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

function TeachAs({ choices, value, onChange }) {
  if (choices.length === 1) return <p className="mb-3 text-sm text-navy"><span className="font-semibold">Teaching mode:</span> {MODE_LABELS[value]} (set in My Profile)</p>
  return (
    <fieldset className="mb-2 flex min-w-0 flex-wrap items-center gap-x-4 text-sm text-navy">
      <legend className="float-left mr-3 flex min-h-11 w-full items-center font-semibold sm:w-auto">Teaching mode:</legend>
      {choices.map((choice) => (
        <label key={choice} className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 sm:flex-none">
          <input type="radio" name="availability-teaching-mode" className="h-4 w-4 accent-brand-500" checked={value === choice} onChange={() => onChange(choice)} /> {MODE_LABELS[choice]}
        </label>
      ))}
    </fieldset>
  )
}

function ModeSwitch({ mode, onChange }) {
  return (
    <div role="radiogroup" aria-label="What dragging does" className="flex w-full rounded-lg border border-brand-200 p-0.5 text-sm font-semibold sm:w-auto">
      {[['add', 'Add hours'], ['remove', 'Remove hours']].map(([value, text]) => (
        <label key={value} className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-md px-3 sm:flex-none ${mode === value ? 'bg-brand-500 text-white' : 'text-navy hover:bg-brand-50'}`}>
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
    ['bg-slate-600 text-white', 'lock', 'Booked'],
    ['border border-dashed border-amber-700 bg-amber-100 text-amber-900', 'clock', 'Pending payment'],
    ['border border-slate-200 bg-slate-100', null, 'Passed'],
    ['border border-slate-200 bg-white', null, 'Not available'],
  ]
  return (
    <ul aria-label="Legend" className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-700 sm:flex sm:flex-wrap sm:gap-x-5">
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
function AddHours({ onAdd, target, modeLabel, teachAs, onPickMode, presets, onSavePresets }) {
  const [days, setDays] = useState([])
  const [from, setFrom] = useState('17:00')
  const [to, setTo] = useState('21:00')
  const [error, setError] = useState('')
  const [draft, setDraft] = useState(null) // the quick add being named: { index, label }, index is null for a new one
  const [saving, setSaving] = useState(false)

  const toggleDay = (value, on) => setDays((d) => (on ? [...d, value] : d.filter((x) => x !== value)))
  const problem = () => (!days.length ? 'Choose at least one day.' : from >= to ? 'The end time must be later than the start time.' : '')

  function add() {
    const found = problem()
    setError(found)
    if (!found) onAdd(days, from, to)
  }

  async function store(next) {
    setSaving(true)
    setError('')
    try {
      await onSavePresets(next)
      setDraft(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function saveDraft() {
    const found = problem() || (draft.label.trim() ? '' : 'Give the quick add a name.')
    if (found) return setError(found)
    const preset = { label: draft.label.trim(), days, from, to, mode: teachAs }
    store(draft.index === null ? [...presets, preset] : presets.map((p, i) => (i === draft.index ? preset : p)))
  }

  // Loads a quick add into the fields above, so it is edited the same way it was made
  function startEdit(index) {
    const preset = presets[index]
    setDays(preset.days)
    setFrom(preset.from)
    setTo(preset.to)
    if (preset.mode) onPickMode(preset.mode)
    setError('')
    setDraft({ index, label: preset.label })
  }

  function remove(index) {
    if (window.confirm(`Delete the quick add "${presets[index].label}"?`)) store(presets.filter((_, i) => i !== index))
  }

  return (
    <section className="card h-fit p-5" aria-labelledby="add-hours-title">
      <div className="mb-3 flex items-center gap-2 border-b border-brand-100 pb-3">
        <Icon name="plus" className="h-5 w-5 shrink-0 text-brand-500" />
        <h2 id="add-hours-title" className="text-lg font-bold text-navy">Add many hours at once</h2>
      </div>
      <p className="mt-1 text-xs text-slate-600">Adding to: {target}</p>
      <p className="text-xs text-slate-600">Added as: {modeLabel}</p>
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
          <select className="input mt-1 h-11 text-base" value={from} onChange={(e) => setFrom(e.target.value)}>
            {HOURS.map((h) => <option key={h}>{h}</option>)}
          </select>
        </label>
        <label className="block text-sm font-semibold text-navy">To
          <select className="input mt-1 h-11 text-base" value={to} onChange={(e) => setTo(e.target.value)}>
            {[...HOURS.slice(1), DAY_END].map((h) => <option key={h}>{h}</option>)}
          </select>
        </label>
      </div>
      <ErrorBox className="mt-3">{error}</ErrorBox>
      <button type="button" onClick={add} className="btn-primary mt-3 min-h-11 w-full">Add</button>

      {draft ? (
        <div className="mt-3 rounded-lg border border-brand-200 p-3">
          <label className="block text-sm font-semibold text-navy">Quick add name
            <input className="input mt-1 h-11 text-base" maxLength={40} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </label>
          <p className="mt-1 text-xs text-slate-600">Saves the days, times and teaching mode chosen above.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={saveDraft} disabled={saving} className="btn-primary min-h-11 flex-1 px-3 text-sm">{saving ? 'Saving…' : draft.index === null ? 'Save quick add' : 'Update quick add'}</button>
            <button type="button" onClick={() => { setDraft(null); setError('') }} className="btn-outline min-h-11 px-3 text-sm">Cancel</button>
          </div>
        </div>
      ) : presets.length < MAX_QUICK_ADD ? (
        <button type="button" onClick={() => { setError(''); setDraft({ index: null, label: '' }) }} className="btn-outline mt-2 min-h-11 w-full text-sm">Save as a quick add</button>
      ) : (
        <p className="mt-2 text-xs text-slate-600">You have {MAX_QUICK_ADD} quick adds, the most you can keep. Delete one to save another.</p>
      )}

      <h3 className="mt-5 text-sm font-semibold text-navy">Quick add</h3>
      {presets.length === 0 && <p className="mt-1 text-xs text-slate-600">No quick adds yet. Choose days and times above, then save them here.</p>}
      <ul className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-1">
        {presets.map((p, i) => (
          <li key={`${p.label}-${i}`} className="flex min-w-0 flex-col gap-1 lg:flex-row lg:items-stretch">
            <button type="button" aria-label={p.label} onClick={() => { setError(''); onAdd(p.days, p.from, p.to, p.mode) }} className="btn-outline min-h-11 min-w-0 flex-1 flex-col gap-0 px-2 text-sm [overflow-wrap:anywhere] lg:px-3">
              <span className="block">{p.label}</span>
              {p.mode && <span className="block text-xs font-normal">{quickAddDetails(p)}</span>}
            </button>
            <div className="flex gap-1 lg:contents">
              <button type="button" aria-label={`Edit ${p.label}`} title="Edit" onClick={() => startEdit(i)} disabled={saving} className="flex min-h-11 flex-1 items-center justify-center rounded-lg text-slate-600 hover:bg-brand-50 lg:w-11 lg:flex-none"><Icon name="edit" className="h-4 w-4" /></button>
              <button type="button" aria-label={`Delete ${p.label}`} title="Delete" onClick={() => remove(i)} disabled={saving} className="flex min-h-11 flex-1 items-center justify-center rounded-lg text-slate-600 hover:bg-red-50 hover:text-red-600 lg:w-11 lg:flex-none"><Icon name="trash" className="h-4 w-4" /></button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
