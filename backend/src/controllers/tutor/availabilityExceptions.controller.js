import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { hhmm, ymd } from '../../utils/validators.js'
import { mytParts, mytToDate, toMinutes } from '../../utils/time.js'
import { CHILD_BLOCKING } from '../../services/booking.service.js'
import { effectiveSlotsForDate, slotAllows } from '../../services/availability.service.js'

const range = z.object({ startTime: hhmm(), endTime: hhmm() })
const schema = z.object({ date: ymd(), ranges: z.array(range).max(24) }).superRefine((data, ctx) => {
  const sorted = [...data.ranges].sort((a,b) => a.startTime.localeCompare(b.startTime))
  sorted.forEach((r,i) => {
    if (r.startTime >= r.endTime || toMinutes(r.startTime) % 60 || toMinutes(r.endTime) % 60 || (i && sorted[i-1].endTime > r.startTime))
      ctx.addIssue({ code: 'custom', message: 'Use non-overlapping whole-hour ranges with end after start' })
  })
})
export async function list(req,res) {
  const exceptions = await prisma.availabilityException.findMany({ where: { tutorId: req.tutor.id }, orderBy: { date: 'asc' } })
  res.json({ exceptions })
}
export async function save(req,res) {
  const data = schema.parse(req.body)
  if (data.date < mytParts(new Date()).date) throw new AppError(400, 'Choose today or a future date')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${req.tutor.id} FOR UPDATE`
    const start = mytToDate(data.date, '00:00')
    const end = new Date(start.getTime() + 86400000)
    const lessons = await tx.booking.findMany({ where: { tutorId: req.tutor.id, status: { in: CHILD_BLOCKING }, startAt: { lt: end }, endAt: { gt: start } } })
    if (lessons.some(b => !data.ranges.some(r => mytToDate(data.date,r.startTime) <= b.startAt && mytToDate(data.date,r.endTime) >= b.endAt)))
      throw new AppError(409, 'This change conflicts with an existing lesson or request. Resolve that booking first.')
    await tx.availabilityException.upsert({ where: { tutorId_date: { tutorId: req.tutor.id, date: data.date } }, create: { tutorId: req.tutor.id, ...data }, update: { ranges: data.ranges } })
  })
  res.json({ ok: true })
}
export async function remove(req,res) {
  const date = ymd().parse(req.params.date)
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${req.tutor.id} FOR UPDATE`
    // Deleted first, so the date falls back to that week's hours, then the usual hours; a conflict rolls it back
    await tx.availabilityException.deleteMany({ where: { tutorId: req.tutor.id, date } })
    const hours = await effectiveSlotsForDate(req.tutor.id, date, tx)
    const start = mytToDate(date,'00:00')
    const end = new Date(start.getTime()+86400000)
    const lessons = await tx.booking.findMany({ where: { tutorId: req.tutor.id, status: { in: CHILD_BLOCKING }, startAt: { lt: end }, endAt: { gt: start } } })
    if (lessons.some(b => !hours.some(r => mytToDate(date,r.startTime) <= b.startAt && mytToDate(date,r.endTime) >= b.endAt && slotAllows(r.mode, b.teachingMode))))
      throw new AppError(409, 'The weekly schedule conflicts with an existing lesson or request.')
  })
  res.json({ ok: true })
}
