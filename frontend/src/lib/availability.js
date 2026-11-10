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

export const cellKey = (dayOfWeek, hour) => `${dayOfWeek}-${hour}`

export function rangesToCells(slots) {
  const cells = new Set()
  for (const { dayOfWeek, startTime, endTime } of slots)
    for (let h = hourOf(startTime); h < hourOf(endTime); h++) cells.add(cellKey(dayOfWeek, toHhmm(h)))
  return cells
}

// Consecutive hours of a day become one range
export function cellsToRanges(cells) {
  const ranges = []
  for (let dayOfWeek = 0; dayOfWeek <= 6; dayOfWeek++) {
    let open = null
    for (const hour of [...HOURS, DAY_END]) {
      const on = hour !== DAY_END && cells.has(cellKey(dayOfWeek, hour))
      if (on && open === null) open = hour
      if (!on && open !== null) {
        ranges.push({ dayOfWeek, startTime: open, endTime: hour })
        open = null
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

// The schedule repeats every week, so the calendar shows one fixed reference week instead of real dates.
// 2001-01-01 is a Monday: Monday to Saturday are the 1st to the 6th, Sunday (dayOfWeek 0) is the 7th.
export const REF_MONDAY = '2001-01-01'
const refDate = (dayOfWeek) => `2001-01-0${dayOfWeek === 0 ? 7 : dayOfWeek}`

export const rangeToEvent = ({ dayOfWeek, startTime, endTime }) => ({
  start: `${refDate(dayOfWeek)}T${startTime}:00`,
  end: `${refDate(dayOfWeek)}T${endTime}:00`,
})

// The calendar runs in UTC, so the UTC getters read back exactly the hours that were drawn
export const eventToRange = (start, end) => ({
  dayOfWeek: start.getUTCDay(),
  startTime: toHhmm(start.getUTCHours()),
  endTime: toHhmm(end.getUTCHours()),
})

export const sameCells = (a, b) => a.size === b.size && [...a].every((key) => b.has(key))
