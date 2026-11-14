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

test.each(['APPROVED', 'ESCALATED'])('cancelling a paid lesson accounts for a previous %s refund and closes its schedule dispute', async status => {
  const b = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status: 'CONFIRMED' })
  const paid = await prisma.payment.create({ data: { bookingId: b.id, amount: 100, commissionAmount: 12, commissionRate: 12,
    paidAt: new Date(), status: status === 'APPROVED' ? 'PARTIALLY_REFUNDED' : 'PAID' } })
  await prisma.refund.create({ data: { paymentId: paid.id, amount: 20, type: 'ADMIN_REVIEW', reason: 'Adjustment', status,
    issuedAt: status === 'APPROVED' ? new Date() : null } })
  const dispute = await prisma.rescheduleRequest.create({ data: { bookingId: b.id, requestedById: tutor.user.id,
    newStartAt: b.startAt, newEndAt: b.endAt, status: 'ESCALATED' } })
  const issue = await prisma.complaint.create({ data: { bookingId: b.id, filedById: tutor.user.id,
    category: 'Booking cancellation', description: 'Please cancel the lesson' } })
  const decision = { kind: issue.category, action: 'cancel', caseId: issue.id, version: b.updatedAt.toISOString(), reason: 'Both parties agreed' }
  expect((await admin.post('/admin/bookings/' + b.id + '/decision', decision)).status).toBe(204)
  const reviews = await prisma.refund.findMany({ where: { paymentId: paid.id, status: { in: ['PENDING', 'ESCALATED'] } } })
  expect(reviews).toHaveLength(1)
  expect(Number(reviews[0].amount)).toBe(status === 'APPROVED' ? 80 : 20)
  expect((await prisma.rescheduleRequest.findUniqueOrThrow({ where: { id: dispute.id } })).status).toBe('REJECTED')
})

test.each([
  ['DISPUTED', 'reject', 'COMPLETED'],
  ['DISPUTED', 'approve', 'COMPLETED'],
  ['CANCELLED', 'reject', 'CANCELLED'],
  ['CANCELLED', 'approve', 'CANCELLED'],
])('%s lesson: admin can %s a refund and both parties see the decision', async (status, action, finalStatus) => {
  const lesson = await makeBooking({ tutor: tutor.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status })
  const paid = await prisma.payment.create({ data: { bookingId: lesson.id, amount: 50, commissionRate: 12, commissionAmount: 6, status: 'PAID', paidAt: new Date() } })
  const refund = await prisma.refund.create({ data: { paymentId: paid.id, type: 'ADMIN_REVIEW', amount: 50, reason: 'Parent requested a review' } })
  const path = '/admin/refunds/' + refund.id + '/decision'
  const reason = 'Review of lesson ' + lesson.id
  const decision = action === 'reject' ? { action, reason } : { action, reason, amount: 50, basis: 'Mutual agreement' }
  expect((await admin.post(path, decision)).status).toBe(204)
  expect((await admin.post(path, decision)).status).toBe(409)
  const recipients = await prisma.notification.findMany({ where: { type: 'REFUND_DECISION', message: { contains: reason } } })
  expect(recipients.map(n => n.userId).sort()).toEqual([parent.user.id, tutor.user.id].sort())
  const transfer = { action: 'issued', reference: 'demo-refund-' + refund.id }
  expect((await admin.post(path, transfer)).status).toBe(action === 'approve' ? 204 : 409)
  expect((await prisma.booking.findUniqueOrThrow({ where: { id: lesson.id } })).status).toBe(finalStatus)
  expect((await prisma.payment.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe(action === 'approve' ? 'REFUNDED' : 'PAID')
})
