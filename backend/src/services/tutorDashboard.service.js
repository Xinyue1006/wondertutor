import { prisma } from '../config/prisma.js'
import { addDays, mytParts, mytToDate } from '../utils/time.js'
import { publicReference } from '../utils/publicIds.js'

const select = {
  id: true, publicId: true, startAt: true, endAt: true, subject: true, status: true, child: { select: { name: true } },
  teachingMode: true, meetingLink: true, attendance: { select: { checkInAt: true, checkOutAt: true } },
}

function lessonRow(b, now) {
  if (!b) return null
  const ref = publicReference(b)
  const booking = '/tutor/bookings?booking=' + ref
  const session = '/tutor/bookings/' + ref + '/session'
  let action = 'Open session', to = session
  if (b.status === 'PENDING') {
    action = 'Review booking request'
    to = booking
  } else if (b.status === 'COMPLETED') action = 'View lesson report'
  else if (now >= b.endAt) {
    if (b.attendance?.checkOutAt) action = 'Finish lesson report'
    else if (b.attendance?.checkInAt) action = 'Check out'
  } else if (b.startAt > now && b.teachingMode === 'ONLINE' && !b.meetingLink) {
    action = 'Add class link'
    to = booking + '&action=link'
  }
  return { ref, subject: b.subject, student: b.child.name, startAt: b.startAt, endAt: b.endAt, action, to }
}

export async function teachingDay(tutorId, now = new Date()) {
  const today = mytParts(now).date
  const confirmed = { tutorId, status: 'CONFIRMED' }
  const orderBy = [{ startAt: 'asc' }, { id: 'asc' }]
  const pending = { tutorId, status: 'PENDING' }
  const [newRequests, upcomingSessions, next, sessions, request, unfinished] = await Promise.all([
    prisma.booking.count({ where: pending }),
    prisma.booking.count({ where: { ...confirmed, startAt: { gte: now } } }),
    prisma.booking.findFirst({ where: { ...confirmed, endAt: { gt: now } }, select, orderBy }),
    prisma.booking.findMany({ where: { tutorId, status: { in: ['CONFIRMED', 'COMPLETED'] },
      startAt: { gte: mytToDate(today, '00:00'), lt: mytToDate(addDays(today, 1), '00:00') } }, select, orderBy }),
    prisma.booking.findFirst({ where: { ...pending, startAt: { gt: now } }, select, orderBy }),
    prisma.booking.findFirst({ where: { ...confirmed, endAt: { lte: now }, summary: null, attendance: { checkInAt: { not: null } } }, select, orderBy: [{ endAt: 'desc' }, { id: 'desc' }] }),
  ])
  return { newRequests, upcomingSessions, nextLesson: lessonRow(next, now), todaySessions: sessions.map(b => lessonRow(b, now)),
    actions: [unfinished, request].filter(Boolean).map(b => lessonRow(b, now)) }
}
