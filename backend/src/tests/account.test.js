// Privacy and account controls (PDPA): consent at sign-up, reminder emails on/off, "download my data" and
// "delete my account" (personal details go, lesson and payment records stay without a name).
import { prisma } from '../config/prisma.js'
import { outbox } from '../services/email.service.js'
import { MONDAY, api, apiBase, makeAdmin, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

let tutor, monday
beforeAll(async () => {
  await resetDb()
  await startServer()
  tutor = await makeTutor()
  monday = nextDate(MONDAY)
})
afterAll(stopServer)
beforeEach(() => { outbox.length = 0 })

const del = (p, body = {}) => api(p.token).post('/parent/account/delete', { confirmEmail: p.user.email, password: 'Test1234', ...body })

describe('privacy notice at sign-up', () => {
  const body = (n, extra = {}) => ({ role: 'PARENT', fullName: 'Miki Lim', email: `consent${n}@test.local`, phone: '012-345 6789', password: 'Parent1234', ...extra })

  test('no account without accepting the notice, and the time of acceptance is kept', async () => {
    const without = await api().post('/auth/register', body(1))
    expect(without.status).toBe(400)
    expect(without.message).toContain('Privacy Notice')
    expect(await prisma.user.findUnique({ where: { email: 'consent1@test.local' } })).toBeNull()

    expect((await api().post('/auth/register', body(2, { acceptedPrivacy: false }))).status).toBe(400)

    const before = Date.now()
    expect((await api().post('/auth/register', body(3, { acceptedPrivacy: true }))).status).toBe(201)
    const user = await prisma.user.findUnique({ where: { email: 'consent3@test.local' } })
    expect(user.privacyAcceptedAt.getTime()).toBeGreaterThanOrEqual(before - 1000)
  })
})

describe('reminder emails switch', () => {
  test('can be switched off and on, and the profile shows the choice', async () => {
    const p = await makeParent()
    expect((await api(p.token).get('/parent/profile')).profile.emailReminders).toBe(true)
    expect((await api(p.token).put('/parent/account/email-reminders', { enabled: false })).emailReminders).toBe(false)
    expect((await api(p.token).get('/parent/profile')).profile.emailReminders).toBe(false)
    expect((await api(p.token).put('/parent/account/email-reminders', { enabled: true })).emailReminders).toBe(true)
    expect((await api(p.token).put('/parent/account/email-reminders', { enabled: 'yes' })).status).toBe(400)
  })
})

describe('download my data', () => {
  test('contains my own data, not the password and not anyone else’s', async () => {
    const p = await makeParent()
    const other = await makeParent()
    await makeBooking({ parent: p.parent, child: p.child, tutor: tutor.tutor, date: monday, start: '16:00', status: 'COMPLETED' })
    await makeBooking({ parent: other.parent, child: other.child, tutor: tutor.tutor, date: monday, start: '17:00', status: 'COMPLETED' })
    const res = await fetch(`${apiBase()}/parent/account/export`, { headers: { Authorization: `Bearer ${p.token}` } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('wondertutor-my-data.json')
    const text = await res.text()
    const data = JSON.parse(text)
    expect(data.account.email).toBe(p.user.email)
    expect(data.children.map((c) => c.name)).toEqual(['Sarah'])
    expect(data.bookings).toHaveLength(1)
    expect(text).not.toContain('passwordHash')
    expect(text).not.toContain(other.user.email)
  })

  test('needs a login', async () => {
    expect((await fetch(`${apiBase()}/parent/account/export`)).status).toBe(401)
  })
})

describe('delete my account', () => {
  test('needs the email typed out and the right password', async () => {
    const p = await makeParent()
    expect((await del(p, { confirmEmail: 'someone.else@test.local' })).message).toContain('does not match')
    expect((await del(p, { password: undefined })).message).toContain('Enter your password')
    expect((await del(p, { password: 'WrongPass1' })).message).toBe('Incorrect password')
    expect((await prisma.user.findUnique({ where: { id: p.user.id } })).deletedAt).toBeNull()
  })

  test('is refused while a booking, a refund request or a complaint is still open, and says what to finish', async () => {
    const p = await makeParent()
    const active = await makeBooking({ parent: p.parent, child: p.child, tutor: tutor.tutor, date: monday, start: '16:00', status: 'CONFIRMED' })
    const check = await api(p.token).get('/parent/account/deletion-check')
    expect(check.canDelete).toBe(false)
    expect(check.blockers.bookings).toBe(1)
    const refused = await del(p)
    expect(refused.status).toBe(409)
    expect(refused.message).toContain('1 booking still in progress')

    await prisma.booking.update({ where: { id: active.id }, data: { status: 'CANCELLED' } })
    await prisma.complaint.create({ data: { filedById: p.user.id, category: 'Other', description: 'Something went wrong' } })
    expect((await del(p)).message).toContain('1 open complaint')

    await prisma.complaint.updateMany({ where: { filedById: p.user.id }, data: { status: 'RESOLVED' } })
    expect((await api(p.token).get('/parent/account/deletion-check')).canDelete).toBe(true)
  })

  test('removes the personal details but keeps the lesson and payment records, now without a name', async () => {
    const p = await makeParent()
    await prisma.parentProfile.update({ where: { id: p.parent.id }, data: { latitude: 3.2, longitude: 101.6, preferences: { mode: 'ONLINE' } } })
    await prisma.child.update({ where: { id: p.child.id }, data: { notes: 'Struggles with fractions', photoUrl: 'https://res.cloudinary.com/demo/x.jpg' } })
    const b = await makeBooking({ parent: p.parent, child: p.child, tutor: tutor.tutor, date: monday, start: '17:00', status: 'COMPLETED', extra: { location: 'Kepong, Kuala Lumpur', latitude: 3.2, longitude: 101.6, messageToTutor: 'Please call me' } })
    await prisma.payment.create({ data: { bookingId: b.id, amount: 50, commissionRate: 10, commissionAmount: 5, status: 'PAID', paidAt: new Date() } })
    await prisma.notification.create({ data: { userId: p.user.id, type: 'X', title: 'x', message: 'x' } })
    await prisma.favouriteTutor.create({ data: { parentId: p.parent.id, tutorId: tutor.tutor.id } })
    await prisma.matchingRequest.create({ data: { parentId: p.parent.id, source: 'WIZARD', criteria: {}, results: [] } })

    const oldEmail = p.user.email
    const res = await del(p)
    expect(res.status).toBe(200)

    const user = await prisma.user.findUnique({ where: { id: p.user.id } })
    expect(user).toMatchObject({ fullName: 'Deleted user', phone: null, passwordHash: null, googleId: null, profilePhotoUrl: null, status: 'DEACTIVATED', emailReminders: false })
    expect(user.email).toBe(`deleted-${p.user.id}@deleted.invalid`)
    expect(user.deletedAt).not.toBeNull()

    const parent = await prisma.parentProfile.findUnique({ where: { id: p.parent.id } })
    expect(parent).toMatchObject({ address: null, latitude: null, longitude: null })
    expect(parent.preferences).toBeNull()
    expect(await prisma.child.findUnique({ where: { id: p.child.id } })).toMatchObject({ name: 'Child', notes: null, photoUrl: null })

    // records the centre needs stay
    expect(await prisma.booking.findUnique({ where: { id: b.id } })).toMatchObject({ status: 'COMPLETED', location: null, latitude: null, messageToTutor: null })
    expect(await prisma.payment.count({ where: { bookingId: b.id } })).toBe(1)

    // what only served the person is gone
    expect(await prisma.notification.count({ where: { userId: p.user.id } })).toBe(0)
    expect(await prisma.favouriteTutor.count({ where: { parentId: p.parent.id } })).toBe(0)
    expect(await prisma.matchingRequest.count({ where: { parentId: p.parent.id } })).toBe(0)

    // a last email goes to the old address
    expect(outbox.some((m) => m.to === oldEmail && m.subject.includes('account was deleted'))).toBe(true)
  })

  test('the deleted person is logged out everywhere, cannot log in, and can sign up again with the same email', async () => {
    const p = await makeParent()
    const oldEmail = p.user.email
    expect((await del(p)).status).toBe(200)
    expect((await api(p.token).get('/parent/profile')).status).toBe(403) // the old login stops working at once
    expect((await api().post('/auth/login', { email: oldEmail, password: 'Test1234' })).status).toBe(401)
    const again = await api().post('/auth/register', { role: 'PARENT', fullName: 'Back Again', email: oldEmail, phone: '012-345 6789', password: 'Parent1234', acceptedPrivacy: true })
    expect(again.status).toBe(201)
  })

  test('a Google-only account (no password) confirms with the email alone', async () => {
    const p = await makeParent()
    await prisma.user.update({ where: { id: p.user.id }, data: { passwordHash: null, googleId: 'g-123' } })
    const res = await api(p.token).post('/parent/account/delete', { confirmEmail: p.user.email })
    expect(res.status).toBe(200)
  })

  test('Admin sees it as deleted and cannot reactivate it', async () => {
    const admin = await makeAdmin()
    const p = await makeParent()
    await del(p)
    const list = await api(admin.token).get('/admin/users?role=PARENT')
    expect(list.users.find((u) => u.id === p.user.id).deleted).toBe(true)
    const res = await api(admin.token).post(`/admin/users/${p.user.id}/reactivate`)
    expect(res.status).toBe(400)
    expect(res.message).toContain('deleted by its owner')
  })
})

describe('profile photo', () => {
  const photo = 'https://res.cloudinary.com/demo/image/upload/me.jpg'

  test('is saved on its own as soon as it is uploaded, and survives a reload', async () => {
    const p = await makeParent()
    expect((await api(p.token).put('/parent/profile/photo', { profilePhotoUrl: photo })).profilePhotoUrl).toBe(photo)
    expect((await api(p.token).get('/parent/profile')).profile.profilePhotoUrl).toBe(photo)
    expect((await api(p.token).get('/auth/me')).user.profilePhotoUrl).toBe(photo)
  })

  test('can be removed, and only photos from our own image host are accepted', async () => {
    const p = await makeParent()
    await api(p.token).put('/parent/profile/photo', { profilePhotoUrl: photo })
    expect((await api(p.token).put('/parent/profile/photo', { profilePhotoUrl: null })).profilePhotoUrl).toBeNull()
    expect((await api(p.token).get('/parent/profile')).profile.profilePhotoUrl).toBeNull()
    expect((await api(p.token).put('/parent/profile/photo', { profilePhotoUrl: 'https://evil.example.com/x.png' })).status).toBe(400)
    expect((await api(p.token).put('/parent/profile/photo', {})).status).toBe(400)
  })
})

describe('profile details', () => {
  test('a number from another country is saved with its country code, and the page can say since when the parent is a member', async () => {
    const p = await makeParent()
    const res = await api(p.token).put('/parent/profile', { fullName: 'Miki Lim', phone: '+65 9123 4567', address: '' })
    expect(res.status).toBe(200)
    const profile = (await api(p.token).get('/parent/profile')).profile
    expect(profile.phone).toBe('+6591234567')
    expect(profile.address).toBeNull()
    expect(new Date(profile.memberSince).getTime()).toBeGreaterThan(0)
  })

  test('preferences can be saved without sending a phone, and the phone is left as it was', async () => {
    const p = await makeParent()
    const before = (await api(p.token).get('/parent/profile')).profile.phone
    const res = await api(p.token).put('/parent/profile', { fullName: 'Test Parent', address: '', preferences: { mode: 'ONLINE' } })
    expect(res.status).toBe(200)
    expect((await api(p.token).get('/parent/profile')).profile.phone).toBe(before)
    expect((await api(p.token).put('/parent/profile', { fullName: 'Test Parent', phone: '12', address: '' })).status).toBe(400)
  })
})
