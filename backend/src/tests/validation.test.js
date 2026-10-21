// Input validation across the Parent Portal and Admin APIs: bad input must get a clear 400 with a message
// the form can show, never a 500 or a silently "fixed" value.
import { prisma } from '../config/prisma.js'
import { api, makeAdmin, makeParent, makeTutor, nextDate, MONDAY, resetDb, startServer, stopServer } from './helpers.js'
import { normalizePhone } from '../utils/validators.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

describe('IDs in the URL', () => {
  test.each(['abc', '1.5', '-3', '0', '99999999999999999999'])('"%s" is rejected with 400, not a 500', async (bad) => {
    const { token } = await makeParent()
    for (const path of [`/parent/children/${bad}/progress`, `/parent/bookings/${bad}`, `/parent/tutors/${bad}`, `/notifications/${bad}/read`]) {
      const res = path.startsWith('/notifications') ? await api(token).post(path) : await api(token).get(path)
      expect(res.status).toBe(400)
      expect(res.message).toBe('Invalid ID in the link')
    }
  })

  test('a valid ID that does not exist is still a 404', async () => {
    const { token } = await makeParent()
    expect((await api(token).get('/parent/bookings/2147483647')).status).toBe(404)
  })
})

describe('signup fields', () => {
  const base = (n, extra = {}) => ({ role: 'PARENT', fullName: 'Miki Lim', email: `v${n}@test.local`, phone: '012-345 6789', password: 'Parent1234', acceptedPrivacy: true, ...extra })

  test('a Malaysian phone in any common format is stored as +60…, and extra spaces in the name are removed', async () => {
    expect((await api().post('/auth/register', base(1, { fullName: '  Miki   Lim ' }))).status).toBe(201)
    const user = await prisma.user.findUnique({ where: { email: 'v1@test.local' } })
    expect(user.phone).toBe('+60123456789')
    expect(user.fullName).toBe('Miki Lim')
  })

  test.each([
    [{ phone: '12345' }, 'phone'],
    [{ phone: '+65 9123 4567' }, 'phone'],
    [{ fullName: 'Miki123' }, 'Full name'],
    [{ fullName: 'M' }, 'Full name'],
    [{ password: 'short1' }, 'at least 8'],
    [{ password: `${'a'.repeat(72)}1` }, '72 characters'],
    [{ email: 'not-an-email' }, 'valid email'],
    [{ children: [{ name: 'Sarah', educationLevel: 'KINDERGARTEN', grade: 5 }] }, 'grade does not exist'],
  ])('rejects %o', async (extra, expected) => {
    const res = await api().post('/auth/register', base(2, extra))
    expect(res.status).toBe(400)
    expect(res.message).toContain(expected)
  })

  test("a tutor's emergency contact cannot be the tutor's own number", async () => {
    const res = await api().post('/auth/register', {
      ...base(3), role: 'TUTOR', gender: 'FEMALE', emergencyContactName: 'Lim Mei Ling', emergencyContactPhone: '0123456789',
    })
    expect(res.status).toBe(400)
    expect(res.message).toContain('must be different')
  })

  test('phone numbers normalise the same way everywhere', () => {
    expect(normalizePhone('+60 12-345 6789')).toBe('+60123456789')
    expect(normalizePhone('03-1234 5678')).toBe('+60312345678')
    expect(normalizePhone('abc')).toBeNull()
  })
})

describe('booking requests', () => {
  let parent, tutor, body
  beforeAll(async () => {
    parent = await makeParent()
    tutor = await makeTutor()
    body = { tutorId: tutor.tutor.id, childId: parent.child.id, date: nextDate(MONDAY), startTime: '17:00', teachingMode: 'ONLINE', proposedPrice: 50 }
  })

  test.each([
    [{ date: '2026-02-31' }, 'Choose a date'],
    [{ startTime: '25:00' }, 'Choose a time'],
    [{ proposedPrice: 50.555 }, '2 decimal places'],
    [{ proposedPrice: 0 }, 'more than RM0'],
    [{ subject: 'Piano' }, 'subject from the list'],
    [{ childId: -1 }, 'Child is invalid'],
  ])('rejects %o', async (change, expected) => {
    const res = await api(parent.token).post('/parent/bookings', { ...body, ...change })
    expect(res.status).toBe(400)
    expect(res.message).toContain(expected)
  })
})

describe('matching and browsing', () => {
  const criteria = { subject: 'Mathematics', level: 'PRIMARY' }

  test.each([
    [{ grade: 7 }, 'grade does not exist'],
    [{ timeStart: '18:00', timeEnd: '17:00' }, 'end time must be after'],
    [{ budgetMin: 80, budgetMax: 40 }, 'minimum budget'],
  ])('the wizard rejects %o', async (change, expected) => {
    const { token } = await makeParent()
    const res = await api(token).post('/parent/matching', { criteria: { ...criteria, ...change } })
    expect(res.status).toBe(400)
    expect(res.message).toContain(expected)
  })

  test.each([
    ['grade=9', 'grade does not exist'],
    ['minPrice=80&maxPrice=40', 'minimum price'],
    ['days=1,9', 'Invalid days'],
    ['characteristics=Strict', 'Unknown teaching style'],
  ])('browse rejects ?%s', async (query, expected) => {
    const { token } = await makeParent()
    const res = await api(token).get(`/parent/tutors?subject=Mathematics&level=PRIMARY&${query}`)
    expect(res.status).toBe(400)
    expect(res.message).toContain(expected)
  })
})

describe('profile, payments and admin', () => {
  test('profile update checks the phone and name like signup does', async () => {
    const { token } = await makeParent()
    expect((await api(token).put('/parent/profile', { fullName: 'Miki Lim', phone: '999' })).status).toBe(400)
    const ok = await api(token).put('/parent/profile', { fullName: 'Miki Lim', phone: '011-2345 6789' })
    expect(ok.status).toBe(200)
    expect(ok.profile.phone).toBe('+601123456789')
  })

  test('the sandbox payment only accepts a bank from the list', async () => {
    const { token } = await makeParent()
    const res = await api(token).post('/parent/payments/1/confirm', { bank: 'Fake Bank', outcome: 'SUCCESS' })
    expect(res.status).toBe(400)
    expect(res.message).toContain('bank from the list')
  })

  test('the complaints report needs a real, ordered date range', async () => {
    const admin = await makeAdmin()
    expect((await api(admin.token).get('/admin/complaints/report?from=2026-02-30')).status).toBe(400)
    const res = await api(admin.token).get('/admin/complaints/report?from=2026-10-10&to=2026-10-01')
    expect(res.status).toBe(400)
    expect(res.message).toContain('on or before')
  })

  test('a body that is not valid JSON gets a 400', async () => {
    const res = await fetch(`${(await import('./helpers.js')).apiBase()}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"email": ',
    })
    expect(res.status).toBe(400)
    expect((await res.json()).message).toContain('not valid JSON')
  })
})
