// Payments (sandbox), commission snapshot, refund requests and reviews.
import { prisma } from '../config/prisma.js'
import { MONDAY, api, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

let parent, other, monday

beforeAll(async () => {
  await resetDb()
  await startServer()
  parent = await makeParent()
  other = await makeParent()
  monday = nextDate(MONDAY)
})
afterAll(stopServer)

// Create an AWAITING_PAYMENT booking and start a sandbox checkout for it
async function checkout(tutor, { price = 60, start = '17:00' } = {}) {
  const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: monday, start, status: 'AWAITING_PAYMENT', price })
  const res = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })
  return { booking: b, checkout: res }
}

describe('checkout', () => {
  test('amount = agreed hourly price x lesson hours (decimal maths)', async () => {
    const t = await makeTutor()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start: '16:00', status: 'AWAITING_PAYMENT', price: 33.33 })
    // make it a 2 hour lesson
    await prisma.booking.update({ where: { id: b.id }, data: { endAt: new Date(b.startAt.getTime() + 2 * 3600000) } })
    const res = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })
    expect(res.status).toBe(201)
    expect(res.amount).toBe(66.66)
  })

  test('only a booking that is awaiting payment can be paid', async () => {
    const t = await makeTutor()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start: '16:00', status: 'PENDING' })
    expect((await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })).status).toBe(400)
  })

  test("another parent cannot pay for someone else's booking", async () => {
    const t = await makeTutor()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start: '16:00', status: 'AWAITING_PAYMENT' })
    expect((await api(other.token).post('/parent/payments/checkout', { bookingId: b.id })).status).toBe(404)
  })
})

describe('confirming a payment', () => {
  test('success: payment PAID, booking CONFIRMED, platform commission snapshotted', async () => {
    const t = await makeTutor()
    const { booking, checkout: c } = await checkout(t, { price: 60 })
    const res = await api(parent.token).post(`/parent/payments/${c.paymentId}/confirm`, { bank: 'Maybank2u', outcome: 'SUCCESS' })
    expect(res.status).toBe(200)

    const payment = await prisma.payment.findUnique({ where: { id: c.paymentId } })
    expect(payment.status).toBe('PAID')
    expect(Number(payment.commissionRate)).toBe(10) // BASE_COMMISSION_RATE
    expect(Number(payment.commissionAmount)).toBe(6)
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).status).toBe('CONFIRMED')
  })

  test('a per-tutor commission override beats the platform base rate', async () => {
    const t = await makeTutor({ commissionRate: 15 })
    const { checkout: c } = await checkout(t, { price: 40, start: '18:00' })
    await api(parent.token).post(`/parent/payments/${c.paymentId}/confirm`, { bank: 'CIMB Clicks', outcome: 'SUCCESS' })
    const payment = await prisma.payment.findUnique({ where: { id: c.paymentId } })
    expect(Number(payment.commissionRate)).toBe(15)
    expect(Number(payment.commissionAmount)).toBe(6)
  })

  test('changing the base rate later does not alter past payments', async () => {
    const before = await prisma.payment.findFirst({ where: { status: 'PAID' } })
    await prisma.systemSetting.update({ where: { key: 'BASE_COMMISSION_RATE' }, data: { value: '25' } })
    const after = await prisma.payment.findUnique({ where: { id: before.id } })
    expect(Number(after.commissionRate)).toBe(Number(before.commissionRate))
    await prisma.systemSetting.update({ where: { key: 'BASE_COMMISSION_RATE' }, data: { value: '10' } })
  })

  test('failure: booking stays AWAITING_PAYMENT and can be retried', async () => {
    const t = await makeTutor()
    const { booking, checkout: c } = await checkout(t, { start: '19:00' })
    const fail = await api(parent.token).post(`/parent/payments/${c.paymentId}/confirm`, { bank: 'RHB Now', outcome: 'FAILED' })
    expect(fail.status).toBe(200)
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).status).toBe('AWAITING_PAYMENT')

    const retry = await api(parent.token).post('/parent/payments/checkout', { bookingId: booking.id })
    expect(retry.status).toBe(201)
    expect(retry.paymentId).toBe(c.paymentId) // same Payment row is reused
    await api(parent.token).post(`/parent/payments/${retry.paymentId}/confirm`, { bank: 'RHB Now', outcome: 'SUCCESS' })
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).status).toBe('CONFIRMED')
  })

  test('a payment cannot be confirmed twice', async () => {
    const t = await makeTutor()
    const { checkout: c } = await checkout(t, { start: '17:00' })
    await api(parent.token).post(`/parent/payments/${c.paymentId}/confirm`, { bank: 'Maybank2u', outcome: 'SUCCESS' })
    const again = await api(parent.token).post(`/parent/payments/${c.paymentId}/confirm`, { bank: 'Maybank2u', outcome: 'SUCCESS' })
    expect(again.status).toBe(400)
  })

  test("another parent cannot confirm someone else's payment", async () => {
    const t = await makeTutor()
    const { checkout: c } = await checkout(t, { start: '18:00' })
    expect((await api(other.token).post(`/parent/payments/${c.paymentId}/confirm`, { bank: 'Maybank2u', outcome: 'SUCCESS' })).status).toBe(404)
  })
})

describe('cancelling and refunds', () => {
  async function paidBooking(status = 'CONFIRMED', start = '16:00') {
    const t = await makeTutor()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start, status, price: 80 })
    await prisma.payment.create({ data: { bookingId: b.id, amount: 80, commissionRate: 10, commissionAmount: 8, status: 'PAID', paidAt: new Date() } })
    return b
  }

  test('parent cancelling a PAID lesson creates an ADMIN_REVIEW refund (never automatic)', async () => {
    const b = await paidBooking()
    const res = await api(parent.token).post(`/parent/bookings/${b.id}/cancel`, { reason: 'Clash with school' })
    expect(res.booking.status).toBe('CANCELLED')
    const refund = await prisma.refund.findFirst({ where: { payment: { bookingId: b.id } } })
    expect(refund.type).toBe('ADMIN_REVIEW')
    expect(refund.status).toBe('PENDING')
  })

  test('refund request needs a real reason', async () => {
    const b = await paidBooking('COMPLETED', '17:00')
    expect((await api(parent.token).post(`/parent/bookings/${b.id}/refund-request`, { reason: 'no' })).status).toBe(400)
  })

  test('refund request: stored for Admin review with no fixed percentage', async () => {
    const b = await paidBooking('COMPLETED', '18:00')
    const res = await api(parent.token).post(`/parent/bookings/${b.id}/refund-request`, { reason: 'The tutor left the lesson early.' })
    expect(res.status).toBe(201)
    const refund = await prisma.refund.findFirst({ where: { payment: { bookingId: b.id } } })
    expect(refund.status).toBe('PENDING')
    expect(refund.type).toBe('ADMIN_REVIEW')
  })

  test('a second refund request while one is pending is refused', async () => {
    const b = await paidBooking('COMPLETED', '19:00')
    const body = { reason: 'The tutor left the lesson early.' }
    await api(parent.token).post(`/parent/bookings/${b.id}/refund-request`, body)
    expect((await api(parent.token).post(`/parent/bookings/${b.id}/refund-request`, body)).status).toBe(409)
  })

  test('unpaid bookings cannot be refunded', async () => {
    const t = await makeTutor()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start: '16:00', status: 'PENDING' })
    expect((await api(parent.token).post(`/parent/bookings/${b.id}/refund-request`, { reason: 'I want my money back' })).status).toBe(400)
  })

  test("another parent cannot request a refund on someone else's booking", async () => {
    const b = await paidBooking('COMPLETED', '20:00')
    expect((await api(other.token).post(`/parent/bookings/${b.id}/refund-request`, { reason: 'Not my lesson but trying' })).status).toBe(404)
  })
})

describe('reviews', () => {
  async function completed(start) {
    const t = await makeTutor()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start, status: 'COMPLETED' })
    return { b, t }
  }

  test('a completed lesson can be reviewed once, and the tutor average updates', async () => {
    const { b, t } = await completed('16:00')
    expect((await api(parent.token).post(`/parent/bookings/${b.id}/review`, { rating: 4, comment: 'Good' })).status).toBe(201)
    const tutor = await prisma.tutorProfile.findUnique({ where: { id: t.tutor.id } })
    expect(tutor.ratingAvg).toBe(4)
    expect(tutor.ratingCount).toBe(1)
    expect((await api(parent.token).post(`/parent/bookings/${b.id}/review`, { rating: 5 })).status).toBe(409)
  })

  test('only completed lessons can be reviewed', async () => {
    const t = await makeTutor()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start: '17:00', status: 'CONFIRMED' })
    expect((await api(parent.token).post(`/parent/bookings/${b.id}/review`, { rating: 5 })).status).toBe(400)
  })

  test('ratings must be between 1 and 5', async () => {
    const { b } = await completed('18:00')
    expect((await api(parent.token).post(`/parent/bookings/${b.id}/review`, { rating: 6 })).status).toBe(400)
    expect((await api(parent.token).post(`/parent/bookings/${b.id}/review`, { rating: 0 })).status).toBe(400)
  })

  test('only the parent who booked can review', async () => {
    const { b } = await completed('19:00')
    expect((await api(other.token).post(`/parent/bookings/${b.id}/review`, { rating: 5 })).status).toBe(404)
  })

  test('three low reviews push a tutor under the threshold and notify Admin', async () => {
    const admin = await prisma.user.create({ data: { email: `adm${Date.now()}@test.local`, role: 'ADMIN', fullName: 'Admin', isEmailVerified: true } })
    const t = await makeTutor()
    for (const start of ['16:00', '17:00', '18:00']) {
      const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start, status: 'COMPLETED' })
      await api(parent.token).post(`/parent/bookings/${b.id}/review`, { rating: 2 })
    }
    expect(await prisma.notification.count({ where: { userId: admin.id, type: 'TUTOR_FLAGGED' } })).toBeGreaterThan(0)
  })
})
