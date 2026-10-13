// Forgot / reset password, and the brute-force protection on the auth endpoints.
import bcrypt from 'bcrypt'
import express from 'express'
import { prisma } from '../config/prisma.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { errorHandler } from '../middleware/error.js'
import { api, makeParent, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

// The real code is emailed; tests replace it with a known one
const setCode = (email, code) => bcrypt.hash(code, 4).then((codeHash) => prisma.emailOtp.updateMany({ where: { email }, data: { codeHash } }))

describe('forgot password', () => {
  test('gives the same answer whether or not the email has an account', async () => {
    const { user } = await makeParent()
    const known = await api().post('/auth/forgot-password', { email: user.email })
    const unknown = await api().post('/auth/forgot-password', { email: 'nobody@nowhere.test' })
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(known.message).toBe(unknown.message)
    expect(await prisma.emailOtp.count({ where: { email: user.email } })).toBe(1) // only the real account gets a code
    expect(await prisma.emailOtp.count({ where: { email: 'nobody@nowhere.test' } })).toBe(0)
    // asking again straight away still answers normally (the cooldown is not revealed)
    expect((await api().post('/auth/forgot-password', { email: user.email })).status).toBe(200)
  })

  test('resets the password with the code; the old password stops working and the code cannot be reused', async () => {
    const { user } = await makeParent()
    await api().post('/auth/forgot-password', { email: user.email })
    await setCode(user.email, '123456')

    expect((await api().post('/auth/reset-password', { email: user.email, code: '000000', newPassword: 'NewPass123' })).status).toBe(400)
    const ok = await api().post('/auth/reset-password', { email: user.email, code: '123456', newPassword: 'NewPass123' })
    expect(ok.status).toBe(200)

    expect((await api().post('/auth/login', { email: user.email, password: 'Test1234' })).status).toBe(401)
    expect((await api().post('/auth/login', { email: user.email, password: 'NewPass123' })).status).toBe(200)
    expect((await api().post('/auth/reset-password', { email: user.email, code: '123456', newPassword: 'Another123' })).status).toBe(400)
  })

  test('the new password must follow the password rules', async () => {
    const { user } = await makeParent()
    await api().post('/auth/forgot-password', { email: user.email })
    await setCode(user.email, '654321')
    const weak = await api().post('/auth/reset-password', { email: user.email, code: '654321', newPassword: 'short' })
    expect(weak.status).toBe(400)
    expect(weak.message).toMatch(/at least 8 characters/)
  })

  test('a deactivated account cannot reset its password', async () => {
    const { user } = await makeParent()
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DEACTIVATED' } })
    await api().post('/auth/forgot-password', { email: user.email })
    expect(await prisma.emailOtp.count({ where: { email: user.email } })).toBe(0)
  })
})

describe('rate limiting', () => {
  // A tiny app with the real limiter switched on (it is off for the rest of the test suite)
  async function tinyServer(limiter) {
    const app = express()
    app.use(express.json())
    app.post('/try', limiter, (req, res) => res.json({ ok: true }))
    app.use(errorHandler)
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
    const url = `http://127.0.0.1:${server.address().port}/try`
    const post = (email) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
    return { server, post }
  }

  test('blocks after too many attempts, with a Retry-After header and a readable message', async () => {
    const limiter = rateLimit({ name: 't1', windowMs: 60_000, max: 3, keyBy: (req) => req.body.email, enabled: true })
    const { server, post } = await tinyServer(limiter)
    for (let i = 0; i < 3; i++) expect((await post('a@x.test')).status).toBe(200)
    const blocked = await post('a@x.test')
    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await blocked.json()).message).toMatch(/Too many attempts/)
    // another account is not affected
    expect((await post('b@x.test')).status).toBe(200)
    await new Promise((r) => server.close(r))
  })

  test('the window resets after it expires', async () => {
    const limiter = rateLimit({ name: 't2', windowMs: 150, max: 1, keyBy: () => 'same', enabled: true })
    const { server, post } = await tinyServer(limiter)
    expect((await post()).status).toBe(200)
    expect((await post()).status).toBe(429)
    await new Promise((r) => setTimeout(r, 200))
    expect((await post()).status).toBe(200)
    await new Promise((r) => server.close(r))
  })
})
