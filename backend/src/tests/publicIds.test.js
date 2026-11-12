import { randomUUID } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { backfillPublicIds } from '../services/publicIds.service.js'
import { api, apiBase, makeAdmin, makeBooking, makeParent, makeTutor, MONDAY, nextDate, resetDb, startServer, stopServer } from './helpers.js'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
let parent, other, tutor, admin, completed, paid
const childBody = (child) => ({ name: child.name, educationLevel: child.educationLevel, grade: child.grade, subjects: ['Mathematics'] })
beforeAll(async () => {
  await resetDb(); await startServer()
  parent = await makeParent(); other = await makeParent(); tutor = await makeTutor(); admin = await makeAdmin()
  completed = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: '2026-01-05', status: 'COMPLETED' })
  paid = await prisma.payment.create({ data: { bookingId: completed.id, amount: 50, commissionRate: 10, commissionAmount: 5, status: 'PAID', paidAt: new Date() } })
})
afterAll(stopServer)

test('new records receive unique random public IDs while numeric keys and foreign keys remain intact', async () => {
  for (const record of [parent.child, other.child, completed, paid]) expect(record.publicId).toMatch(uuid)
  expect(new Set([parent.child.publicId, other.child.publicId, completed.publicId, paid.publicId]).size).toBe(4)
  expect(typeof completed.id).toBe('number')
  expect(completed.childId).toBe(parent.child.id)
  expect(paid.bookingId).toBe(completed.id)
  const list = await api(parent.token).get('/parent/children')
  expect(list.children.find(c => c.id === parent.child.id).publicId).toBe(parent.child.publicId)
})

test('child public links preserve ownership and permit ordinary edits, progress and reports', async () => {
  const path = '/parent/children/' + parent.child.publicId
  expect((await api(parent.token).put(path, childBody(parent.child))).status).toBe(200)
  for (const suffix of ['/progress', '/report']) {
    expect((await api(parent.token).get(path + suffix)).status).toBe(200)
    expect((await api(other.token).get(path + suffix)).status).toBe(404)
  }
  expect((await api(other.token).put(path, childBody(parent.child))).status).toBe(404)
  expect((await api(other.token).del(path)).status).toBe(404)
  expect((await api(parent.token).put('/parent/children/' + randomUUID(), childBody(parent.child))).status).toBe(404)
  expect((await api(parent.token).put('/parent/children/not-a-record', childBody(parent.child))).status).toBe(400)
  expect((await api(parent.token).put('/parent/children/' + parent.child.id, childBody(parent.child))).status).toBe(200)
})

test('booking creation accepts an owned child public ID but stores an integer child foreign key', async () => {
  const body = { tutorId: tutor.tutor.id, childId: parent.child.publicId, date: nextDate(MONDAY), startTime: '16:00', teachingMode: 'ONLINE', proposedPrice: 50 }
  expect((await api(other.token).post('/parent/bookings', body)).status).toBe(404)
  const created = await api(parent.token).post('/parent/bookings', body)
  expect(created.status).toBe(201)
  expect(created.booking.publicId).toMatch(uuid)
  const stored = await prisma.booking.findUnique({ where: { id: created.booking.id } })
  expect(stored.childId).toBe(parent.child.id)
  const path = '/parent/bookings/' + created.booking.publicId
  expect((await api(parent.token).get(path)).status).toBe(200)
  expect((await api(other.token).get(path)).status).toBe(404)
  expect((await api(other.token).post(path + '/cancel', { reason: 'Trying another family booking' })).status).toBe(404)
  expect((await api(parent.token).post(path + '/cancel', { reason: 'Public ID regression cancellation' })).status).toBe(200)
  expect((await prisma.booking.findUnique({ where: { id: stored.id } })).status).toBe('CANCELLED')
})

test('receipt public links require the correct parent, including legacy and malformed-ID checks', async () => {
  const path = '/parent/payments/' + paid.publicId + '/receipt'
  expect((await api(parent.token).get(path)).status).toBe(200)
  expect((await api(other.token).get(path)).status).toBe(404)
  expect((await api().get(path)).status).toBe(401)
  expect((await api(tutor.token).get(path)).status).toBe(403)
  expect((await api(parent.token).get('/parent/payments/' + paid.id + '/receipt')).status).toBe(200)
  expect((await api(other.token).get('/parent/payments/' + paid.id + '/receipt')).status).toBe(404)
  expect((await api(parent.token).get('/parent/payments/not-a-record/receipt')).status).toBe(400)
})

test('public booking calendar links remain authorized and return a calendar file', async () => {
  const confirmed = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: nextDate(MONDAY), start: '18:00', status: 'CONFIRMED' })
  const url = apiBase() + '/parent/bookings/' + confirmed.publicId + '/calendar.ics'
  const owner = await fetch(url, { headers: { Authorization: 'Bearer ' + parent.token } })
  expect(owner.status).toBe(200)
  expect(owner.headers.get('content-type')).toContain('text/calendar')
  expect((await fetch(url, { headers: { Authorization: 'Bearer ' + other.token } })).status).toBe(404)
})

test('checkout and payment confirmation accept public references without weakening ownership', async () => {
  const booking = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: nextDate(MONDAY), start: '19:00', status: 'AWAITING_PAYMENT' })
  expect((await api(other.token).post('/parent/payments/checkout', { bookingId: booking.publicId })).status).toBe(404)
  const checkout = await api(parent.token).post('/parent/payments/checkout', { bookingId: booking.publicId })
  expect(checkout.status).toBe(201)
  expect(checkout.paymentPublicId).toMatch(uuid)
  const path = '/parent/payments/' + checkout.paymentPublicId + '/confirm'
  const body = { bank: 'Maybank2u', outcome: 'SUCCESS' }
  expect((await api(other.token).post(path, body)).status).toBe(404)
  expect((await api(parent.token).post(path, body)).status).toBe(200)
  expect((await prisma.payment.findUnique({ where: { id: checkout.paymentId } })).bookingId).toBe(booking.id)
  expect((await prisma.booking.findUnique({ where: { id: booking.id } })).status).toBe('CONFIRMED')
})

test('complaints accept owned booking references and admin public links retain role protection', async () => {
  const body = { bookingId: completed.publicId, category: 'Lesson quality', description: 'The lesson needs investigation for this public ID regression.' }
  expect((await api(other.token).post('/parent/complaints', body)).status).toBe(404)
  const created = await api(parent.token).post('/parent/complaints', body)
  expect(created.status).toBe(201)
  expect(created.complaint.publicId).toMatch(uuid)
  expect((await prisma.complaint.findUnique({ where: { id: created.complaint.id } })).bookingId).toBe(completed.id)
  const path = '/admin/complaints/' + created.complaint.publicId
  expect((await api(parent.token).get(path)).status).toBe(403)
  expect((await api(admin.token).get(path)).status).toBe(200)
  expect((await api(admin.token).patch(path, { status: 'IN_PROGRESS', adminResponse: 'We are investigating the lesson.' })).status).toBe(200)
  const list = await api(parent.token).get('/parent/complaints')
  expect(list.complaints.find(c => c.id === created.complaint.id).publicId).toBe(created.complaint.publicId)
})

test('existing records are backfilled safely and keep stable references across repeated concurrent runs', async () => {
  const child = await prisma.child.create({ data: { parentId: parent.parent.id, name: 'Legacy child', educationLevel: 'PRIMARY', grade: 5, publicId: null } })
  const booking = await makeBooking({ parent: parent.parent, child, tutor: tutor.tutor, date: '2025-01-06', status: 'COMPLETED', extra: { publicId: null } })
  const payment = await prisma.payment.create({ data: { bookingId: booking.id, amount: 50, commissionRate: 10, commissionAmount: 5, publicId: null } })
  const complaint = await prisma.complaint.create({ data: { filedById: parent.user.id, bookingId: booking.id, category: 'Lesson quality', description: 'Legacy complaint preserved during deployment.', publicId: null } })
  const records = { child, booking, payment, complaint }
  await Promise.all([backfillPublicIds(), backfillPublicIds()])
  const references = []
  for (const [model, before] of Object.entries(records)) {
    const after = await prisma[model].findUnique({ where: { id: before.id } })
    expect(after.publicId).toMatch(uuid)
    expect(after).toEqual({ ...before, publicId: after.publicId })
    references.push(after.publicId)
  }
  expect(new Set(references).size).toBe(4)
  expect(await backfillPublicIds()).toEqual({ child: 0, booking: 0, payment: 0, complaint: 0 })
  for (const [index, [model, before]] of Object.entries(records).entries()) {
    expect((await prisma[model].findUnique({ where: { id: before.id } })).publicId).toBe(references[index])
  }
})
