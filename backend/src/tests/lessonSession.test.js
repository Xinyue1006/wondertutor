import { v2 as cloudinary } from 'cloudinary'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import { api, makeAdmin, makeBooking, makeParent, makeTutor, nextDate, MONDAY, resetDb, startServer, stopServer } from './helpers.js'

let p, t, admin
const previous = { ...env.cloudinary }
beforeAll(async () => {
  await resetDb()
  await startServer()
  p = await makeParent()
  t = await makeTutor()
  admin = await makeAdmin()
  Object.assign(env.cloudinary, { cloudName: 'session-test', apiKey: 'test-key', apiSecret: 'test-secret' })
})
afterAll(async () => { Object.assign(env.cloudinary, previous); await stopServer() })

async function lesson(extra = {}) {
  const b = await makeBooking({ tutor: t.tutor, child: p.child, parent: p.parent, date: nextDate(MONDAY), status: 'CONFIRMED',
    extra: { startAt: new Date(Date.now() - 60000), endAt: new Date(Date.now() + 60000), ...extra } })
  const path = '/tutor/bookings/' + b.id + '/session'
  return { b, path, send: fields => api(t.token).post(path, fields) }
}
function proof(id) {
  const public_id = 'wondertutor/attendance/' + id + '/lesson'
  const version = 1700000000
  return { version, url: 'https://res.cloudinary.com/session-test/image/authenticated/v' + version + '/' + public_id + '.jpg',
    signature: cloudinary.utils.api_sign_request({ public_id, version }, env.cloudinary.apiSecret) }
}

test('physical check-in rechecks the saved radius, photo receipt, and lesson ownership', async () => {
  const { b, path, send } = await lesson({ teachingMode: 'PHYSICAL', location: '12 Jalan Test, Kuala Lumpur', latitude: 3, longitude: 101, locationConfirmedAt: new Date() })
  const coords = { lat: 3.001, lng: 101 }
  const payload = { action: 'check-in', coords, photo: proof(b.id) }
  expect((await api(p.token).get(path)).status).toBe(403)
  expect((await api((await makeTutor()).token).post(path, payload)).status).toBe(404)
  expect((await send(payload)).message).toContain('100 metres')
  await api(admin.token).patch('/admin/settings', { key: 'GPS_RADIUS_METRES', value: 150 })
  expect((await send({ ...payload, photo: proof(b.id + 1) })).status).toBe(400)
  expect((await send({ ...payload, photo: { ...payload.photo, signature: '0'.repeat(40) } })).status).toBe(400)
  expect((await send({ ...payload, distance: 0 })).status).toBe(400)
  const view = await send(payload)
  expect(view.attendance.distance).toBeCloseTo(111.19, 1)
  expect(view.attendance.photo).toContain('signature=')
  expect((await send(payload)).status).toBe(409)
  expect((await send({ action: 'check-out' })).status).toBe(409)
})

test('online attendance needs no location and completing the report publishes it to the parent once', async () => {
  const { b, send } = await lesson()
  const report = { action: 'report', content: 'Fractions', progressNote: 'Adds mixed fractions independently.', recommendations: 'Practise division.' }
  expect((await send(report)).status).toBe(409)
  expect((await send({ action: 'check-in' })).attendance.distance).toBeNull()
  expect((await send(report)).status).toBe(409)
  await prisma.booking.update({ where: { id: b.id }, data: { endAt: new Date(Date.now() - 1) } })
  expect((await send({ action: 'check-out' })).attendance.checkOutAt).toBeTruthy()
  expect((await send({ ...report, progressNote: '  ' })).status).toBe(400)
  const results = await Promise.all([send(report), send(report)])
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  const parentView = await api(p.token).get('/parent/bookings/' + b.publicId)
  expect(parentView.booking).toMatchObject({ status: 'COMPLETED', summary: { content: report.content, progressNote: report.progressNote } })
  expect(await prisma.notification.count({ where: { userId: p.user.id, type: 'LESSON_COMPLETED', link: '/parent/bookings?booking=' + b.publicId } })).toBe(1)
})

test('Iris can follow Alya from the dashboard through attendance and the report to earned income', async () => {
  const iris = await makeTutor({ commissionRate: 19 })
  await prisma.user.update({ where: { id: iris.user.id }, data: { fullName: 'Iris' } })
  const alya = await makeParent({ child: { name: 'Alya' } })
  const client = api(iris.token)
  const booking = await makeBooking({ tutor: iris.tutor, parent: alya.parent, child: alya.child,
    date: nextDate(MONDAY), status: 'CONFIRMED', extra: { teachingMode: 'ONLINE', meetingLink: 'https://example.org/class' } })
  await prisma.payment.create({ data: { bookingId: booking.id, amount: 100, commissionRate: 12, commissionAmount: 12, status: 'PAID', paidAt: new Date() } })
  const { nextLesson } = await client.get('/tutor/dashboard')
  expect(nextLesson).toMatchObject({ student: 'Alya', action: 'Open session' })
  const path = nextLesson.to
  expect(Number((await client.get('/tutor/earnings')).pending)).toBe(88)
  await prisma.booking.update({ where: { id: booking.id }, data: { startAt: new Date(Date.now() - 60000), endAt: new Date(Date.now() + 60000) } })
  expect((await client.post(path, { action: 'check-in' })).status).toBe(200)
  await prisma.booking.update({ where: { id: booking.id }, data: { endAt: new Date(Date.now() - 1) } })
  expect((await client.post(path, { action: 'check-out' })).status).toBe(200)
  const notes = { progressNote: 'Recognises equivalent fractions.', homework: 'Complete five fraction exercises.' }
  expect((await client.post(path, { action: 'report', content: 'Equivalent fractions', ...notes })).status).toBe(200)
  expect((await client.get('/tutor/bookings')).bookings[0]).toMatchObject({ child: { name: 'Alya' }, report: notes, status: 'COMPLETED' })
  const ledger = await client.get('/tutor/earnings')
  expect(Number(ledger.available)).toBe(88)
  expect(Number(ledger.pending)).toBe(0)
  expect('/tutor/bookings/' + ledger.transactions[0].bookingRef + '/session').toBe(path)
})

test('missing coordinates, unconfirmed bookings and future lessons cannot check in', async () => {
  const physical = await lesson({ teachingMode: 'PHYSICAL' })
  expect((await physical.send({ action: 'check-in', coords: { lat: 0, lng: 0 }, photo: proof(physical.b.id) })).status).toBe(409)
  const unpaid = await lesson({ status: 'AWAITING_PAYMENT' })
  expect((await unpaid.send({ action: 'check-in' })).status).toBe(409)
  const future = await lesson({ startAt: new Date(Date.now() + 30000) })
  expect((await future.send({ action: 'check-in' })).status).toBe(409)
})

test('a missed check-in reaches admin and both sides receive the review outcome', async () => {
  const { b, path, send } = await lesson()
  const input = { action: 'request-review', reason: 'My phone lost power during the lesson.' }
  expect((await send(input)).status).toBe(409)
  await prisma.booking.update({ where: { id: b.id }, data: { endAt: new Date(Date.now() - 1) } })
  expect((await send({ ...input, reason: '  ' })).status).toBe(400)
  expect((await api(p.token).post(path, input)).status).toBe(403)
  expect((await api((await makeTutor()).token).post(path, input)).status).toBe(404)
  const responses = await Promise.all([send(input), send(input)])
  expect(responses.map(r => r.status).sort()).toEqual([200, 409])
  const inbox = async token => (await api(token).get('/notifications')).notifications
  expect(await inbox(p.token)).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Missed check-in review', link: '/parent/bookings?booking=' + b.publicId })]))
  const complaints = (await api(admin.token).get('/admin/complaints?status=OPEN')).complaints
  const review = complaints.find(c => c.booking?.id === b.id)
  expect(review).toMatchObject({ category: 'Missed check-in', description: input.reason, status: 'OPEN' })
  const decision = { status: 'RESOLVED', adminResponse: 'Reviewed with both parties.' }
  const adminPath = '/admin/complaints/' + review.id
  const report = { action: 'report', content: 'Fractions', progressNote: 'Can simplify fractions.' }
  expect((await send(report)).status).toBe(409)
  expect((await send({ action: 'attach-proof', photo: proof(b.id + 1) })).status).toBe(400)
  expect((await send({ action: 'attach-proof', photo: proof(b.id) })).review.evidenceUrl).toContain('signature=')
  const before = (await api(admin.token).get(adminPath)).investigation.attendanceReview
  expect(before.proof).toContain('signature=')
  expect((await api(admin.token).patch(adminPath, { ...decision, reviewedAt: before.reviewedAt })).status).toBe(409)
  const responsePath = '/parent/bookings/' + b.publicId + '/attendance-response'
  const reply = { answer: 'YES', note: 'We completed the lesson.' }
  expect((await api((await makeParent()).token).post(responsePath, reply)).status).toBe(404)
  expect((await api(p.token).post(responsePath, reply)).booking.attendanceReview.parentAnswer).toBe('YES')
  expect((await api(p.token).post(responsePath, reply)).status).toBe(409)
  const evidence = (await api(admin.token).get(adminPath)).investigation.attendanceReview
  expect(evidence).toMatchObject({ parentAnswer: 'YES', parentNote: reply.note })
  expect((await api(admin.token).patch(adminPath, { ...decision, reviewedAt: before.reviewedAt })).status).toBe(409)
  expect((await api(admin.token).patch(adminPath, { ...decision, reviewedAt: evidence.reviewedAt })).status).toBe(200)
  expect(await api(t.token).get(path)).toMatchObject({ review: decision, attendance: null, report: null })
  for (const token of [p.token, t.token]) {
    expect(await inbox(token)).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringContaining(decision.adminResponse) })]))
  }
  expect((await send(input)).status).toBe(409)
  expect((await send(report)).report.content).toBe('Fractions')
  expect((await send(report)).status).toBe(409)
  expect((await api(p.token).get('/parent/bookings/' + b.id)).booking).toMatchObject({ status: 'COMPLETED', attendance: null, attendanceReview: { attendanceApproved: true } })
})

test.each(['NO', 'UNSURE'])('admin can decline after parent replies %s and report stays locked', async answer => {
  const { b, send } = await lesson({ endAt: new Date(Date.now() - 1) })
  await send({ action: 'request-review', reason: 'Lost connection', photo: proof(b.id) })
  await api(p.token).post('/parent/bookings/' + b.id + '/attendance-response', { answer })
  const review = (await api(admin.token).get('/admin/complaints')).complaints.find(c => c.booking?.id === b.id)
  const adminPath = '/admin/complaints/' + review.id
  const { reviewedAt, parentAnswer, proof: url } = (await api(admin.token).get(adminPath)).investigation.attendanceReview
  expect(parentAnswer).toBe(answer)
  expect(url).toContain('signature=')
  expect((await api(admin.token).patch(adminPath, { status: 'DISMISSED', adminResponse: 'Insufficient evidence.', reviewedAt })).status).toBe(200)
  expect((await send({ action: 'report', content: 'Maths', progressNote: 'Progress' })).status).toBe(409)
})

test('both parties answer a question and a tutor can reopen the same decision with new evidence', async () => {
  const { b, send, path } = await lesson({ endAt: new Date(Date.now() - 1) })
  await send({ action: 'request-review', reason: 'My device failed.' })
  const parentPath = '/parent/bookings/' + b.publicId
  const reply = answer => api(p.token).post(parentPath + '/attendance-response', { answer, note: 'I checked the date.' })
  await reply('UNSURE')
  const review = (await api(admin.token).get('/admin/complaints')).complaints.find(c => c.booking?.id === b.id)
  const adminPath = '/admin/complaints/' + review.id
  const read = async () => (await api(admin.token).get(adminPath)).investigation.attendanceReview
  const decide = async (status, outcome, adminResponse) => api(admin.token).patch(adminPath, { status, outcome, adminResponse, reviewedAt: (await read()).reviewedAt })
  expect((await decide('IN_PROGRESS', 'MORE_INFO', 'Which activity did you complete?')).status).toBe(200)
  expect((await api(p.token).get(parentPath)).booking.attendanceReview).toMatchObject({ parentAnswer: null, attendanceOutcome: 'MORE_INFO' })
  expect((await api(t.token).get(path)).review.tutorReplyPending).toBe(true)
  await reply('NO')
  expect((await decide('DISMISSED', 'NOT_HELD', 'Parent reports no lesson.')).status).toBe(409)
  expect((await send({ action: 'review-reply', reason: 'We practised fractions.' })).status).toBe(200)
  expect((await decide('DISMISSED', 'UNVERIFIED', 'Conflicting accounts.')).status).toBe(200)
  expect((await api(p.token).get(parentPath)).booking.attendanceReview.attendanceOutcome).toBe('UNVERIFIED')
  expect((await send({ action: 'reconsider', reason: 'My device failed.' })).status).toBe(400)
  const appeal = { action: 'reconsider', reason: 'Recovered the dated attendance record.', photo: proof(b.id) }
  expect((await send(appeal)).status).toBe(200)
  expect((await send(appeal)).status).toBe(409)
  expect((await send({ action: 'report', content: 'Fractions', progressNote: 'Practised.' })).status).toBe(409)
  const evidence = await read()
  expect(evidence.history.map(entry => entry.action)).toEqual(expect.arrayContaining(['MORE_INFO', 'TUTOR_REPLY', 'UNVERIFIED', 'RECONSIDERATION']))
  expect(evidence.history.at(-1).evidenceUrl).toContain('signature=')
  expect((await decide('DISMISSED', 'NOT_HELD', 'Record and parent confirm a different lesson date.')).status).toBe(200)
  expect((await api(t.token).get(path)).review.attendanceOutcome).toBe('NOT_HELD')
  expect((await api(p.token).get(parentPath)).booking.attendanceReview.attendanceOutcome).toBe('NOT_HELD')
})

test.each(['admin first', 'parent first', 'simultaneous'])('one finance review for a paid lesson not held: %s', async order => {
  const { b, path, send } = await lesson({ endAt: new Date(Date.now() - 1) })
  await prisma.payment.create({ data: { bookingId: b.id, amount: 80, commissionRate: 10, commissionAmount: 8, status: 'PAID', paidAt: new Date() } })
  await send({ action: 'request-review', reason: 'Check the attendance record.' })
  const parentPath = '/parent/bookings/' + b.publicId
  await api(p.token).post(parentPath + '/attendance-response', { answer: 'NO' })
  const c = (await api(admin.token).get('/admin/complaints')).complaints.find(row => row.booking?.id === b.id)
  const complaint = '/admin/complaints/' + c.id
  const { reviewedAt } = (await api(admin.token).get(complaint)).investigation.attendanceReview
  const decide = () => api(admin.token).patch(complaint, { reviewedAt, status: 'DISMISSED', outcome: 'NOT_HELD', adminResponse: 'Both parties confirmed the lesson was cancelled.' })
  const request = () => api(p.token).post(parentPath + '/refund-request', { reason: 'The lesson did not take place.' })
  if (order === 'simultaneous') {
    const [decision, parentRequest] = await Promise.all([decide(), request()])
    expect(decision.status).toBe(200)
    expect([201, 409]).toContain(parentRequest.status)
  } else {
    if (order === 'parent first') expect((await request()).status).toBe(201)
    expect((await decide()).status).toBe(200)
  }
  expect((await request()).status).toBe(409)
  const booking = (await api(p.token).get(parentPath)).booking
  expect(booking.payment.status).toBe('PAID')
  expect(booking.payment.refunds).toHaveLength(1)
  const id = booking.attendanceReview.attendanceRefundId
  expect(booking.payment.refunds[0]).toMatchObject({ id, status: 'PENDING', amount: 80 })
  expect((await api(t.token).get(path)).review.attendanceRefund.status).toBe('PENDING')
  expect((await api(admin.token).get('/admin/refunds')).rows.filter(r => r.bookingId === b.id)).toMatchObject([{ id, attendanceOutcome: 'NOT_HELD', status: 'PENDING' }])
  expect((await api(admin.token).post('/admin/refunds/' + id + '/decision', { action: 'reject', reason: 'Finance reviewed the payment.' })).status).toBe(204)
  expect((await request()).status).toBe(409)
  expect((await api(t.token).get(path)).review.attendanceRefund.status).toBe('REJECTED')
})

test.each([
  ['PENDING', 'NOT_HELD'], ['APPROVED', 'UNVERIFIED'], ['APPROVED', 'CONFIRMED'], ['ISSUED', 'CONFIRMED'],
])('refund %s during reconsideration ending in %s', async (initial, outcome) => {
  const { b, path, send } = await lesson({ endAt: new Date(Date.now() - 1) })
  await prisma.payment.create({ data: { bookingId: b.id, amount: 80, commissionRate: 10, commissionAmount: 8, status: 'PAID', paidAt: new Date() } })
  await send({ action: 'request-review', reason: 'Lost phone signal.' })
  const parentPath = '/parent/bookings/' + b.publicId
  const parentReply = () => api(p.token).post(parentPath + '/attendance-response', { answer: 'UNSURE', note: 'I checked the lesson date.' })
  await parentReply()
  const c = (await api(admin.token).get('/admin/complaints')).complaints.find(row => row.booking?.id === b.id)
  const complaint = '/admin/complaints/' + c.id
  const decide = async (status, finding) => {
    const { reviewedAt } = (await api(admin.token).get(complaint)).investigation.attendanceReview
    return api(admin.token).patch(complaint, { reviewedAt, status, outcome: finding, adminResponse: 'Reviewed lesson evidence.' })
  }
  expect((await decide('DISMISSED', 'NOT_HELD')).status).toBe(200)
  const parentRefund = async () => (await api(p.token).get(parentPath)).booking.payment.refunds[0]
  const refund = await parentRefund()
  const finance = input => api(admin.token).post('/admin/refunds/' + refund.id + '/decision', input)
  const approve = { action: 'approve', amount: 80, basis: 'Refund policy condition', reason: 'Reviewed the evidence.' }
  const transfer = { action: 'issued', reference: 'hold-test-' + refund.id }
  if (initial !== 'PENDING') expect((await finance(approve)).status).toBe(204)
  if (initial === 'ISSUED') expect((await finance(transfer)).status).toBe(204)
  expect((await send({ action: 'reconsider', reason: 'Recovered the video attendance log.' })).status).toBe(200)
  const expected = initial === 'ISSUED' ? 'TRANSFERRED' : 'ON_HOLD'
  expect((await parentRefund()).attendanceRefundState).toBe(expected)
  expect((await api(t.token).get(path)).review.attendanceRefund.attendanceRefundState).toBe(expected)
  expect((await api(admin.token).get(complaint)).investigation.attendanceReview.attendanceRefundState).toBe(expected)
  if (initial !== 'ISSUED') {
    expect((await api(admin.token).get('/admin/refunds')).rows.find(r => r.id === refund.id).attendanceRefundState).toBe('ON_HOLD')
    expect((await finance(approve)).message).toMatch(/on hold/)
    expect((await finance(transfer)).message).toMatch(/on hold/)
    expect((await decide('IN_PROGRESS', 'MORE_INFO')).status).toBe(200)
    expect((await finance(transfer)).status).toBe(409)
    await parentReply()
    await send({ action: 'review-reply', reason: 'Here are the lesson times.' })
  }
  expect((await decide(outcome === 'CONFIRMED' ? 'RESOLVED' : 'DISMISSED', outcome === 'CONFIRMED' ? undefined : outcome)).status).toBe(200)
  expect((await parentRefund()).attendanceRefundState).toBeNull()
  if (initial === 'ISSUED') {
    expect((await finance(transfer)).status).toBe(409)
    expect((await prisma.refund.findUnique({ where: { id: refund.id } })).transferRef).toBe(transfer.reference)
  } else {
    expect((await finance(transfer)).status).toBe(409)
    expect((await finance(approve)).status).toBe(204)
    expect((await finance(transfer)).status).toBe(204)
  }
})
