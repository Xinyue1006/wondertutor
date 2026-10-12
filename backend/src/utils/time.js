// All lesson times are Malaysia time (UTC+8). The server may run in UTC (Render/Railway),
// so we never rely on the machine's local timezone — we always convert explicitly.

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000
const pad = (n) => String(n).padStart(2, '0')

// "2026-10-14" + "18:00"  ->  Date (absolute instant)
export function mytToDate(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00+08:00`)
}

// Date -> { date: "2026-10-14", time: "18:00", dow: 3 }   (dow: 0 = Sunday)
export function mytParts(d) {
  const s = new Date(d.getTime() + MYT_OFFSET_MS)
  return {
    date: `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}`,
    time: `${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`,
    dow: s.getUTCDay(),
  }
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
export const fromMinutes = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00+08:00`)
  d.setUTCDate(d.getUTCDate() + n)
  return mytParts(d).date
}

// Monday of the week containing dateStr
export function mondayOf(dateStr) {
  const { dow } = mytParts(new Date(`${dateStr}T00:00:00+08:00`))
  return addDays(dateStr, dow === 0 ? -6 : 1 - dow)
}

export const todayMyt = () => mytParts(new Date()).date
