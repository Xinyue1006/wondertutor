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
    const { user, token } = await makeParent()
    await api().post('/auth/forgot-password', { email: user.email })
    await setCode(user.email, '123456')

    expect((await api().post('/auth/reset-password', { email: user.email, code: '000000', newPassword: 'NewPass123' })).status).toBe(400)
    const ok = await api().post('/auth/reset-password', { email: user.email, code: '123456', newPassword: 'NewPass123' })
    expect(ok.status).toBe(200)
    expect((await api(token).get('/auth/me')).status).toBe(401)

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
  async function tinyServer(limiter, handler = (req, res) => res.json({ ok: true })) {
    const app = express()
    app.use(express.json())
    app.post('/try', limiter, handler)
    app.use(errorHandler)
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
    const url = `http://127.0.0.1:${server.address().port}/try`
    const post = (email, password) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
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

  describe('failuresOnly', () => {
    const limiter = (name, over = {}) => rateLimit({ name, windowMs: 60_000, max: 3, keyBy: (req) => req.body.email, enabled: true, failuresOnly: true, ...over })
    // Behaves like login: the right password succeeds, anything else is a 401
    const login = (req, res) => (req.body.password === 'right' ? res.json({ ok: true }) : res.status(401).json({ message: 'Incorrect email or password' }))
    const statuses = (responses) => responses.map((r) => r.status)

    test('successful requests are never counted', async () => {
      const { server, post } = await tinyServer(limiter('f1'), login)
      for (let i = 0; i < 4; i++) expect((await post('a@x.test', 'right')).status).toBe(200)
      await new Promise((r) => server.close(r))
    })

    test('after max failures the next request is blocked, even with the right password', async () => {
      const { server, post } = await tinyServer(limiter('f2'), login)
      for (let i = 0; i < 3; i++) expect((await post('a@x.test', 'wrong')).status).toBe(401)
      const blocked = await post('a@x.test', 'right')
      expect(blocked.status).toBe(429)
      expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
      expect((await blocked.json()).message).toMatch(/Too many attempts/)
      await new Promise((r) => server.close(r))
    })

    test('successes between failures do not use up the budget', async () => {
      const { server, post } = await tinyServer(limiter('f3'), login)
      const seq = []
      for (const password of ['wrong', 'right', 'right', 'wrong', 'wrong']) seq.push(await post('a@x.test', password))
      expect(statuses(seq)).toEqual([401, 200, 200, 401, 401])
      expect((await post('a@x.test', 'right')).status).toBe(429)
      await new Promise((r) => server.close(r))
    })

    test('two emails have separate budgets', async () => {
      const { server, post } = await tinyServer(limiter('f4'), login)
      for (let i = 0; i < 3; i++) await post('a@x.test', 'wrong')
      expect((await post('a@x.test', 'wrong')).status).toBe(429)
      expect((await post('b@x.test', 'wrong')).status).toBe(401)
      await new Promise((r) => server.close(r))
    })

    test('a blocked request does not extend the window', async () => {
      const { server, post } = await tinyServer(limiter('f5', { windowMs: 200, max: 1 }), login)
      expect((await post('a@x.test', 'wrong')).status).toBe(401)
      await new Promise((r) => setTimeout(r, 120))
      expect((await post('a@x.test', 'wrong')).status).toBe(429) // would push the window past 250 ms if it extended it
      await new Promise((r) => setTimeout(r, 130))
      expect((await post('a@x.test', 'right')).status).toBe(200)
      await new Promise((r) => server.close(r))
    })

    test('only 401 and 403 count: other errors give the try back', async () => {
      const respond = (req, res) => res.status(Number(req.body.password)).json({ message: 'x' })
      const { server, post } = await tinyServer(limiter('f6'), respond)
      for (const code of [400, 400, 500, 502, 400]) expect((await post('a@x.test', String(code))).status).toBe(code)
      for (const code of [401, 403, 401]) expect((await post('a@x.test', String(code))).status).toBe(code)
      expect((await post('a@x.test', '401')).status).toBe(429)
      await new Promise((r) => server.close(r))
    })

    test('guesses sent at the same moment cannot get past the limit', async () => {
      const slow = (req, res) => setTimeout(() => login(req, res), 50)
      const { server, post } = await tinyServer(limiter('f7'), slow)
      const results = statuses(await Promise.all(Array.from({ length: 10 }, () => post('a@x.test', 'wrong'))))
      expect(results.filter((s) => s === 401)).toHaveLength(3)
      expect(results.filter((s) => s === 429)).toHaveLength(7)
      await new Promise((r) => server.close(r))
    })
  })
})

describe('login with an unknown email', () => {
  const MESSAGE = 'Incorrect email or password'

  test('gets the same 401 as a wrong password on a real account', async () => {
    const { user } = await makeParent()
    const unknown = await api().post('/auth/login', { email: 'nobody@nowhere.test', password: 'Whatever123' })
    const wrong = await api().post('/auth/login', { email: user.email, password: 'Whatever123' })
    expect(unknown.status).toBe(401)
    expect(unknown.message).toBe(MESSAGE)
    expect(wrong.status).toBe(401)
    expect(wrong.message).toBe(MESSAGE)
  })

  test('an account with no password (Google only) also gets the same 401', async () => {
    const { user } = await makeParent()
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: null } })
    const res = await api().post('/auth/login', { email: user.email, password: 'Whatever123' })
    expect(res.status).toBe(401)
    expect(res.message).toBe(MESSAGE)
  })
})
