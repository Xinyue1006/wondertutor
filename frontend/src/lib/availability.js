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

// Every cell on the straight line between two cells. A fast drag reports only some positions along the way,
// so the cells between two reports are filled in here.
export function cellsOnLine(fromKey, toKey) {
  const place = (key) => {
    const [day, hour] = key.split('-')
    return [DAYS.findIndex((d) => d.value === Number(day)), HOURS.indexOf(hour)]
  }
  const [x0, y0] = place(fromKey)
  const [x1, y1] = place(toKey)
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = steps ? i / steps : 0
    return cellKey(DAYS[Math.round(x0 + (x1 - x0) * t)].value, HOURS[Math.round(y0 + (y1 - y0) * t)])
  })
}

export const sameCells = (a, b) => a.size === b.size && [...a].every((key) => b.has(key))
