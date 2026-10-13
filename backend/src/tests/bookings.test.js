// Booking rules: availability, conflicts (per CHILD), ownership, counter offers, cancellation.
import { prisma } from '../config/prisma.js'
import { MONDAY, WEDNESDAY, api, makeBooking, makeChild, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

let parentA, parentB, tutor, monday, wednesday

beforeAll(async () => {
  await resetDb()
  await startServer()
  parentA = await makeParent()
  parentB = await makeParent()
  tutor = await makeTutor()
  monday = nextDate(MONDAY)
  wednesday = nextDate(WEDNESDAY)
})
afterAll(stopServer)

const request = (over = {}) => ({
  tutorId: tutor.tutor.id, childId: parentA.child.id, date: monday, startTime: '17:00', teachingMode: 'ONLINE', proposedPrice: 45, ...over,
})

describe('creating a booking request', () => {
  test('a valid request is saved as PENDING with the proposed price', async () => {
    const res = await api(parentA.token).post('/parent/bookings', request())
    expect(res.status).toBe(201)
    expect(res.booking.status).toBe('PENDING')
    expect(res.booking.proposedPrice).toBe(45)
    expect(res.booking.hours).toBe(1)
  })

  test('the tutor is notified in-app', async () => {
    const n = await prisma.notification.findFirst({ where: { userId: tutor.user.id, type: 'BOOKING_REQUEST' } })
    expect(n).not.toBeNull()
  })

  test('a time outside the tutor availability is rejected', async () => {
    const res = await api(parentA.token).post('/parent/bookings', request({ date: wednesday, startTime: '09:00' }))
    expect(res.status).toBe(400)
    expect(res.message).toMatch(/not available/i)
  })

  test('a past time is rejected', async () => {
    const res = await api(parentA.token).post('/parent/bookings', request({ date: '2020-01-06' }))
    expect(res.status).toBe(400)
  })

  test('the same child cannot be booked twice at the same time', async () => {
    const res = await api(parentA.token).post('/parent/bookings', request({ proposedPrice: 40 }))
    expect(res.status).toBe(409)
    expect(res.message).toMatch(/already has a lesson/i)
  })

  test('a SIBLING may have an overlapping lesson (conflicts are per child, not per parent)', async () => {
    const sibling = await makeChild(parentA.parent.id)
    const res = await api(parentA.token).post('/parent/bookings', request({ childId: sibling.id }))
    expect(res.status).toBe(201)
  })

  test('a tutor who does not teach the child level is rejected', async () => {
    const tiny = await makeChild(parentA.parent.id, { grade: 2 }) // tutor teaches Primary 4-6
    const res = await api(parentA.token).post('/parent/bookings', request({ childId: tiny.id, date: wednesday }))
    expect(res.status).toBe(400)
    expect(res.message).toMatch(/does not teach/i)
  })

  test('physical lessons need a tutor who offers them', async () => {
    const onlineOnly = await makeTutor({ physical: false })
    const res = await api(parentA.token).post('/parent/bookings', request({ tutorId: onlineOnly.tutor.id, teachingMode: 'PHYSICAL', date: monday, startTime: '18:00' }))
    expect(res.status).toBe(400)
  })

  test('price must be positive', async () => {
    const res = await api(parentA.token).post('/parent/bookings', request({ proposedPrice: 0, startTime: '19:00' }))
    expect(res.status).toBe(400)
  })

  test("another parent's child cannot be used", async () => {
    const res = await api(parentB.token).post('/parent/bookings', request({ startTime: '19:00' }))
    expect(res.status).toBe(404)
  })

  test('a tutor account cannot use the parent API', async () => {
    const res = await api(tutor.token).post('/parent/bookings', request())
    expect(res.status).toBe(403)
  })

  test('requests without a login are refused', async () => {
    expect((await api().post('/parent/bookings', request())).status).toBe(401)
  })
})

describe('slots shown on the calendar', () => {
  test('a slot taken by a paid/awaiting-payment booking is unavailable, a merely pending one is not', async () => {
    const t = await makeTutor()
    await makeBooking({ parent: parentA.parent, child: parentA.child, tutor: t.tutor, date: monday, start: '16:00', status: 'AWAITING_PAYMENT' })
    await makeBooking({ parent: parentB.parent, child: parentB.child, tutor: t.tutor, date: monday, start: '17:00', status: 'PENDING' })
    const res = await api(parentA.token).get(`/parent/tutors/${t.tutor.id}/slots?from=${monday}`)
    const day = res.days.find((d) => d.date === monday)
    expect(day.slots.find((s) => s.start === '16:00').status).toBe('unavailable')
    expect(day.slots.find((s) => s.start === '17:00').status).toBe('available')
  })

  test('booking a slot that is already taken is refused (409)', async () => {
    const t = await makeTutor()
    await makeBooking({ parent: parentB.parent, child: parentB.child, tutor: t.tutor, date: monday, start: '18:00', status: 'CONFIRMED' })
    const res = await api(parentA.token).post('/parent/bookings', request({ tutorId: t.tutor.id, startTime: '18:00' }))
    expect(res.status).toBe(409)
  })
})

describe('ownership', () => {
  test("a parent cannot read or cancel another parent's booking", async () => {
    const b = await makeBooking({ parent: parentA.parent, child: parentA.child, tutor: tutor.tutor, date: wednesday, start: '16:00' })
    expect((await api(parentB.token).get(`/parent/bookings/${b.id}`)).status).toBe(404)
    expect((await api(parentB.token).post(`/parent/bookings/${b.id}/cancel`)).status).toBe(404)
    expect((await api(parentA.token).get(`/parent/bookings/${b.id}`)).status).toBe(200)
  })

  test('booking lists only contain the logged-in parent bookings', async () => {
    const res = await api(parentB.token).get('/parent/bookings')
    expect(res.bookings.every((x) => x.child.id === parentB.child.id)).toBe(true)
  })
})

describe('counter offers and cancelling', () => {
  test('accepting a counter offer moves to AWAITING_PAYMENT at the tutor price', async () => {
    const b = await makeBooking({ parent: parentA.parent, child: parentA.child, tutor: tutor.tutor, date: wednesday, start: '17:00', status: 'COUNTER_OFFERED', price: 45, extra: { counterPrice: 55 } })
    const res = await api(parentA.token).post(`/parent/bookings/${b.id}/accept-counter`)
    expect(res.status).toBe(200)
    expect(res.booking.status).toBe('AWAITING_PAYMENT')
    expect(res.booking.agreedPrice).toBe(55)
  })

  test('declining a counter offer cancels the request', async () => {
    const b = await makeBooking({ parent: parentA.parent, child: parentA.child, tutor: tutor.tutor, date: wednesday, start: '18:00', status: 'COUNTER_OFFERED', extra: { counterPrice: 70 } })
    const res = await api(parentA.token).post(`/parent/bookings/${b.id}/decline-counter`)
    expect(res.booking.status).toBe('CANCELLED')
  })

  test('there is nothing to accept when no counter offer exists', async () => {
    const b = await makeBooking({ parent: parentA.parent, child: parentA.child, tutor: tutor.tutor, date: wednesday, start: '19:00', status: 'PENDING' })
    expect((await api(parentA.token).post(`/parent/bookings/${b.id}/accept-counter`)).status).toBe(400)
  })

  test('cancelling a pending request frees the slot and creates no refund', async () => {
    const t = await makeTutor()
    const b = await makeBooking({ parent: parentA.parent, child: parentA.child, tutor: t.tutor, date: monday, start: '17:00' })
    const res = await api(parentA.token).post(`/parent/bookings/${b.id}/cancel`, { reason: 'Changed plans' })
    expect(res.booking.status).toBe('CANCELLED')
    expect(await prisma.refund.count()).toBe(0)
  })

  test('a finished lesson cannot be cancelled', async () => {
    const b = await makeBooking({ parent: parentA.parent, child: parentA.child, tutor: tutor.tutor, date: monday, start: '16:00', status: 'COMPLETED' })
    expect((await api(parentA.token).post(`/parent/bookings/${b.id}/cancel`)).status).toBe(400)
  })
})
