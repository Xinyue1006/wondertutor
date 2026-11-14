// Tutor availability [YH]. The usual hours are a repeating weekly pattern of whole hours, stored as ranges: Mon 14:00-17:00
// means the lesson cells 14-15, 15-16 and 16-17. A week override replaces the usual hours for that one week only.
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { addDays, mytParts, mytToDate, toMinutes } from '../utils/time.js'
import { assertEditableWeek, currentWeekStart, fromDbDate, isEditableWeek, lastWeekStart, toDbDate, weekStartOf } from '../utils/week.js'
import { getTutorSlots, SLOT_BLOCKING } from './booking.service.js'
import { paymentDeadline } from './paymentWindow.js'

// First and last moment of the tutor's grid (frontend/src/lib/availability.js has the same two values)
export const DAY_START = '07:00'
export const DAY_END = '22:00'
export const MAX_ROWS = 7 * 15 // every hour of every day, stored separately
export const MAX_QUICK_ADD = 8 // frontend/src/lib/availability.js has the same value

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HOUR = 60

// Whether an hour with this slot mode can be booked as this teaching mode
export const slotAllows = (slotMode, teachingMode) => slotMode === 'BOTH' || slotMode === teachingMode

// Whole intervals may cross touching ranges with different compatible modes.
// Used by booking/rescheduling and when removing an exact-date override.
export function slotsCoverInterval(slots, startAt, endAt, teachingMode) {
  const start = mytParts(startAt), end = mytParts(endAt)
  if (endAt <= startAt || end.date !== start.date) return false
  let cursor = toMinutes(start.time)
  const allowed = slots.filter(s => !teachingMode || slotAllows(s.mode, teachingMode))
    .sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime))
  for (const slot of allowed) {
    if (toMinutes(slot.startTime) > cursor) return false
    cursor = Math.max(cursor, toMinutes(slot.endTime))
    if (cursor >= toMinutes(end.time)) return true
  }
  return false
}

// Per weekday: sort the ranges, then join overlapping or touching ones of the same mode (14-16 and 16-18 become 14-18)
export function normaliseSlots(slots) {
  const sorted = [...slots].sort((a, b) => a.dayOfWeek - b.dayOfWeek || toMinutes(a.startTime) - toMinutes(b.startTime))
  const merged = []
  for (const { dayOfWeek, startTime, endTime, mode = 'BOTH' } of sorted) {
    const last = merged[merged.length - 1]
    const sameDay = last?.dayOfWeek === dayOfWeek
    if (sameDay && mode !== last.mode && toMinutes(startTime) < toMinutes(last.endTime)) throw new AppError(400, 'An hour cannot have two teaching modes')
    if (sameDay && mode === last.mode && toMinutes(startTime) <= toMinutes(last.endTime)) {
      if (toMinutes(endTime) > toMinutes(last.endTime)) last.endTime = endTime
    } else merged.push({ dayOfWeek, startTime, endTime, mode })
  }
  return merged
}

const sameSlots = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const usualSlots = async (tutorId, db = prisma) => normaliseSlots(await db.availabilitySlot.findMany({ where: { tutorId } }))

const weekOverride = (tutorId, weekStart, db = prisma) =>
  db.availabilityWeek.findUnique({ where: { tutorId_weekStart: { tutorId, weekStart: toDbDate(weekStart) } }, include: { slots: true } })

const dayOfDate = (date) => mytParts(mytToDate(date, '12:00')).dow

// The one place the rule lives, for every tutor and date asked: an exact-date change wins, then that week's hours,
// then the usual hours of that weekday. A date or week saved with no hours stays closed. A date change has no mode of
// its own, so its hours are BOTH (the profile still limits the mode). Returns Map(tutorId -> Map(date -> slots)).
export async function effectiveSlots(tutorIds, dates, db = prisma) {
  const weekStarts = [...new Set(dates.map(weekStartOf))]
  const [exceptions, weeks, usual] = await Promise.all([
    db.availabilityException.findMany({ where: { tutorId: { in: tutorIds }, date: { in: dates } } }),
    db.availabilityWeek.findMany({ where: { tutorId: { in: tutorIds }, weekStart: { in: weekStarts.map(toDbDate) } }, include: { slots: true } }),
    db.availabilitySlot.findMany({ where: { tutorId: { in: tutorIds } } }),
  ])
  const result = new Map(tutorIds.map((tutorId) => [tutorId, new Map()]))
  for (const tutorId of tutorIds) {
    for (const date of dates) {
      const dow = dayOfDate(date)
      const exception = exceptions.find((e) => e.tutorId === tutorId && e.date === date)
      const week = weeks.find((w) => w.tutorId === tutorId && fromDbDate(w.weekStart) === weekStartOf(date))
      const slots = exception
        ? exception.ranges.map((r) => ({ dayOfWeek: dow, startTime: r.startTime, endTime: r.endTime, mode: 'BOTH' }))
        : (week ? week.slots : usual.filter((s) => s.tutorId === tutorId)).filter((s) => s.dayOfWeek === dow)
      result.get(tutorId).set(date, normaliseSlots(slots))
    }
  }
  return result
}

export async function effectiveSlotsForDate(tutorId, date, db = prisma) {
  return (await effectiveSlots([tutorId], [date], db)).get(tutorId).get(date)
}

// Same lock as booking, counter-offer acceptance and date changes, so a save and a booking for one tutor never interleave
const lockTutor = (tx, tutorId) => tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${tutorId} FOR UPDATE`

// A date with its own change is ruled by that change, so weekly and usual hours cannot drop a lesson on it
async function ruledByWeekOrUsual(hours, tutorId, db) {
  if (!hours.length) return hours
  const dated = await db.availabilityException.findMany({ where: { tutorId, date: { in: [...new Set(hours.map((h) => h.date))] } }, select: { date: true } })
  const skip = new Set(dated.map((d) => d.date))
  return hours.filter((h) => !skip.has(h.date))
}

// Every grid hour touched by an active booking. Rescheduled lessons may start on
// a half hour, so protecting just the rounded start would lose their final half.
async function bookedHours(tutorId, { week } = {}, db = prisma) {
  const now = new Date()
  const weekEnd = week && addDays(week, 7)
  const bookings = await db.booking.findMany({
    where: {
      tutorId,
      status: { in: SLOT_BLOCKING },
      endAt: { gt: now },
      ...(week && { startAt: { lt: mytToDate(weekEnd, '00:00') }, AND: [{ endAt: { gt: mytToDate(week, '00:00') } }] }),
    },
    select: { startAt: true, endAt: true, status: true, payBy: true, teachingMode: true },
  })
  const seen = new Map()
  for (const { startAt, endAt, status, payBy, teachingMode } of bookings) {
    const start = new Date(startAt)
    start.setUTCMinutes(0, 0, 0) // Malaysia has whole-hour UTC offset and no DST
    for (let cursor = start.getTime(); cursor < endAt.getTime(); cursor += HOUR * 60_000) {
      const { date, time, dow } = mytParts(new Date(cursor))
      if (week && (date < week || date >= weekEnd)) continue
      const key = `${date} ${time}`
      const entry = status === 'CONFIRMED'
        ? { date, startTime: time, dayOfWeek: dow, state: 'BOOKED', teachingMode }
        : { date, startTime: time, dayOfWeek: dow, state: 'PENDING_PAYMENT', holdUntil: paymentDeadline({ payBy, startAt }).toISOString(), teachingMode }
      // A paid lesson wins the display state; two adjoining lessons with different
      // modes need BOTH on their shared grid hour, even though they do not overlap.
      const other = seen.get(key)
      const requiredMode = other && other.teachingMode !== teachingMode ? 'BOTH' : teachingMode
      const winner = !other || (other.state !== 'BOOKED' && (entry.state === 'BOOKED' || entry.holdUntil > other.holdUntil)) ? entry : other
      seen.set(key, { ...winner, teachingMode: requiredMode })
    }
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
}

const covers = (slots, { dayOfWeek, startTime, teachingMode }) => {
  const m = toMinutes(startTime)
  return slots.some(
    (s) => s.dayOfWeek === dayOfWeek && toMinutes(s.startTime) <= m && m + HOUR <= toMinutes(s.endTime) && (!teachingMode || slotAllows(s.mode, teachingMode)),
  )
}

// "Mon 23 Nov, 15:00"
const hourLabel = ({ date, startTime, dayOfWeek }) => {
  const [, month, day] = date.split('-').map(Number)
  return `${DAY_SHORT[dayOfWeek]} ${day} ${MONTH_SHORT[month - 1]}, ${startTime}`
}

// holdUntil is an instant, so it is read back in Malaysia time before formatting
function lockedHourText(hour) {
  if (hour.state === 'BOOKED') return `${hourLabel(hour)} has a booked lesson`
  const { date, time, dow } = mytParts(new Date(hour.holdUntil))
  return `${hourLabel(hour)} is held until a parent pays (by ${hourLabel({ date, startTime: time, dayOfWeek: dow })})`
}

function lockedHoursAdvice(dropped) {
  const booked = dropped.filter((h) => h.state === 'BOOKED').length
  const held = dropped.length - booked
  if (booked && held) return 'Booked lessons must be cancelled or rescheduled first, and held hours are released if the parent does not pay in time.'
  if (booked) return `Cancel or reschedule ${booked === 1 ? 'it' : 'them'} first.`
  return held === 1 ? 'It is released if the parent does not pay in time.' : 'They are released if the parents do not pay in time.'
}

function assertNoneDropped(dropped) {
  if (!dropped.length) return
  throw new AppError(409, `${dropped.map(lockedHourText).join('; ')}. ${lockedHoursAdvice(dropped)}`)
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
  const [usual, row, booked, changed, tutor, parentDays, dated] = await Promise.all([
    usualSlots(tutorId),
    weekOverride(tutorId, weekStart),
    bookedHours(tutorId, { week: weekStart }),
    changedWeeks(tutorId),
    prisma.tutorProfile.findUnique({ where: { id: tutorId }, select: { offersOnline: true, offersPhysical: true, quickAdd: true } }),
    getTutorSlots(tutorId, weekStart),
    prisma.availabilityException.findMany({ where: { tutorId, date: { gte: weekStart, lte: addDays(weekStart, 6) } }, select: { date: true } }),
  ])
  const override = row ? normaliseSlots(row.slots) : null
  const datedDays = new Set(dated.map(d => d.date))
  return {
    weekStart,
    usual,
    override,
    effective: override ?? usual,
    parentDays: parentDays.map(({ date, slots }) => ({
      date, source: datedDays.has(date) ? 'date' : row ? 'week' : 'usual',
      slots: slots.filter(slot => slot.status === 'available'),
    })),
    booked: booked.map(h => ({ ...h,
      ...(datedDays.has(h.date) && { affectsWeek: false }),
      ...((row || datedDays.has(h.date)) && { affectsUsual: false }),
    })), // scope flags stop date/week overrides from locking unrelated usual hours
    changedWeeks: changed,
    offers: { online: tutor.offersOnline, physical: tutor.offersPhysical }, // the profile limits which modes can be chosen
    quickAdd: tutor.quickAdd,
    limits: { first: currentWeekStart(), last: lastWeekStart() },
    bounds: { start: DAY_START, end: DAY_END },
  }
}

// The profile limits the modes: a tutor offering one mode cannot save the other. Neither switched on means not limited yet.
async function assertModesOffered(tutorId, slots, db = prisma) {
  const { offersOnline, offersPhysical } = await db.tutorProfile.findUnique({ where: { id: tutorId }, select: { offersOnline: true, offersPhysical: true } })
  if (offersOnline === offersPhysical) return
  const only = offersOnline ? 'ONLINE' : 'PHYSICAL'
  const other = offersOnline ? 'PHYSICAL' : 'ONLINE'
  if (slots.some((s) => s.mode === other)) throw new AppError(400, `Your profile offers ${only.toLowerCase()} lessons only`)
}

// Replaces the whole list. Saved at once, separately from the hours on the calendar.
export async function saveQuickAdd(tutorId, presets) {
  await assertModesOffered(tutorId, presets)
  return prisma.tutorProfile.update({ where: { id: tutorId }, data: { quickAdd: presets }, select: { quickAdd: true } })
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
  await assertModesOffered(tutorId, slots)
  const merged = normaliseSlots(slots)
  await prisma.$transaction(async (tx) => {
    await lockTutor(tx, tutorId)
    const held = await ruledByWeekOrUsual(await bookedHours(tutorId, { week: weekStart }, tx), tutorId, tx)
    assertNoneDropped(held.filter((h) => !covers(merged, h)))
    await writeWeek(tutorId, weekStart, merged, tx)
  })
  return getWeekView(tutorId, weekStart)
}

export async function resetWeek(tutorId, weekStart) {
  assertEditableWeek(weekStart)
  await prisma.$transaction(async (tx) => {
    await lockTutor(tx, tutorId)
    const usual = await usualSlots(tutorId, tx)
    const held = await ruledByWeekOrUsual(await bookedHours(tutorId, { week: weekStart }, tx), tutorId, tx)
    assertNoneDropped(held.filter((h) => !covers(usual, h)))
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
        await lockTutor(tx, tutorId)
        const lost = (await ruledByWeekOrUsual(await bookedHours(tutorId, { week: weekStart }, tx), tutorId, tx)).filter((h) => !covers(source, h))
        if (!lost.length) await writeWeek(tutorId, weekStart, source, tx)
        return lost
      })
      if (dropped.length) skipped.push({ weekStart, reason: lockedHourText(dropped[0]) })
      else copied.push(weekStart)
    }
  }
  return { copied, skipped }
}

// Weeks with an override do not depend on the usual hours, so only bookings in the other weeks are checked
export async function saveUsual(tutorId, slots, viewWeek) {
  await assertModesOffered(tutorId, slots)
  const merged = normaliseSlots(slots)
  await prisma.$transaction(async (tx) => {
    await lockTutor(tx, tutorId)
    const overridden = new Set(await changedWeeks(tutorId, tx))
    const depending = (await ruledByWeekOrUsual(await bookedHours(tutorId, {}, tx), tutorId, tx)).filter((h) => !overridden.has(weekStartOf(h.date)))
    assertNoneDropped(depending.filter((h) => !covers(merged, h)))
    await tx.availabilitySlot.deleteMany({ where: { tutorId } })
    if (merged.length) await tx.availabilitySlot.createMany({ data: merged.map((s) => ({ ...s, tutorId })) })
  })
  return getWeekView(tutorId, viewWeek)
}
