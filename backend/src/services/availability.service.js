// Tutor availability [YH]. The usual hours are a repeating weekly pattern of whole hours, stored as ranges: Mon 14:00-17:00
// means the lesson cells 14-15, 15-16 and 16-17. A week override replaces the usual hours for that one week only.
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { addDays, mytParts, mytToDate, fromMinutes, toMinutes } from '../utils/time.js'
import { assertEditableWeek, currentWeekStart, fromDbDate, isEditableWeek, lastWeekStart, toDbDate, weekStartOf } from '../utils/week.js'
import { SLOT_BLOCKING } from './booking.service.js'

// First and last moment of the tutor's grid (frontend/src/lib/availability.js has the same two values)
export const DAY_START = '07:00'
export const DAY_END = '22:00'
export const MAX_ROWS = 7 * 15 // every hour of every day, stored separately

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
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

const sameSlots = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const usualSlots = async (tutorId, db = prisma) => normaliseSlots(await db.availabilitySlot.findMany({ where: { tutorId } }))

const weekOverride = (tutorId, weekStart, db = prisma) =>
  db.availabilityWeek.findUnique({ where: { tutorId_weekStart: { tutorId, weekStart: toDbDate(weekStart) } }, include: { slots: true } })

// The one place the rule lives: a date uses its week's override if there is one, otherwise the usual hours of that weekday
export async function effectiveSlotsForDate(tutorId, dateString, db = prisma) {
  const override = await weekOverride(tutorId, weekStartOf(dateString), db)
  const slots = override ? override.slots : await db.availabilitySlot.findMany({ where: { tutorId } })
  const { dow } = mytParts(mytToDate(dateString, '12:00'))
  return normaliseSlots(slots.filter((s) => s.dayOfWeek === dow))
}

// Upcoming bookings that hold their hour, as a Malaysia date and whole hour. `week` limits them to that one week.
async function bookedHours(tutorId, { week } = {}, db = prisma) {
  const now = new Date()
  const bookings = await db.booking.findMany({
    where: {
      tutorId,
      status: { in: SLOT_BLOCKING },
      startAt: week ? { gt: now, gte: mytToDate(week, '00:00'), lt: mytToDate(addDays(week, 7), '00:00') } : { gt: now },
    },
    select: { startAt: true },
  })
  const seen = new Map()
  for (const { startAt } of bookings) {
    const { date, time, dow } = mytParts(startAt)
    const hour = fromMinutes(Math.floor(toMinutes(time) / HOUR) * HOUR)
    seen.set(`${date} ${hour}`, { date, startTime: hour, dayOfWeek: dow })
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
}

const covers = (slots, { dayOfWeek, startTime }) => {
  const m = toMinutes(startTime)
  return slots.some((s) => s.dayOfWeek === dayOfWeek && toMinutes(s.startTime) <= m && m + HOUR <= toMinutes(s.endTime))
}

// "Mon 23 Nov, 15:00"
const hourLabel = ({ date, startTime, dayOfWeek }) => {
  const [, month, day] = date.split('-').map(Number)
  return `${DAY_SHORT[dayOfWeek]} ${day} ${MONTH_SHORT[month - 1]}, ${startTime}`
}

function assertNoneDropped(dropped) {
  if (!dropped.length) return
  const one = dropped.length === 1
  throw new AppError(409, `${dropped.map(hourLabel).join('; ')} ${one ? 'has a booked lesson' : 'have booked lessons'}. Cancel or reschedule ${one ? 'it' : 'them'} first.`)
}

async function changedWeeks(tutorId, db = prisma) {
  const rows = await db.availabilityWeek.findMany({
    where: { tutorId, weekStart: { gte: toDbDate(currentWeekStart()) } },
    orderBy: { weekStart: 'asc' },
    select: { weekStart: true },
  })
  return rows.map((r) => fromDbDate(r.weekStart))
}

export async function getWeekView(tutorId, weekStart) {
  const [usual, row, booked, changed] = await Promise.all([
    usualSlots(tutorId),
    weekOverride(tutorId, weekStart),
    bookedHours(tutorId, { week: weekStart }),
    changedWeeks(tutorId),
  ])
  const override = row ? normaliseSlots(row.slots) : null
  return {
    weekStart,
    usual,
    override,
    effective: override ?? usual,
    booked: booked.map(({ date, startTime }) => ({ date, startTime })),
    changedWeeks: changed,
    limits: { first: currentWeekStart(), last: lastWeekStart() },
    bounds: { start: DAY_START, end: DAY_END },
  }
}

// Stores a week's hours. Hours equal to the usual ones remove the override, so a week only counts as changed if it differs.
async function writeWeek(tutorId, weekStart, merged, tx) {
  const key = { tutorId, weekStart: toDbDate(weekStart) }
  await tx.availabilityWeek.deleteMany({ where: key })
  if (sameSlots(merged, await usualSlots(tutorId, tx))) return
  await tx.availabilityWeek.create({ data: { ...key, slots: { create: merged } } })
}

// A booking only depends on its own week, so a week's save is checked against the bookings inside that week
export async function saveWeek(tutorId, weekStart, slots) {
  assertEditableWeek(weekStart)
  const merged = normaliseSlots(slots)
  await prisma.$transaction(async (tx) => {
    assertNoneDropped((await bookedHours(tutorId, { week: weekStart }, tx)).filter((h) => !covers(merged, h)))
    await writeWeek(tutorId, weekStart, merged, tx)
  })
  return getWeekView(tutorId, weekStart)
}

export async function resetWeek(tutorId, weekStart) {
  assertEditableWeek(weekStart)
  await prisma.$transaction(async (tx) => {
    const usual = await usualSlots(tutorId, tx)
    assertNoneDropped((await bookedHours(tutorId, { week: weekStart }, tx)).filter((h) => !covers(usual, h)))
    await tx.availabilityWeek.deleteMany({ where: { tutorId, weekStart: toDbDate(weekStart) } })
  })
  return getWeekView(tutorId, weekStart)
}

// Each target stands alone: one that cannot take the hours is skipped with a reason and the others are still saved
export async function copyWeek(tutorId, fromWeekStart, toWeekStarts) {
  assertEditableWeek(fromWeekStart)
  const override = await weekOverride(tutorId, fromWeekStart)
  const source = normaliseSlots(override ? override.slots : await usualSlots(tutorId))

  const copied = []
  const skipped = []
  const seen = new Set()
  for (const weekStart of toWeekStarts) {
    if (!isEditableWeek(weekStart)) skipped.push({ weekStart, reason: 'Outside the allowed weeks' })
    else if (weekStart === fromWeekStart) skipped.push({ weekStart, reason: 'This is the week being copied' })
    else if (seen.has(weekStart)) skipped.push({ weekStart, reason: 'Listed more than once' })
    else {
      seen.add(weekStart)
      const dropped = await prisma.$transaction(async (tx) => {
        const lost = (await bookedHours(tutorId, { week: weekStart }, tx)).filter((h) => !covers(source, h))
        if (!lost.length) await writeWeek(tutorId, weekStart, source, tx)
        return lost
      })
      if (dropped.length) skipped.push({ weekStart, reason: `${hourLabel(dropped[0])} has a booked lesson` })
      else copied.push(weekStart)
    }
  }
  return { copied, skipped }
}

// Weeks with an override do not depend on the usual hours, so only bookings in the other weeks are checked
export async function saveUsual(tutorId, slots, viewWeek) {
  const merged = normaliseSlots(slots)
  await prisma.$transaction(async (tx) => {
    const overridden = new Set(await changedWeeks(tutorId, tx))
    const depending = (await bookedHours(tutorId, {}, tx)).filter((h) => !overridden.has(weekStartOf(h.date)))
    assertNoneDropped(depending.filter((h) => !covers(merged, h)))
    await tx.availabilitySlot.deleteMany({ where: { tutorId } })
    if (merged.length) await tx.availabilitySlot.createMany({ data: merged.map((s) => ({ ...s, tutorId })) })
  })
  return getWeekView(tutorId, viewWeek)
}
