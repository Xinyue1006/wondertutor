// Follow records from the tutor delivery portal into the parent's existing
// booking, homework and progress pages, preserving legacy attendance semantics.
import { prisma } from '../config/prisma.js'
import { api, makeBooking, makeParent, makeTutor, MONDAY, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)
async function setup(extra = {}) {
  const p = await makeParent(), t = await makeTutor()
  const b = await makeBooking({ tutor: t.tutor, parent: p.parent, child: p.child, date: nextDate(MONDAY), status: 'CONFIRMED',
    extra: { startAt: new Date(Date.now() - 60_000), endAt: new Date(Date.now() + 60_000), ...extra } })
  return { p, t, b, tutor: api(t.token), parent: api(p.token), path: '/tutor/bookings/' + b.publicId + '/session' }
}

test('an owned UUID lesson can be completed online and its real attendance/homework reaches the parent', async () => {
  const { p, t, b, tutor, parent, path } = await setup()
  expect((await tutor.get(path)).publicId).toBe(b.publicId)
  expect((await tutor.get('/tutor/bookings/' + b.id + '/session')).id).toBe(b.id)
  expect((await api((await makeTutor()).token).get(path)).status).toBe(404)
  expect((await parent.get(path)).status).toBe(403)
  expect((await tutor.post(path, { action: 'check-in' })).status).toBe(200)
  await prisma.booking.update({ where: { id: b.id }, data: { endAt: new Date(Date.now() - 1) } })
  expect((await tutor.post(path, { action: 'check-out' })).status).toBe(200)
  const report = { action: 'report', content: 'Equivalent fractions', progressNote: 'Explains the method independently.',
    homework: 'Complete page 12, questions 1 to 5.', recommendations: 'Practise adding unlike denominators.' }
  const submitted = await tutor.post(path, report)
  expect(submitted.status).toBe(200)
  expect(submitted.report.homework).toBe(report.homework)
  const booking = (await parent.get('/parent/bookings/' + b.publicId)).booking
  expect(booking.status).toBe('COMPLETED')
  expect(booking.attendance.checkInAt).toBeTruthy()
  expect(booking.attendance.checkOutAt).toBeTruthy()
  expect(booking.summary).toMatchObject({ content: report.content, homework: report.homework, recommendations: report.recommendations })
  const progress = await parent.get('/parent/children/' + p.child.publicId + '/progress')
  expect(progress.stats).toMatchObject({ completedLessons: 1, physicalLessons: 0, attendanceTrackedLessons: 1, checkedInLessons: 1 })
  expect(progress.timeline[0].summary.homework).toBe(report.homework)
  const childReport = await parent.get('/parent/children/' + p.child.publicId + '/report')
  expect(childReport.totals).toMatchObject({ lessons: 1, physicalLessons: 0, attendanceTrackedLessons: 1, checkedIn: 1, homeworkSet: 1 })
  expect(childReport.lessons[0].attended).toBe(true)
  const other = api((await makeParent()).token)
  expect((await other.get('/parent/bookings/' + b.publicId)).status).toBe(404)
  expect((await other.get('/parent/children/' + p.child.publicId + '/progress')).status).toBe(404)
  expect(await prisma.notification.count({ where: { userId: p.user.id, type: 'LESSON_COMPLETED', link: '/parent/bookings?booking=' + b.publicId } })).toBe(1)
  expect((await tutor.post(path, report)).status).toBe(409)
})

test('legacy online records remain unknown while physical missing check-ins remain unrecorded', async () => {
  const { p, t, b, parent } = await setup({ status: 'COMPLETED' })
  const physical = await makeBooking({ tutor: t.tutor, parent: p.parent, child: p.child, date: nextDate(MONDAY), status: 'COMPLETED', extra: { teachingMode: 'PHYSICAL' } })
  const report = await parent.get('/parent/children/' + p.child.publicId + '/report')
  expect(report.totals).toMatchObject({ lessons: 2, physicalLessons: 1, attendanceTrackedLessons: 1, checkedIn: 0 })
  expect(report.lessons.find(l => l.bookingId === b.id).attended).toBeNull()
  expect(report.lessons.find(l => l.bookingId === physical.id).attended).toBe(false)
  const progress = await parent.get('/parent/children/' + p.child.publicId + '/progress')
  expect(progress.stats).toMatchObject({ attendanceTrackedLessons: 1, checkedInLessons: 0 })
})

test('an escalated refund remains an open financial hold and cannot be duplicated by the parent', async () => {
  const { b, parent, tutor } = await setup({ status: 'COMPLETED' })
  const payment = await prisma.payment.create({ data: { bookingId: b.id, status: 'PAID', paidAt: new Date(), amount: 50, commissionRate: 10, commissionAmount: 5 } })
  await prisma.refund.create({ data: { paymentId: payment.id, type: 'ADMIN_REVIEW', status: 'ESCALATED', amount: 50, reason: 'Awaiting a decision.' } })
  expect((await parent.post('/parent/bookings/' + b.publicId + '/refund-request', { reason: 'Please refund this lesson again.' })).status).toBe(409)
  expect(await prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1)
  expect(Number((await tutor.get('/tutor/earnings')).available)).toBe(0)
})
