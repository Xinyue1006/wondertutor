// Admin: issuing warnings (FR 8.2), suspicious-account flags (FR 8.5) and investigating a complaint (FR 9.2, 9.5).
import { prisma } from '../config/prisma.js'
import { MONDAY, api, makeAdmin, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

let admin, parent, tutor

beforeAll(async () => {
  await resetDb()
  await startServer()
  admin = await makeAdmin()
  parent = await makeParent()
  tutor = await makeTutor()
})
afterAll(stopServer)

const file = (extra = {}) => prisma.complaint.create({ data: { filedById: parent.user.id, againstUserId: tutor.user.id, category: 'Lesson quality', description: 'The lesson was rushed and unprepared.', ...extra } })

describe('issuing a warning', () => {
  test('is recorded, the user is notified, and it shows in their history', async () => {
    const res = await api(admin.token).post(`/admin/users/${tutor.user.id}/warn`, { reason: 'Arrived late to two lessons in a row.' })
    expect(res.status).toBe(201)
    expect(res.warnings).toBe(1)
    const note = await prisma.notification.findFirst({ where: { userId: tutor.user.id, type: 'ACCOUNT_WARNING' } })
    expect(note.message).toContain('Arrived late')
    expect(note.message).toContain('deactivated')
    const detail = await api(admin.token).get(`/admin/users/${tutor.user.id}`)
    expect(detail.user.warnings).toBe(1)
    expect(detail.user.warningHistory[0]).toMatchObject({ reason: 'Arrived late to two lessons in a row.', issuedBy: 'Test Admin' })
  })

  test('needs a real reason, and only admins can issue one', async () => {
    expect((await api(admin.token).post(`/admin/users/${tutor.user.id}/warn`, { reason: 'bad' })).status).toBe(400)
    expect((await api(parent.token).post(`/admin/users/${tutor.user.id}/warn`, { reason: 'I want to warn you!' })).status).toBe(403)
  })

  test('admin accounts and unknown users cannot be warned', async () => {
    expect((await api(admin.token).post(`/admin/users/${admin.user.id}/warn`, { reason: 'Warning an administrator.' })).status).toBe(400)
    expect((await api(admin.token).post('/admin/users/999999/warn', { reason: 'Warning nobody at all.' })).status).toBe(404)
  })

  test('can point to the complaint that led to it', async () => {
    const c = await file()
    const res = await api(admin.token).post(`/admin/users/${tutor.user.id}/warn`, { reason: 'Lesson quality complaint upheld.', complaintId: c.id })
    expect(res.status).toBe(201)
    expect((await prisma.accountWarning.findFirst({ where: { complaintId: c.id } })).userId).toBe(tutor.user.id)
    expect((await api(admin.token).post(`/admin/users/${tutor.user.id}/warn`, { reason: 'No such complaint exists.', complaintId: 999999 })).status).toBe(404)
  })
})

describe('suspicious-account flags', () => {
  test('repeated warnings and many complaints put an account on the review list, with the reasons', async () => {
    const t2 = await makeTutor()
    const before = await api(admin.token).get('/admin/users?review=1')
    expect(before.users.some((u) => u.id === t2.user.id)).toBe(false)

    await api(admin.token).post(`/admin/users/${t2.user.id}/warn`, { reason: 'First formal warning for lateness.' })
    await api(admin.token).post(`/admin/users/${t2.user.id}/warn`, { reason: 'Second formal warning for lateness.' })
    for (let i = 0; i < 3; i++) await file({ againstUserId: t2.user.id })

    const after = await api(admin.token).get('/admin/users?review=1')
    const row = after.users.find((u) => u.id === t2.user.id)
    expect(row.suspicious).toEqual(expect.arrayContaining(['3 complaints filed against this account', '2 warnings already issued']))
    expect(row.complaintsAgainst).toBe(3)
    expect((await api(admin.token).get('/admin/dashboard')).needsReview).toBeGreaterThanOrEqual(1)
  })

  test('a tutor below the rating threshold is flagged too, and ordinary accounts are not', async () => {
    const low = await makeTutor()
    await prisma.tutorProfile.update({ where: { id: low.tutor.id }, data: { ratingAvg: 2.1, ratingCount: 5 } })
    const list = await api(admin.token).get('/admin/users?review=1')
    expect(list.users.find((u) => u.id === low.user.id).suspicious).toContain('Rating below the threshold')
    expect(list.users.some((u) => u.id === parent.user.id)).toBe(false)
  })
})

describe('investigating a complaint', () => {
  test('shows the booking, its payment, attendance and the account’s history', async () => {
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: nextDate(MONDAY), start: '16:00', status: 'COMPLETED', price: 70 })
    await prisma.payment.create({ data: { bookingId: b.id, amount: 70, commissionRate: 10, commissionAmount: 7, method: 'Billplz', status: 'PAID', paidAt: new Date() } })
    await prisma.attendance.create({ data: { bookingId: b.id, checkInAt: new Date(), checkInDistance: 42, checkInPhotoUrl: 'https://res.cloudinary.com/x/y.jpg' } })
    await prisma.sessionSummary.create({ data: { bookingId: b.id, content: 'Covered fractions.', progressNote: 'Needs practice' } })
    const c = await file({ bookingId: b.id })

    const res = await api(admin.token).get(`/admin/complaints/${c.id}`)
    expect(res.status).toBe(200)
    expect(res.complaint.id).toBe(c.id)
    expect(res.investigation.booking).toMatchObject({ id: b.id, status: 'COMPLETED', child: 'Sarah', agreedPrice: 70 })
    expect(res.investigation.payment).toMatchObject({ status: 'PAID', amount: 70 })
    expect(res.investigation.attendance.distanceMetres).toBe(42)
    expect(res.investigation.sessionSummary.content).toBe('Covered fractions.')
    expect(res.investigation.otherComplaints.length).toBeGreaterThanOrEqual(1) // repeated violations by the same tutor
    expect(res.investigation.warnings.length).toBeGreaterThanOrEqual(1)
  })

  test('a complaint without a booking still opens, and a missing one is 404; parents cannot use it', async () => {
    const c = await file({ bookingId: null })
    const res = await api(admin.token).get(`/admin/complaints/${c.id}`)
    expect(res.status).toBe(200)
    expect(res.investigation.booking).toBeNull()
    expect((await api(admin.token).get('/admin/complaints/999999')).status).toBe(404)
    expect((await api(parent.token).get(`/admin/complaints/${c.id}`)).status).toBe(403)
  })
})

describe('receipts', () => {
  test('a paid lesson has a receipt that only its parent can open', async () => {
    const other = await makeParent()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: nextDate(MONDAY), start: '18:00', status: 'CONFIRMED', price: 55 })
    const p = await prisma.payment.create({ data: { bookingId: b.id, amount: 55, commissionRate: 10, commissionAmount: 5.5, method: 'Billplz', gatewayRef: 'bill77', status: 'PAID', paidAt: new Date() } })
    const res = await api(parent.token).get(`/parent/payments/${p.id}/receipt`)
    expect(res.status).toBe(200)
    expect(res.receipt.number).toMatch(/^WT-\d{4}-\d{6}$/)
    expect(res.receipt).toMatchObject({ amount: 55, status: 'PAID', reference: 'bill77' })
    expect(res.receipt.lesson.child).toBe('Sarah')
    expect(JSON.stringify(res.receipt)).not.toContain('commission') // the parent never sees the platform's commission
    expect((await api(other.token).get(`/parent/payments/${p.id}/receipt`)).status).toBe(404)
  })

  test('there is no receipt for a payment that did not go through', async () => {
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: nextDate(MONDAY), start: '19:00', status: 'AWAITING_PAYMENT' })
    const p = await prisma.payment.create({ data: { bookingId: b.id, amount: 50, commissionRate: 0, commissionAmount: 0, status: 'PENDING' } })
    expect((await api(parent.token).get(`/parent/payments/${p.id}/receipt`)).status).toBe(404)
  })
})

describe('matching by language', () => {
  test('a tutor who teaches in the wanted language scores higher and says so', async () => {
    const { scoreTutor } = await import('../services/matching.service.js')
    const base = {
      id: 1, yearsExperience: 3, isVerified: true, ratingAvg: 4, ratingCount: 5, hourlyRate: 50, gender: 'FEMALE', characteristics: [], offersOnline: true, offersPhysical: true,
      latitude: 3.1, longitude: 101.6, subjects: [{ subject: 'Mathematics', educationLevel: 'PRIMARY', minGrade: 4, maxGrade: 6 }], availability: [], qualifications: [],
    }
    const c = { subject: 'Mathematics', level: 'PRIMARY', grade: 5, days: [], mode: 'EITHER', gender: 'ANY', characteristics: [], language: 'Mandarin' }
    const yes = scoreTutor({ ...base, languages: ['English', 'Mandarin'] }, c)
    const no = scoreTutor({ ...base, languages: ['English'] }, c)
    expect(yes.score).toBeGreaterThan(no.score)
    expect(yes.reasons).toContain('Teaches in Mandarin')
    expect(no.reasons).not.toContain('Teaches in Mandarin')
    // no language wanted: nothing changes
    expect(scoreTutor({ ...base, languages: ['English'] }, { ...c, language: undefined }).score).toBe(scoreTutor({ ...base, languages: ['Tamil'] }, { ...c, language: undefined }).score)
  })
})
