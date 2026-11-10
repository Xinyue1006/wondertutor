// Weekly availability grid helpers. The server stores merged ranges (Mon 14:00-17:00); the page edits a Set of
// one-hour cells keyed "dayOfWeek-startTime" ("1-14:00"), and turns them back into ranges to save.

// First and last moment of the grid (backend/src/services/availability.service.js has the same two values)
export const DAY_START = '07:00'
export const DAY_END = '22:00'

const hourOf = (hhmm) => Number(hhmm.slice(0, 2))
const toHhmm = (hour) => `${String(hour).padStart(2, '0')}:00`

// Start of every one-hour row: 07:00 ... 21:00
export const HOURS = Array.from({ length: hourOf(DAY_END) - hourOf(DAY_START) }, (_, i) => toHhmm(hourOf(DAY_START) + i))
export const hourEnd = (hhmm) => toHhmm(hourOf(hhmm) + 1)

// Display order is Monday first; `value` is the dayOfWeek the server uses (0 = Sunday)
export const DAYS = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 0, label: 'Sunday', short: 'Sun' },
]

export const PRESETS = [
  { label: 'Weekday evenings 17:00–21:00', days: [1, 2, 3, 4, 5], from: '17:00', to: '21:00' },
  { label: 'Weekends 09:00–17:00', days: [6, 0], from: '09:00', to: '17:00' },
]

export const MAX_QUICK_ADD = 8 // backend/src/services/availability.service.js has the same value

export const cellKey = (dayOfWeek, hour) => `${dayOfWeek}-${hour}`

export function rangesToCells(slots) {
  const cells = new Set()
  for (const { dayOfWeek, startTime, endTime } of slots)
    for (let h = hourOf(startTime); h < hourOf(endTime); h++) cells.add(cellKey(dayOfWeek, toHhmm(h)))
  return cells
}

// Teaching mode per hour, kept beside the cell set. An hour with no entry is BOTH.
export const MODE_LABELS = { ONLINE: 'Online', PHYSICAL: 'Physical', BOTH: 'Both' }
export const modeOf = (modes, key) => modes.get(key) ?? 'BOTH'

export function rangesToModes(slots) {
  const modes = new Map()
  for (const slot of slots) for (const key of rangesToCells([slot])) modes.set(key, slot.mode ?? 'BOTH')
  return modes
}

// Gives every hour of the ranges this mode, except the hours in `skip` (booked, held or passed)
export function setCellModes(modes, ranges, mode, skip) {
  const next = new Map(modes)
  for (const key of rangesToCells(ranges)) if (!skip.has(key)) next.set(key, mode)
  return next
}

export const sameModes = (cells, a, b) => [...cells].every((key) => modeOf(a, key) === modeOf(b, key))

// The modes the tutor can pick. The profile sets the limit; a profile with neither switched on is not limited yet.
export function modeChoices(offers) {
  if (offers && offers.online !== offers.physical) return [offers.online ? 'ONLINE' : 'PHYSICAL']
  return ['ONLINE', 'PHYSICAL', 'BOTH']
}

// BOTH on a tutor who offers only one mode means that one mode
export function shownMode(mode, offers) {
  const choices = modeChoices(offers)
  return mode === 'BOTH' && choices.length === 1 ? choices[0] : mode
}

// "Mon, Wed · 17:00–21:00 · Online", Monday first whatever order the days were ticked in
export const quickAddDetails = ({ days, from, to, mode }) =>
  `${DAYS.filter((d) => days.includes(d.value)).map((d) => d.short).join(', ')} · ${from}–${to} · ${MODE_LABELS[mode]}`

// Consecutive hours of a day become one range. With `modes`, a change of mode starts a new range.
export function cellsToRanges(cells, modes) {
  const ranges = []
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    let open = null
    let openMode
    for (const hour of [...HOURS, DAY_END]) {
      const key = cellKey(dayOfWeek, hour)
      const on = hour !== DAY_END && cells.has(key)
      const mode = on && modes ? modeOf(modes, key) : undefined
      if (open !== null && (!on || mode !== openMode)) {
        ranges.push({ dayOfWeek, startTime: open, endTime: hour, ...(modes && { mode: openMode }) })
        open = null
      }
      if (on && open === null) {
        open = hour
        openMode = mode
      }
    }
  }
  return ranges
}

// Switches on every hour from `from` up to `to` on the given days. Never switches anything off.
export function addHours(cells, days, from, to) {
  const next = new Set(cells)
  for (const day of days)
    for (let h = hourOf(from); h < hourOf(to); h++) next.add(cellKey(day, toHhmm(h)))
  return next
}

// Removes a day's hours (or every hour when day is null), leaving booked hours on
export function clearHours(cells, locked, day = null) {
  return new Set([...cells].filter((key) => locked.has(key) || (day !== null && !key.startsWith(`${day}-`))))
}

// Takes a range's hours off, leaving booked hours on (the x button and Remove mode)
export function removeRange(cells, range, locked) {
  const next = new Set(cells)
  for (const key of rangesToCells([range])) if (!locked.has(key)) next.delete(key)
  return next
}

// A block was moved or resized: the old range's hours come off, the new range's go on
export function moveRange(cells, oldRange, newRange) {
  const next = new Set(cells)
  for (const key of rangesToCells([oldRange])) next.delete(key)
  for (const key of rangesToCells([newRange])) next.add(key)
  return next
}

// The lock check run on every move or resize: no booked hour may leave the schedule
export const keepsLocked = (cells, locked) => [...locked].every((key) => cells.has(key))

// After a re-read of the booked and held hours: a new one is switched on, and a released one stays on only if the
// tutor's hours include it. Every other hour, saved or unsaved, is left alone.
export function applyLockChanges(cells, before, after, open) {
  const next = new Set(cells)
  for (const key of before) if (!after.has(key) && !open.has(key)) next.delete(key)
  for (const key of after) next.add(key)
  return next
}

// Dates are "YYYY-MM-DD" strings handled at UTC midnight, so the browser's timezone can never shift them by a day
export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const dayOfDate = (date) => new Date(`${date}T00:00:00Z`).getUTCDay()
// Weeks run Monday to Sunday; Sunday is dayOfWeek 0 but the last day of the week
export const dateOfDay = (weekStart, dayOfWeek) => addDays(weekStart, dayOfWeek === 0 ? 6 : dayOfWeek - 1)
export const weekStartOf = (date) => addDays(date, dayOfDate(date) === 0 ? -6 : 1 - dayOfDate(date))

export const rangeToEvent = ({ dayOfWeek, startTime, endTime }, weekStart) => ({
  start: `${dateOfDay(weekStart, dayOfWeek)}T${startTime}:00`,
  end: `${dateOfDay(weekStart, dayOfWeek)}T${endTime}:00`,
})

// The calendar runs in UTC, so the UTC getters read back exactly the hours that were drawn
export const eventToRange = (start, end) => ({
  dayOfWeek: start.getUTCDay(),
  startTime: toHhmm(start.getUTCHours()),
  endTime: toHhmm(end.getUTCHours()),
})

export const sameCells = (a, b) => a.size === b.size && [...a].every((key) => b.has(key))

// The current date and time in Malaysia, whatever the computer's own timezone is
export function nowInMalaysia(at = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at).map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` }
}

// An hour is over once it has started: a lesson can no longer be booked for it
export const isPastHour = (date, hour, now) => date < now.date || (date === now.date && hour <= now.time)
export const momentIsPast = (moment, now) => isPastHour(moment.toISOString().slice(0, 10), moment.toISOString().slice(11, 16), now)

export function pastCells(weekStart, now) {
  const past = new Set()
  for (const { value } of DAYS)
    for (const hour of HOURS) if (isPastHour(dateOfDay(weekStart, value), hour, now)) past.add(cellKey(value, hour))
  return past
}

// Applied to every edit of a dated week: hours that are over stay exactly as they were
export function keepPast(next, prev, past) {
  const kept = new Set(next)
  for (const key of past) {
    if (prev.has(key)) kept.add(key)
    else kept.delete(key)
  }
  return kept
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayMonth = (date) => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`
export const shortDate = dayMonth

// "Mon 23 Nov, 16:00" in Malaysia time, for an instant sent by the server
export function malaysiaLabel(instant) {
  const { date, time } = nowInMalaysia(new Date(instant))
  return `${DAYS.find((d) => d.value === dayOfDate(date)).short} ${dayMonth(date)}, ${time}`
}

// "16 – 22 Nov", "30 Nov – 6 Dec"; with the year, "16 – 22 Nov 2026"
export function weekLabel(weekStart, withYear = false) {
  const end = addDays(weekStart, 6)
  const [startYear, endYear] = [weekStart.slice(0, 4), end.slice(0, 4)]
  if (withYear && startYear !== endYear) return `${dayMonth(weekStart)} ${startYear} – ${dayMonth(end)} ${endYear}`
  const from = weekStart.slice(5, 7) === end.slice(5, 7) ? String(Number(weekStart.slice(8))) : dayMonth(weekStart)
  return `${from} – ${dayMonth(end)}${withYear ? ` ${endYear}` : ''}`
}
