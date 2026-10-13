import { prisma } from '../../config/prisma.js'
import { bookingInclude, toBookingDto } from '../../services/booking.dto.js'
import { toChildDto } from './children.controller.js'

const PENDING = ['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT']

// Counts used by the dashboard AND the My Bookings header so the two always agree
export async function bookingCounts(parentId) {
  const [upcoming, pending, completed] = await Promise.all([
    prisma.booking.count({ where: { parentId, status: 'CONFIRMED' } }),
    prisma.booking.count({ where: { parentId, status: { in: PENDING } } }),
    prisma.booking.count({ where: { parentId, status: 'COMPLETED' } }),
  ])
  return { upcoming, pending, completed }
}

// GET /parent/dashboard
export async function dashboard(req, res) {
  const parentId = req.parent.id
  const [children, counts, upcoming, activity, lastSearch] = await Promise.all([
    prisma.child.findMany({ where: { parentId }, orderBy: { createdAt: 'asc' } }),
    bookingCounts(parentId),
    prisma.booking.findMany({
      where: { parentId, status: 'CONFIRMED', startAt: { gte: new Date() } },
      include: bookingInclude,
      orderBy: { startAt: 'asc' },
      take: 2,
    }),
    prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 4 }),
    prisma.matchingRequest.findFirst({ where: { parentId }, orderBy: { createdAt: 'desc' } }),
  ])

  res.json({
    children: children.map(toChildDto),
    counts,
    upcoming: upcoming.map(toBookingDto),
    activity: activity.map((n) => ({ id: n.id, type: n.type, title: n.title, message: n.message, link: n.link, createdAt: n.createdAt })),
    lastSearch: lastSearch ? { id: lastSearch.id, criteria: lastSearch.criteria, createdAt: lastSearch.createdAt } : null,
  })
}
