// Admin user management + complaints, and account security rules.
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

describe('access control', () => {
  test('parents and tutors cannot open Admin APIs', async () => {
    expect((await api(parent.token).get('/admin/users')).status).toBe(403)
    expect((await api(tutor.token).get('/admin/complaints')).status).toBe(403)
  })
  test('no login, no access', async () => {
    expect((await api().get('/admin/users')).status).toBe(401)
  })
  test('admins cannot use the parent API', async () => {
    expect((await api(admin.token).get('/parent/dashboard')).status).toBe(403)
  })
})

describe('user management', () => {
  test('lists and filters users', async () => {
    const all = await api(admin.token).get('/admin/users')
    expect(all.users.length).toBeGreaterThanOrEqual(3)
    const tutors = await api(admin.token).get('/admin/users?role=TUTOR')
    expect(tutors.users.every((u) => u.role === 'TUTOR')).toBe(true)
    expect(JSON.stringify(all)).not.toMatch(/passwordHash/)
  })

  test('deactivating blocks login and API use; reactivating restores them', async () => {
    const victim = await makeParent()
    expect((await api(admin.token).post(`/admin/users/${victim.user.id}/deactivate`)).status).toBe(200)

    expect((await api(victim.token).get('/parent/dashboard')).status).toBe(403)
    const login = await api().post('/auth/login', { email: victim.user.email, password: 'Test1234' })
    expect(login.status).toBe(403)

    expect((await api(admin.token).post(`/admin/users/${victim.user.id}/reactivate`)).status).toBe(200)
    expect((await api(victim.token).get('/parent/dashboard')).status).toBe(200)
  })

  test('deactivating twice and deactivating an Admin are refused', async () => {
    const victim = await makeParent()
    await api(admin.token).post(`/admin/users/${victim.user.id}/deactivate`)
    expect((await api(admin.token).post(`/admin/users/${victim.user.id}/deactivate`)).status).toBe(400)
    expect((await api(admin.token).post(`/admin/users/${admin.user.id}/deactivate`)).status).toBe(400)
  })

  test('approving a qualification grants the verified badge once the identity document is approved; rejecting the only one removes it', async () => {
    const t = await makeTutor()
    await prisma.qualification.create({ data: { tutorId: t.tutor.id, kind: 'IDENTITY', title: 'NRIC', documentUrl: 'x', status: 'APPROVED' } })
    const q = await prisma.qualification.create({ data: { tutorId: t.tutor.id, title: 'BSc Maths', documentUrl: 'x' } })

    expect((await api(admin.token).post(`/admin/qualifications/${q.id}/review`, { status: 'APPROVED' })).status).toBe(200)
    expect((await prisma.tutorProfile.findUnique({ where: { id: t.tutor.id } })).isVerified).toBe(true)

    expect((await api(admin.token).post(`/admin/qualifications/${q.id}/review`, { status: 'REJECTED' })).status).toBe(400) // reason required
    await api(admin.token).post(`/admin/qualifications/${q.id}/review`, { status: 'REJECTED', note: 'Document unreadable' })
    expect((await prisma.tutorProfile.findUnique({ where: { id: t.tutor.id } })).isVerified).toBe(false)
  })

  test('tutors below the rating threshold are flagged (needs at least 3 reviews)', async () => {
    const t = await makeTutor()
    await prisma.tutorProfile.update({ where: { id: t.tutor.id }, data: { ratingAvg: 2.4, ratingCount: 5 } })
    const few = await makeTutor()
    await prisma.tutorProfile.update({ where: { id: few.tutor.id }, data: { ratingAvg: 1.0, ratingCount: 1 } })

    const res = await api(admin.token).get('/admin/users?flagged=1')
    const ids = res.users.map((u) => u.tutor.id)
    expect(ids).toContain(t.tutor.id)
    expect(ids).not.toContain(few.tutor.id)
  })
})

describe('complaints', () => {
  let complaintId

  test('a parent files a complaint about their own booking; Admin is notified', async () => {
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: nextDate(MONDAY), status: 'COMPLETED' })
    const res = await api(parent.token).post('/parent/complaints', { bookingId: b.id, category: 'Lesson quality', description: 'The lesson did not match what was agreed.' })
    expect(res.status).toBe(201)
    expect(res.complaint.status).toBe('OPEN')
    expect(res.complaint.against.id).toBe(tutor.user.id)
    complaintId = res.complaint.id
    expect(await prisma.notification.count({ where: { userId: admin.user.id, type: 'COMPLAINT_NEW' } })).toBe(1)
  })

  test('validation: category and description are required', async () => {
    expect((await api(parent.token).post('/parent/complaints', { category: 'Other', description: 'short' })).status).toBe(400)
    expect((await api(parent.token).post('/parent/complaints', { category: 'Nonsense', description: 'long enough description here' })).status).toBe(400)
  })

  test("a parent cannot file a complaint about someone else's booking", async () => {
    const other = await makeParent()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: nextDate(MONDAY), start: '19:00', status: 'COMPLETED' })
    const res = await api(other.token).post('/parent/complaints', { bookingId: b.id, category: 'Other', description: 'This is not my booking at all.' })
    expect(res.status).toBe(404)
  })

  test('parents only see their own complaints', async () => {
    const other = await makeParent()
    expect((await api(other.token).get('/parent/complaints')).complaints).toHaveLength(0)
    expect((await api(parent.token).get('/parent/complaints')).complaints).toHaveLength(1)
  })

  test('Admin moves it OPEN -> IN_PROGRESS -> RESOLVED and the parent is notified', async () => {
    expect((await api(admin.token).patch(`/admin/complaints/${complaintId}`, { status: 'IN_PROGRESS' })).complaint.status).toBe('IN_PROGRESS')
    expect((await api(admin.token).patch(`/admin/complaints/${complaintId}`, { status: 'RESOLVED' })).status).toBe(400) // response required
    const done = await api(admin.token).patch(`/admin/complaints/${complaintId}`, { status: 'RESOLVED', adminResponse: 'We spoke to the tutor.' })
    expect(done.complaint.status).toBe('RESOLVED')
    expect(await prisma.notification.count({ where: { userId: parent.user.id, type: 'COMPLAINT_UPDATE' } })).toBe(2)
    expect((await api(parent.token).get('/parent/complaints')).complaints[0].adminResponse).toBe('We spoke to the tutor.')
  })

  test('a closed complaint cannot be changed again', async () => {
    const res = await api(admin.token).patch(`/admin/complaints/${complaintId}`, { status: 'DISMISSED', adminResponse: 'Changing my mind' })
    expect(res.status).toBe(400)
  })
})

describe('account security', () => {
  test('profile: wrong current password is refused; correct one changes it', async () => {
    const p = await makeParent()
    expect((await api(p.token).post('/parent/profile/password', { currentPassword: 'wrong', newPassword: 'Newpass123' })).status).toBe(400)
    expect((await api(p.token).post('/parent/profile/password', { currentPassword: 'Test1234', newPassword: 'weak' })).status).toBe(400)
    expect((await api(p.token).post('/parent/profile/password', { currentPassword: 'Test1234', newPassword: 'Newpass123' })).status).toBe(200)
    expect((await api().post('/auth/login', { email: p.user.email, password: 'Newpass123' })).status).toBe(200)
    expect((await api().post('/auth/login', { email: p.user.email, password: 'Test1234' })).status).toBe(401)
  })

  test('profile photos must come from our own Cloudinary account', async () => {
    const p = await makeParent()
    const body = { fullName: 'Test Parent', phone: '+60123456789' }
    expect((await api(p.token).put('/parent/profile', { ...body, profilePhotoUrl: 'https://evil.example/x.png' })).status).toBe(400)
    expect((await api(p.token).put('/parent/profile', { ...body, profilePhotoUrl: 'https://res.cloudinary.com/demo/image/upload/a.jpg' })).status).toBe(200)
  })

  test('photo upload signature requires a login and reports when Cloudinary is not configured', async () => {
    expect((await api().post('/uploads/signature')).status).toBe(401)
    expect((await api(parent.token).post('/uploads/signature')).status).toBe(501)
  })

  test('login responses never contain the password hash', async () => {
    const res = await api().post('/auth/login', { email: parent.user.email, password: 'Test1234' })
    expect(JSON.stringify(res)).not.toMatch(/passwordHash|\$2[aby]\$/)
  })
})

describe('children', () => {
  test('a parent can add, edit and delete a child, but only their own', async () => {
    const mine = await makeParent()
    const theirs = await makeParent()
    const created = await api(mine.token).post('/parent/children', { name: 'Zoe', educationLevel: 'PRIMARY', grade: 3, subject: 'English' })
    expect(created.status).toBe(201)

    expect((await api(theirs.token).put(`/parent/children/${created.child.id}`, { name: 'Hacked', educationLevel: 'PRIMARY', grade: 3 })).status).toBe(404)
    expect((await api(theirs.token).del(`/parent/children/${created.child.id}`)).status).toBe(404)
    expect((await api(mine.token).put(`/parent/children/${created.child.id}`, { name: 'Zoe T', educationLevel: 'PRIMARY', grade: 4 })).child.grade).toBe(4)
    expect((await api(mine.token).del(`/parent/children/${created.child.id}`)).status).toBe(200)
  })

  test('invalid grade for the level is rejected', async () => {
    const p = await makeParent()
    expect((await api(p.token).post('/parent/children', { name: 'X', educationLevel: 'KINDERGARTEN', grade: 5 })).status).toBe(400)
  })

  test('a child with lesson history cannot be removed', async () => {
    const p = await makeParent()
    const t = await makeTutor()
    await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: nextDate(MONDAY), status: 'COMPLETED' })
    expect((await api(p.token).del(`/parent/children/${p.child.id}`)).status).toBe(409)
  })
})
