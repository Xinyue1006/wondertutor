// Tutor weekly availability [YH]. A repeating pattern of whole hours, stored as ranges: Mon 14:00-17:00 means the
// lesson cells 14-15, 15-16 and 16-17, which is how booking.service.js and the parent search read the same rows.
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { fromMinutes, mytParts, toMinutes } from '../utils/time.js'
import { SLOT_BLOCKING } from './booking.service.js'

// First and last moment of the tutor's grid (frontend/src/lib/availability.js has the same two values)
export const DAY_START = '07:00'
export const DAY_END = '22:00'
export const MAX_ROWS = 7 * 15 // every hour of every day, stored separately

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOUR = 60

// Per weekday: sort the ranges, then join overlapping or touching ones (14-16 and 16-18 become 14-18)
export function normaliseSlots(slots) {
  const sorted = [...slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || toMinutes(a.startTime) - toMinutes(b.startTime))
  const merged = []
  for (const { dayOfWeek, startTime, endTime } of sorted) {
    const last = merged[merged.length - 1]
    if (last?.dayOfWeek === dayOfWeek && toMinutes(startTime) <= toMinutes(last.endTime)) {
      if (toMinutes(endTime) > toMinutes(last.endTime)) last.endTime = endTime
    } else merged.push({ dayOfWeek, startTime, endTime })
  }
  return merged
}

// Weekly hours held by an upcoming booking that blocks the slot. Those hours cannot be taken off the schedule.
async function lockedHours(tutorId, db = prisma) {
  const bookings = await db.booking.findMany({
    where: { tutorId, status: { in: SLOT_BLOCKING }, startAt: { gt: new Date() } },
    select: { startAt: true },
  })
  const seen = new Map()
  for (const { startAt } of bookings) {
    const { dow, time } = mytParts(startAt)
    const hour = fromMinutes(Math.floor(toMinutes(time) / HOUR) * HOUR)
    seen.set(`${dow}-${hour}`, { dayOfWeek: dow, startTime: hour })
  }
  return [...seen.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime))
}

const covers = (slots, { dayOfWeek, startTime }) => {
  const m = toMinutes(startTime)
  return slots.some((s) => s.dayOfWeek === dayOfWeek && toMinutes(s.startTime) <= m && m + HOUR <= toMinutes(s.endTime))
}

export async function getAvailability(tutorId) {
  const [rows, locked] = await Promise.all([
    prisma.availabilitySlot.findMany({ where: { tutorId } }),
    lockedHours(tutorId),
  ])
  return { slots: normaliseSlots(rows), locked, bounds: { start: DAY_START, end: DAY_END } }
}

// Replaces the whole schedule in one transaction. Refused, with nothing written, if a booked hour would be dropped.
export async function replaceAvailability(tutorId, slots) {
  const merged = normaliseSlots(slots)
  await prisma.$transaction(async (tx) => {
    const dropped = (await lockedHours(tutorId, tx)).filter((hour) => !covers(merged, hour))
    if (dropped.length) {
      const hours = dropped.map((h) => `${DAY_SHORT[h.dayOfWeek]} ${h.startTime}`).join(', ')
      throw new AppError(409, `${hours} ${dropped.length === 1 ? 'has a booked lesson' : 'have booked lessons'}. Cancel or reschedule ${dropped.length === 1 ? 'it' : 'them'} first.`)
    }
    await tx.availabilitySlot.deleteMany({ where: { tutorId } })
    if (merged.length) await tx.availabilitySlot.createMany({ data: merged.map((s) => ({ ...s, tutorId })) })
  })
  return getAvailability(tutorId)
}
