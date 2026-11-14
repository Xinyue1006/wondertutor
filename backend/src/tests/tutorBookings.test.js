import { api, startServer, stopServer, resetDb, makeTutor, makeParent, makeBooking, nextDate, MONDAY } from './helpers.js'
import { prisma } from '../config/prisma.js'
import { expireStaleBookings } from '../services/lifecycle.service.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)
async function setup(extra = {}) {
  const t = await makeTutor(), p = await makeParent()
  const b = await makeBooking({ tutor: t.tutor, parent: p.parent, child: p.child, date: nextDate(MONDAY), extra })
  const actor = api(t.token), parent = api(p.token)
  const path = '/tutor/bookings/' + b.id
  const act = async (action, body = {}) => {
    const { updatedAt } = await prisma.booking.findUnique({ where: { id: b.id } })
    return actor.post(path, { action, version: updatedAt.toISOString(), ...body })
  }
  return { b, path, actor, parent, act, t }
}

test('parent and tutor negotiate, accept and share the online link after payment', async () => {
  const { b, actor, parent, act } = await setup()
  expect((await actor.get('/tutor/bookings')).bookings[0].parentName).toBeTruthy()
  expect((await act('counter', { price: 55 })).booking.status).toBe('COUNTER_OFFERED')
  expect((await parent.post('/parent/bookings/' + b.publicId + '/negotiate', { action: 'counter', price: 52 })).booking.status).toBe('PENDING')
  const accepted = (await act('accept')).booking
  expect(accepted.status).toBe('AWAITING_PAYMENT')
  expect(Number(accepted.agreedPrice)).toBe(52)
  expect(Date.parse(accepted.payBy)).toBeGreaterThan(Date.now())
  const url = 'https://meet.example.org/lesson'
  expect((await act('link', { url })).booking.meetingLink).toBe(url)
  const get = async () => (await parent.get('/parent/bookings/' + b.publicId)).booking
  expect((await get()).meetingLink).toBeNull()
  const checkout = await parent.post('/parent/payments/checkout', { bookingId: b.publicId })
  const result = await parent.post('/parent/payments/' + checkout.paymentId + '/confirm', { bank: checkout.banks[0], outcome: 'SUCCESS' })
  expect(result.status).toBe(200)
  expect((await get()).meetingLink).toBe(url)
  expect((await act('cancel', { reason: 'Illness' })).booking.status).toBe('CANCELLED')
  expect(await prisma.refund.count({ where: { paymentId: checkout.paymentId, type: 'AUTO' } })).toBe(1)
})

test('scopes actions to the owner, validates reasons and honours removed availability', async () => {
  const { b, path, act, t, parent } = await setup()
  const body = { action: 'accept', version: b.updatedAt.toISOString() }
  expect((await api((await makeTutor()).token).post(path, body)).status).toBe(404)
  expect((await parent.post(path, body)).status).toBe(403)
  expect((await act('decline', { reason: ' ' })).status).toBe(400)
  await prisma.availabilitySlot.deleteMany({ where: { tutorId: t.tutor.id } })
  expect((await act('accept')).message).toContain('no longer available')
  expect((await act('counter', { price: 55 })).status).toBe(409)
  expect((await act('decline', { reason: 'Schedule changed' })).booking.rejectionReason).toBe('Schedule changed')
})

test('a tutor can request a new time and send an unresolved parent time change to admin', async () => {
  const { b, act, parent } = await setup({ status: 'CONFIRMED' })
  const proposal = { date: nextDate(MONDAY), startTime: '18:00', reason: 'School timetable changed' }
  const asked = await act('reschedule', proposal)
  expect(asked.booking.reschedule.mine).toBe(true)
  expect((await act('withdraw-time', { requestId: asked.booking.reschedule.id })).booking.reschedule.status).toBe('REJECTED')
  const reply = await parent.post('/parent/bookings/' + b.publicId + '/reschedule', proposal)
  expect(reply.status).toBe(201)
  const declined = await act('decline-time', { requestId: reply.booking.reschedule.id })
  expect(declined.booking.reschedule.status).toBe('ESCALATED')
  expect(declined.booking.startAt).toBe(b.startAt.toISOString())
})

test('a fee dispute is visible in the admin complaints queue only once', async () => {
  const { b, act } = await setup()
  const reason = 'We cannot agree on the lesson rate.'
  expect((await act('escalate', { reason })).status).toBe(200)
  expect((await act('escalate', { reason })).status).toBe(409)
  expect(await prisma.complaint.count({ where: { bookingId: b.id, category: 'Fee negotiation', description: reason } })).toBe(1)
})

test('physical lessons reject links and elapsed payment holds expire before the lesson cutoff', async () => {
  const { b, act } = await setup({ teachingMode: 'PHYSICAL' })
  await act('accept')
  expect((await act('link', { url: 'https://example.org/class' })).status).toBe(409)
  const deadline = new Date(Date.now() + 60_000)
  await prisma.booking.update({ where: { id: b.id }, data: { payBy: deadline } })
  await expireStaleBookings(new Date(deadline.getTime() - 1))
  expect((await prisma.booking.findUnique({ where: { id: b.id } })).status).toBe('AWAITING_PAYMENT')
  await expireStaleBookings(deadline)
  expect((await prisma.booking.findUnique({ where: { id: b.id } })).status).toBe('CANCELLED')
})

test('legacy unpaid rows use the lesson cutoff and newer rows show the earlier deadline', async () => {
  const { b, actor } = await setup({ status: 'AWAITING_PAYMENT' })
  const deadline = async () => Date.parse((await actor.get('/tutor/bookings')).bookings[0].payBy)
  const cutoff = b.startAt.getTime() - 3600000
  expect(await deadline()).toBe(cutoff)
  for (const offset of [-3600000, 3600000]) {
    await prisma.booking.update({ where: { id: b.id }, data: { payBy: new Date(cutoff + offset) } })
    expect(await deadline()).toBe(Math.min(cutoff, cutoff + offset))
  }
})
