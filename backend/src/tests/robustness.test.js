// Things that go wrong in real use: double clicks, two tabs, the expiry scheduler acting at the same moment,
// and actions on a booking that has already moved on. Each must leave exactly one correct result behind.
import { prisma } from '../config/prisma.js'
import { MONDAY, api, makeAdmin, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

let parent, monday

beforeAll(async () => {
  await resetDb()
  await startServer()
  parent = await makeParent()
  monday = nextDate(MONDAY)
})
afterAll(stopServer)

const awaitingPayment = async (tutor, start = '17:00') =>
  makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: monday, start, status: 'AWAITING_PAYMENT', price: 60 })

describe('payments', () => {
  test('cancelling a booking closes its unfinished checkout, and that checkout can no longer confirm it', async () => {
    const t = await makeTutor()
    const b = await awaitingPayment(t)
    const c = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })
    expect((await api(parent.token).post(`/parent/bookings/${b.id}/cancel`, {})).status).toBe(200)

    expect((await prisma.payment.findUnique({ where: { id: c.paymentId } })).status).toBe('FAILED')
    const res = await api(parent.token).post(`/parent/payments/${c.paymentId}/confirm`, { bank: 'Maybank2u', outcome: 'SUCCESS' })
    expect(res.status).toBe(400)
    expect((await prisma.booking.findUnique({ where: { id: b.id } })).status).toBe('CANCELLED')
  })

  test('a booking released by the scheduler cannot be brought back by paying', async () => {
    const t = await makeTutor()
    const b = await awaitingPayment(t)
    const c = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })
    // the scheduler expired the booking but the payment row was somehow left pending
    await prisma.booking.update({ where: { id: b.id }, data: { status: 'CANCELLED' } })
    const res = await api(parent.token).post(`/parent/payments/${c.paymentId}/confirm`, { bank: 'Maybank2u', outcome: 'SUCCESS' })
    expect(res.status).toBe(400)
    expect(res.message).toContain('no longer waiting for payment')
    expect((await prisma.payment.findUnique({ where: { id: c.paymentId } })).status).toBe('PENDING')
  })

  test('two confirm clicks at the same moment confirm once and send one notification', async () => {
    const t = await makeTutor()
    const b = await awaitingPayment(t)
    const c = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })
    const body = { bank: 'Maybank2u', outcome: 'SUCCESS' }
    const results = await Promise.all([1, 2].map(() => api(parent.token).post(`/parent/payments/${c.paymentId}/confirm`, body)))
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    expect(await prisma.notification.count({ where: { userId: t.user.id, type: 'BOOKING_CONFIRMED' } })).toBe(1)
  })

  test('checkout closes 1 hour before the lesson (the same deadline the scheduler uses)', async () => {
    const t = await makeTutor()
    const soon = new Date(Date.now() + 30 * 60_000)
    const b = await prisma.booking.create({
      data: {
        parentId: parent.parent.id, childId: parent.child.id, tutorId: t.tutor.id, subject: 'Mathematics', teachingMode: 'ONLINE',
        startAt: soon, endAt: new Date(soon.getTime() + 3600000), proposedPrice: 60, agreedPrice: 60, status: 'AWAITING_PAYMENT',
      },
    })
    const res = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })
    expect(res.status).toBe(400)
    expect(res.message).toContain('Payment closes')
  })
})

describe('refund requests and cancelling', () => {
  async function paidLesson(t, start) {
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start, status: 'CONFIRMED', price: 60 })
    await prisma.payment.create({ data: { bookingId: b.id, amount: 60, commissionRate: 10, commissionAmount: 6, status: 'PAID', paidAt: new Date() } })
    return b
  }

  test('two refund requests sent together create only one', async () => {
    const t = await makeTutor()
    const b = await paidLesson(t, '16:00')
    const body = { reason: 'The tutor did not come to the lesson.' }
    const results = await Promise.all([1, 2].map(() => api(parent.token).post(`/parent/bookings/${b.id}/refund-request`, body)))
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(1)
    expect(await prisma.refund.count({ where: { payment: { bookingId: b.id } } })).toBe(1)
  })

  test('cancelling after already asking for a refund does not create a second refund', async () => {
    const t = await makeTutor()
    const b = await paidLesson(t, '18:00')
    await api(parent.token).post(`/parent/bookings/${b.id}/refund-request`, { reason: 'Our plans changed for that week.' })
    expect((await api(parent.token).post(`/parent/bookings/${b.id}/cancel`, {})).status).toBe(200)
    expect(await prisma.refund.count({ where: { payment: { bookingId: b.id } } })).toBe(1)
  })

  test('a booking that changed in the meantime is not changed again (stale page)', async () => {
    const t = await makeTutor()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start: '19:00', status: 'COUNTER_OFFERED', extra: { counterPrice: 70 } })
    const [first, second] = await Promise.all([
      api(parent.token).post(`/parent/bookings/${b.id}/accept-counter`),
      api(parent.token).post(`/parent/bookings/${b.id}/decline-counter`),
    ])
    // exactly one of the two answers wins; the other is told to refresh
    expect([first.status, second.status].filter((s) => s === 200)).toHaveLength(1)
    expect([first.status, second.status].some((s) => s === 409 || s === 400)).toBe(true)
  })
})

describe('reviews', () => {
  async function completed(t, start) {
    return makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: '2026-01-05', start, status: 'COMPLETED' })
  }

  test('two review submits for the same lesson save one review and explain the other', async () => {
    const t = await makeTutor()
    const b = await completed(t, '16:00')
    const results = await Promise.all([1, 2].map(() => api(parent.token).post(`/parent/bookings/${b.id}/review`, { rating: 5 })))
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect(results.find((r) => r.status !== 201).message).toBe('You have already reviewed this lesson')
    expect(await prisma.review.count({ where: { bookingId: b.id } })).toBe(1)
  })

  test('Admin is alerted once when a tutor drops below the rating threshold, not for every later low review', async () => {
    const admin = await makeAdmin()
    const t = await makeTutor()
    for (const start of ['10:00', '11:00', '12:00', '13:00']) {
      const b = await completed(t, start)
      expect((await api(parent.token).post(`/parent/bookings/${b.id}/review`, { rating: 1 })).status).toBe(201)
    }
    const alerts = await prisma.notification.count({ where: { userId: admin.user.id, type: 'TUTOR_FLAGGED', message: { contains: 'Test Tutor' } } })
    expect(alerts).toBe(1)
  })
})

describe('tutor profile', () => {
  test('parents never see a rejected qualification', async () => {
    const t = await makeTutor()
    await prisma.qualification.createMany({
      data: [
        { tutorId: t.tutor.id, title: 'Fake Diploma', institution: 'Nowhere', year: 2020, documentUrl: 'https://example.com/a.pdf', status: 'REJECTED' },
        { tutorId: t.tutor.id, title: 'Teaching Certificate', institution: 'IPG', year: 2021, documentUrl: 'https://example.com/b.pdf', status: 'PENDING' },
      ],
    })
    const res = await api(parent.token).get(`/parent/tutors/${t.tutor.id}`)
    expect(res.tutor.qualifications.map((q) => q.title)).toEqual(['Teaching Certificate'])
  })

  test('saving a deactivated tutor is refused', async () => {
    const t = await makeTutor()
    await prisma.user.update({ where: { id: t.user.id }, data: { status: 'DEACTIVATED' } })
    expect((await api(parent.token).post(`/parent/favourites/${t.tutor.id}`)).status).toBe(404)
  })
})
