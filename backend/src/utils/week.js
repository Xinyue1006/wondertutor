// Weeks for tutor availability: Monday to Sunday, Malaysia time. A week is named by its Monday as "YYYY-MM-DD".
import { AppError } from './AppError.js'
import { addDays, mondayOf, todayMyt } from './time.js'

export { addDays }

export const MAX_WEEKS_AHEAD = 26
export const WEEK_MESSAGE = `Choose a week from this week to ${MAX_WEEKS_AHEAD} weeks ahead`

export const weekStartOf = (dateString) => mondayOf(dateString)
export const currentWeekStart = () => mondayOf(todayMyt())
export const lastWeekStart = () => addDays(currentWeekStart(), MAX_WEEKS_AHEAD * 7)

// Sunday is dayOfWeek 0 but the last day of the week
export const dateOfDay = (weekStart, dayOfWeek) => addDays(weekStart, dayOfWeek === 0 ? 6 : dayOfWeek - 1)

// A date-only column is stored and read at UTC midnight, so the server's timezone can never shift it by a day
export const toDbDate = (dateString) => new Date(`${dateString}T00:00:00Z`)
export const fromDbDate = (date) => date.toISOString().slice(0, 10)

const isRealDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toDbDate(s).getTime()) && fromDbDate(toDbDate(s)) === s

// True when a tutor may change this week: a real Monday, from the current week to the horizon
export function isEditableWeek(weekStart) {
  return typeof weekStart === 'string' && isRealDate(weekStart) && toDbDate(weekStart).getUTCDay() === 1
    && weekStart >= currentWeekStart() && weekStart <= lastWeekStart()
}

export function assertEditableWeek(weekStart) {
  if (!isEditableWeek(weekStart)) throw new AppError(400, WEEK_MESSAGE)
}
