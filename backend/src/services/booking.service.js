// Slot generation + conflict checks for the booking flow.
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { addDays, fromMinutes, mytParts, mytToDate, toMinutes } from '../utils/time.js'

// A tutor's slot is blocked only once a booking is waiting for payment or paid.
// Plain PENDING requests don't block it — the tutor may still reject or counter them.
export const SLOT_BLOCKING = ['AWAITING_PAYMENT', 'CONFIRMED']
// For the *child*, any live booking counts (we don't want the same child double-booked)
export const CHILD_BLOCKING = ['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT', 'CONFIRMED']

const LESSON_MINUTES = 60

// Split a tutor's availability ranges (e.g. Mon 09:00–12:00) into 1-hour lesson cells
function cellsForDay(availability, dow) {
  const cells = []
  for (const slot of availability.filter((a) => a.dayOfWeek === dow)) {
    for (let m = toMinutes(slot.startTime); m + LESSON_MINUTES <= toMinutes(slot.endTime); m += LESSON_MINUTES)
      cells.push({ start: fromMinutes(m), end: fromMinutes(m + LESSON_MINUTES) })
  }
  return cells.sort((a, b) => a.start.localeCompare(b.start))
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd

// 7 days starting at `fromDate` (YYYY-MM-DD) with every lesson cell and whether it can still be booked
export async function getTutorSlots(tutorId, fromDate, days = 7) {
  const [availability, blocking] = await Promise.all([
    prisma.availabilitySlot.findMany({ where: { tutorId } }),
    prisma.booking.findMany({
      where: {
        tutorId,
        status: { in: SLOT_BLOCKING },
        startAt: { gte: mytToDate(fromDate, '00:00'), lt: mytToDate(addDays(fromDate, days), '00:00') },
      },
      select: { startAt: true, endAt: true },
    }),
  ])
  const now = new Date()
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(fromDate, i)
    const dow = mytParts(mytToDate(date, '12:00')).dow
    const slots = cellsForDay(availability, dow).map((c) => {
      const s = mytToDate(date, c.start)
      const e = mytToDate(date, c.end)
      const taken = s <= now || blocking.some((b) => overlaps(s, e, b.startAt, b.endAt))
      return { ...c, status: taken ? 'unavailable' : 'available' }
    })
    return { date, dow, slots }
  })
}

// Throws unless the requested hour is inside the tutor's availability and not taken
// ignoreBookingId: when an existing booking is being moved, it must not clash with itself
export async function assertSlotBookable({ tutorId, startAt, endAt, ignoreBookingId }) {
  if (startAt <= new Date()) throw new AppError(400, 'Please choose a time in the future')
  const { date, time, dow } = mytParts(startAt)
  const availability = await prisma.availabilitySlot.findMany({ where: { tutorId, dayOfWeek: dow } })
  const end = mytParts(endAt)
  const inside = availability.some(
    (a) => toMinutes(a.startTime) <= toMinutes(time) && toMinutes(a.endTime) >= toMinutes(end.time) && end.date === date,
  )
  if (!inside) throw new AppError(400, 'The tutor is not available at that time')
  const clash = await prisma.booking.findFirst({
    where: { tutorId, status: { in: SLOT_BLOCKING }, startAt: { lt: endAt }, endAt: { gt: startAt }, ...(ignoreBookingId && { id: { not: ignoreBookingId } }) },
  })
  if (clash) throw new AppError(409, 'That time slot has just been taken. Please pick another slot.')
}

// Conflict check is per CHILD (siblings may have overlapping lessons)
export async function assertChildFree({ childId, startAt, endAt, ignoreBookingId }) {
  const clash = await prisma.booking.findFirst({
    where: {
      childId,
      status: { in: CHILD_BLOCKING },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(ignoreBookingId && { id: { not: ignoreBookingId } }),
    },
  })
  if (clash) throw new AppError(409, 'This child already has a lesson booked at that time')
}
