// Booking housekeeping: expiry of unanswered / unpaid bookings and the 24-hour lesson reminder.
import { prisma } from '../config/prisma.js'
import { expireStaleBookings, sendLessonReminders } from '../services/lifecycle.service.js'
import { MONDAY, makeBooking, makeParent, makeTutor, nextDate, resetDb } from './helpers.js'

let parent, tutor, date
beforeAll(async () => {
  await resetDb()
  parent = await makeParent()
  tutor = await makeTutor()
  date = nextDate(MONDAY)
})
afterAll(() => prisma.$disconnect())

const book = (status, start) => makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date, start, status })
const hoursBefore = (b, h) => new Date(b.startAt.getTime() - h * 3_600_000)
const reload = (b) => prisma.booking.findUnique({ where: { id: b.id } })

describe('expiring bookings', () => {
  test('an unanswered request expires at the lesson time, not before', async () => {
    const b = await book('PENDING', '16:00')
    await expireStaleBookings(hoursBefore(b, 1))
    expect((await reload(b)).status).toBe('PENDING')
    await expireStaleBookings(b.startAt)
    const after = await reload(b)
    expect(after.status).toBe('CANCELLED')
    expect(after.cancelReason).toMatch(/did not respond/)
    const notes = await prisma.notification.findMany({ where: { type: 'BOOKING_EXPIRED', userId: { in: [parent.user.id, tutor.user.id] } } })
    expect(notes.map((n) => n.userId).sort()).toEqual([parent.user.id, tutor.user.id].sort())
  })

  test('an unanswered counter-offer expires too', async () => {
    const b = await book('COUNTER_OFFERED', '17:00')
    await expireStaleBookings(b.startAt)
    expect((await reload(b)).cancelReason).toMatch(/counter-offer/)
  })

  test('an unpaid booking is released 1 hour before the lesson, and its pending payment is marked failed', async () => {
    const b = await book('AWAITING_PAYMENT', '18:00')
    await prisma.payment.create({ data: { bookingId: b.id, amount: 50, status: 'PENDING', method: 'FPX', commissionRate: 10, commissionAmount: 5 } })
    await expireStaleBookings(hoursBefore(b, 2))
    expect((await reload(b)).status).toBe('AWAITING_PAYMENT')
    await expireStaleBookings(hoursBefore(b, 0.5))
    expect((await reload(b)).status).toBe('CANCELLED')
    expect((await prisma.payment.findUnique({ where: { bookingId: b.id } })).status).toBe('FAILED')
  })

  test('confirmed (paid) lessons are never touched', async () => {
    const b = await book('CONFIRMED', '19:00')
    await expireStaleBookings(new Date(b.startAt.getTime() + 3_600_000))
    expect((await reload(b)).status).toBe('CONFIRMED')
  })
})

describe('lesson reminders', () => {
  test('sent once to the parent and the tutor within 24 hours of a confirmed lesson', async () => {
    const b = await book('CONFIRMED', '20:00')
    const link = `/parent/bookings?booking=${b.id}`
    const count = () => prisma.notification.count({ where: { userId: parent.user.id, type: 'LESSON_REMINDER', link } })
    await sendLessonReminders(hoursBefore(b, 30))
    expect(await count()).toBe(0) // too early
    await sendLessonReminders(hoursBefore(b, 20))
    expect(await count()).toBe(1)
    await sendLessonReminders(hoursBefore(b, 10))
    expect(await count()).toBe(1) // not twice
    const parentNote = await prisma.notification.findFirst({ where: { userId: parent.user.id, type: 'LESSON_REMINDER', link } })
    expect(parentNote.message).toMatch(/Sarah's Mathematics lesson/)
    expect(await prisma.notification.count({ where: { userId: tutor.user.id, type: 'LESSON_REMINDER' } })).toBeGreaterThanOrEqual(1)
  })
})
