// Date / money helpers. Lessons are always shown in Malaysia time, whatever the browser's timezone is.
const TZ = 'Asia/Kuala_Lumpur'

export const fmtDate = (d) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(d))
    .replace(/^(\w+) /, '$1, ')

export const fmtDateLong = (d) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(d))
    .replace(/^(\w+) /, '$1, ')

export const fmtShortDate = (d) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d))

export const fmtTime = (d) =>
  new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(d))

export const fmtTimeRange = (a, b) => `${fmtTime(a)} – ${fmtTime(b)}`

// "18:00" -> "6:00 PM"
export function hhmmLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export const money = (n) => `RM ${Number(n).toFixed(2)}`

export function timeAgo(d) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000)
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hour${s >= 7200 ? 's' : ''} ago`
  const days = Math.floor(s / 86400)
  return days === 1 ? '1 day ago' : days < 30 ? `${days} days ago` : fmtShortDate(d)
}

// Whole days between now and a date (for "Lesson in 3 days")
export function daysUntil(d) {
  const ms = new Date(d).getTime() - Date.now()
  return Math.ceil(ms / 86400000)
}

export const greeting = () => {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hour12: false }).format(new Date()))
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

// YYYY-MM-DD in Malaysia time
export const toYmd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d))
export const todayYmd = () => toYmd(new Date())

export function addDaysYmd(ymd, n) {
  const d = new Date(`${ymd}T12:00:00+08:00`)
  d.setUTCDate(d.getUTCDate() + n)
  return toYmd(d)
}

export function mondayOfYmd(ymd) {
  const dow = new Date(`${ymd}T12:00:00+08:00`).getUTCDay() // 0 = Sunday
  return addDaysYmd(ymd, dow === 0 ? -6 : 1 - dow)
}

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const weekdayName = (ymd) => DAY_SHORT[new Date(`${ymd}T12:00:00+08:00`).getUTCDay()]
export const dayMonth = (ymd) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short' }).format(new Date(`${ymd}T12:00:00+08:00`))
export const dateLabel = (ymd) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(`${ymd}T12:00:00+08:00`))
    .replace(/^(\w+) /, '$1, ')
