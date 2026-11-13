import { prisma } from '../config/prisma.js'
import { api, startServer, stopServer, resetDb, makeParent, makeTutor, makeAdmin, makeBooking, MONDAY, nextDate } from './helpers.js'

let admin, tutor, parent, booking, payment
beforeAll(async () => {
  await resetDb()
  await startServer()
  admin = api((await makeAdmin()).token)
  tutor = await makeTutor({ commissionRate: 12 })
  parent = await makeParent()
  booking = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status: 'COMPLETED' })
  payment = await prisma.payment.create({ data: { bookingId: booking.id, amount: 100, commissionAmount: 12, commissionRate: 12, paidAt: new Date(), status: 'PAID' } })
})
afterAll(stopServer)

test('a final fee decision updates the booking, closes the case and cannot be applied twice', async () => {
  const b = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), start: '18:00' })
  const issue = await prisma.complaint.create({ data: { bookingId: b.id, filedById: tutor.user.id, category: 'Fee negotiation', description: 'Please settle the fee' } })
  const decision = { kind: issue.category, action: 'set-fee', caseId: issue.id, version: b.updatedAt.toISOString(), price: 55, reason: 'Agreed final rate' }
  const path = '/admin/bookings/' + b.id + '/decision'
  expect((await admin.post(path, decision)).status).toBe(204)
  expect((await admin.post(path, decision)).status).toBe(409)
  const saved = await prisma.booking.findUniqueOrThrow({ where: { id: b.id } })
  expect(saved.status).toBe('AWAITING_PAYMENT')
  expect(Number(saved.agreedPrice)).toBe(55)
  expect(saved.payBy).toBeInstanceOf(Date)
  expect((await prisma.complaint.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe('RESOLVED')
})

test('only admins can override rates and the saved payment keeps its commission', async () => {
  const path = '/admin/rates/' + tutor.tutor.id
  const update = { kind: 'COMMISSION', previous: 12, rate: 14, reason: 'Quarterly review' }
  expect((await api(tutor.token).patch(path,update)).status).toBe(403)
  expect((await admin.patch(path,update)).status).toBe(204)
  expect((await admin.patch(path,update)).status).toBe(409)
  const rates = await admin.get('/admin/rates')
  expect(rates.tutors.find(t => t.id === tutor.tutor.id).history[0].reason).toBe(update.reason)
  expect(Number((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).commissionRate)).toBe(12)
})

test('approving and issuing a partial refund are distinct and cannot be repeated', async () => {
  const refund = await prisma.refund.create({ data: { paymentId: payment.id, type: 'ADMIN_REVIEW', amount: 100, reason: 'Lesson adjustment' } })
  const path = '/admin/refunds/' + refund.id + '/decision'
  expect((await admin.post(path,{ action: 'approve', amount: 33.33, reason: 'Both parties agreed', basis: 'Mutual agreement' })).status).toBe(204)
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PAID')
  const issued = { action: 'issued', reference: 'test-refund-100' }
  expect((await admin.post(path,issued)).status).toBe(204)
  expect((await admin.post(path,issued)).status).toBe(409)
  const report = await admin.get('/admin/reports')
  expect(Number(report.netCollected)).toBe(66.67)
  expect(Number(report.commission)).toBe(8)
  const salary = await admin.get('/admin/salary/' + tutor.tutor.id)
  expect(Number(salary.net)).toBe(58.67)
  expect((await admin.get('/admin/bookings')).rows.some(b => b.id === booking.id)).toBe(true)
})
