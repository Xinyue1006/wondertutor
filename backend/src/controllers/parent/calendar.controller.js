import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import { AppError } from '../../utils/AppError.js'
import { buildCalendar } from '../../services/calendar.service.js'

const include = { child: true, tutor: { include: { user: { select: { fullName: true } } } } }

function sendIcs(res, filename, bookings, name) {
  res.set('Content-Type', 'text/calendar; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(buildCalendar(bookings, { baseUrl: env.clientUrl, name }))
}

// GET /parent/bookings/:id/calendar.ics: one confirmed lesson
export async function lessonCalendar(req, res) {
  const b = await prisma.booking.findFirst({ where: { id: Number(req.params.id), parentId: req.parent.id }, include })
  if (!b) throw new AppError(404, 'Booking not found')
  // Only a lesson that is really going ahead belongs in a calendar (not a request that may still be declined)
  if (b.status !== 'CONFIRMED') throw new AppError(400, 'Only confirmed lessons can be added to a calendar')
  sendIcs(res, `wondertutor-lesson-${b.id}.ics`, [b], 'WonderTutor lesson')
}

// GET /parent/bookings/calendar.ics: every confirmed lesson that has not started yet, as one file
export async function upcomingCalendar(req, res) {
  const bookings = await prisma.booking.findMany({
    where: { parentId: req.parent.id, status: 'CONFIRMED', startAt: { gt: new Date() } },
    include,
    orderBy: { startAt: 'asc' },
  })
  if (!bookings.length) throw new AppError(404, 'You have no confirmed upcoming lessons yet')
  sendIcs(res, 'wondertutor-upcoming-lessons.ics', bookings, 'WonderTutor lessons')
}
