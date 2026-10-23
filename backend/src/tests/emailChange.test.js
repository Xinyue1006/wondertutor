// Changing the login email: the password is checked, a code goes to the NEW address, and the old address is told afterwards.
import { prisma } from '../config/prisma.js'
import { outbox } from '../services/email.service.js'
import { api, makeAdmin, makeParent, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)
beforeEach(() => { outbox.length = 0 })

let n = 0
const fresh = () => `new${Date.now()}${++n}@test.local`
const codeSentTo = (address) => {
  const mail = [...outbox].reverse().find((m) => m.to === address && /Confirm your new/.test(m.subject))
  return mail?.html.match(/<b[^>]*>(\d{6})<\/b>/)?.[1]
}
const request = (token, body) => api(token).post('/auth/change-email/request', { password: 'Test1234', ...body })

describe('asking to change the email', () => {
  test('sends a code to the NEW address and changes nothing yet', async () => {
    const p = await makeParent()
    const next = fresh()
    const res = await request(p.token, { newEmail: next })
    expect(res.status).toBe(200)
    expect(res.message).toContain(next)
    expect(codeSentTo(next)).toMatch(/^\d{6}$/)
    expect((await prisma.user.findUnique({ where: { id: p.user.id } })).email).toBe(p.user.email)
    expect(outbox.some((m) => m.to === p.user.email)).toBe(false) // the old address hears nothing until the change is made
  })

  test('needs the right password', async () => {
    const p = await makeParent()
    const bad = await request(p.token, { newEmail: fresh(), password: 'Wrong1234' })
    expect(bad.status).toBe(400)
    expect(bad.message).toBe('Incorrect password')
    expect(outbox).toHaveLength(0)
  })

  test('refuses the same address, an address that belongs to someone else, and a badly written one', async () => {
    const p = await makeParent()
    const other = await makeParent()
    expect((await request(p.token, { newEmail: p.user.email })).message).toBe('That is already your email address')
    expect((await request(p.token, { newEmail: other.user.email })).status).toBe(409)
    expect((await request(p.token, { newEmail: 'not-an-email' })).status).toBe(400)
    expect(outbox).toHaveLength(0)
  })

  test('is only for logged-in users, and a Google-only account is pointed to Google', async () => {
    expect((await api().post('/auth/change-email/request', { newEmail: fresh(), password: 'x' })).status).toBe(401)
    const g = await makeParent()
    await prisma.user.update({ where: { id: g.user.id }, data: { passwordHash: null, googleId: `g${Date.now()}` } })
    const res = await request(g.token, { newEmail: fresh() })
    expect(res.status).toBe(400)
    expect(res.message).toContain('Google')
  })

  test('a second request within a minute is slowed down', async () => {
    const p = await makeParent()
    const next = fresh()
    expect((await request(p.token, { newEmail: next })).status).toBe(200)
    expect((await request(p.token, { newEmail: next })).status).toBe(429)
  })
})

describe('confirming with the code', () => {
  test('changes the login email, verifies it, warns the old address and records a notification', async () => {
    const p = await makeParent()
    const next = fresh()
    await request(p.token, { newEmail: next })
    const res = await api(p.token).post('/auth/change-email/confirm', { newEmail: next, code: codeSentTo(next) })
    expect(res.status).toBe(200)
    expect(res.user.email).toBe(next)

    const row = await prisma.user.findUnique({ where: { id: p.user.id } })
    expect([row.email, row.isEmailVerified]).toEqual([next, true])
    const notice = outbox.find((m) => m.to === p.user.email && /login email was changed/.test(m.subject))
    expect(notice.html).toContain(next)
    expect(await prisma.notification.count({ where: { userId: p.user.id, type: 'EMAIL_CHANGED' } })).toBe(1)

    // the new address logs in; the old one no longer does
    expect((await api().post('/auth/login', { email: next, password: 'Test1234' })).status).toBe(200)
    expect((await api().post('/auth/login', { email: p.user.email, password: 'Test1234' })).status).toBe(401)
    // the session that was open keeps working
    expect((await api(p.token).get('/auth/me')).status).toBe(200)
  })

  test('a wrong code is refused, and the fifth wrong try locks that code', async () => {
    const p = await makeParent()
    const next = fresh()
    await request(p.token, { newEmail: next })
    for (let i = 0; i < 5; i++) expect((await api(p.token).post('/auth/change-email/confirm', { newEmail: next, code: '000000' })).status).toBe(400)
    const locked = await api(p.token).post('/auth/change-email/confirm', { newEmail: next, code: codeSentTo(next) })
    expect(locked.status).toBe(429)
    expect((await prisma.user.findUnique({ where: { id: p.user.id } })).email).toBe(p.user.email)
  })

  test('the code only works for the account that asked, and only for the address it was sent to', async () => {
    const a = await makeParent()
    const b = await makeParent()
    const next = fresh()
    await request(a.token, { newEmail: next })
    const code = codeSentTo(next)
    expect((await api(b.token).post('/auth/change-email/confirm', { newEmail: next, code })).status).toBe(400)
    expect((await api(a.token).post('/auth/change-email/confirm', { newEmail: fresh(), code })).status).toBe(400)
    expect((await api(a.token).post('/auth/change-email/confirm', { newEmail: next, code })).status).toBe(200)
  })

  test('an address taken in the meantime is refused', async () => {
    const p = await makeParent()
    const next = fresh()
    await request(p.token, { newEmail: next })
    await makeAdmin().then((a) => prisma.user.update({ where: { id: a.user.id }, data: { email: next } }))
    const res = await api(p.token).post('/auth/change-email/confirm', { newEmail: next, code: codeSentTo(next) })
    expect(res.status).toBe(409)
    expect((await prisma.user.findUnique({ where: { id: p.user.id } })).email).toBe(p.user.email)
  })

  test('a code cannot be used twice', async () => {
    const p = await makeParent()
    const next = fresh()
    await request(p.token, { newEmail: next })
    const code = codeSentTo(next)
    expect((await api(p.token).post('/auth/change-email/confirm', { newEmail: next, code })).status).toBe(200)
    expect((await api(p.token).post('/auth/change-email/confirm', { newEmail: next, code })).status).toBe(400)
  })
})

describe('it does not disturb other code flows', () => {
  test('asking for a change does not wipe a sign-up code that is waiting for the same address', async () => {
    const p = await makeParent()
    const next = fresh()
    await prisma.emailOtp.create({ data: { email: next, codeHash: 'x', expiresAt: new Date(Date.now() + 60_000) } })
    await request(p.token, { newEmail: next })
    expect(await prisma.emailOtp.count({ where: { email: next } })).toBe(1)
  })
})
