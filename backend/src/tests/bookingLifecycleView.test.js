import { prisma } from '../config/prisma.js'
import { api, makeBooking, makeParent, makeTutor, nextDate, MONDAY, resetDb, startServer, stopServer } from './helpers.js'

let p, t, ended, current, future
beforeAll(async () => {
  await resetDb()
  await startServer()
  p = await makeParent()
  t = await makeTutor()
  const now = Date.now()
  const book = (start, end, status = 'CONFIRMED') => makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: nextDate(MONDAY), status,
    extra: { startAt: new Date(now + start), endAt: new Date(now + end) } })
  ended = await book(-7200000, -3600000)
  current = await book(-1800000, 1800000)
  future = await book(3600000, 7200000)
  await book(-14400000, -10800000, 'COMPLETED')
  await book(10800000, 14400000, 'PENDING')
  await prisma.payment.create({ data: { bookingId: ended.id, amount: 50, commissionRate: 10, commissionAmount: 5, status: 'PAID' } })
  const other = await makeParent()
  await makeBooking({ parent: other.parent, child: other.child, tutor: t.tutor, date: nextDate(MONDAY), status: 'CONFIRMED' })
})
afterAll(stopServer)

test('dashboard upcoming excludes ended confirmed records and includes lessons still in progress', async () => {
  const response = await api(p.token).get('/parent/dashboard')
  expect(response.status).toBe(200)
  expect(response.counts).toEqual({ upcoming: 2, pending: 1, completed: 1, needsAttention: 1 })
  expect(response.upcoming.map(b => b.publicId)).toEqual([current.publicId, future.publicId])
})

test('booking list provides the server clock without inventing a completed, cancelled or refunded outcome', async () => {
  const before = Date.now()
  const response = await api(p.token).get('/parent/bookings')
  expect(response.status).toBe(200)
  expect(Date.parse(response.serverTime)).toBeGreaterThanOrEqual(before)
  expect(Date.parse(response.serverTime)).toBeLessThanOrEqual(Date.now())
  const past = response.bookings.find(b => b.publicId === ended.publicId)
  expect(past).toMatchObject({ status: 'CONFIRMED', payment: { status: 'PAID', refunds: [] }, attendance: null, summary: null })
  expect((await prisma.booking.findUnique({ where: { id: ended.id } })).status).toBe('CONFIRMED')
  expect(await prisma.refund.count()).toBe(0)
})
