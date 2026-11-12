import { randomBytes } from 'node:crypto'
import bcrypt from 'bcrypt'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import { signToken } from '../services/token.service.js'
import { anonymousCookieName, cleanupExpiredSessions, cookieOptions, createSession, csrfForSession, hashSessionId, sessionCookieName } from '../services/session.service.js'
import { api, apiBase, authHeaders, makeAdmin, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

let parent, tutor, admin
beforeAll(async () => {
  await resetDb(); await startServer()
  parent = await makeParent(); tutor = await makeTutor(); admin = await makeAdmin()
})
afterAll(stopServer)

// Real HTTP cookie jar. Deliberately does not auto-add CSRF headers, so negative
// security cases cannot accidentally pass through a test-only middleware bypass.
function browser() {
  const cookies = new Map()
  return {
    cookies,
    async request(path, { method = 'GET', body, headers = {} } = {}) {
      const res = await fetch(apiBase() + path, {
        method,
        headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(cookies.size && { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      for (const header of res.headers.getSetCookie()) {
        const pair = header.split(';')[0], split = pair.indexOf('=')
        const key = pair.slice(0, split), value = pair.slice(split + 1)
        if (!value || /max-age=0/i.test(header)) cookies.delete(key)
        else cookies.set(key, value)
      }
      return { status: res.status, headers: res.headers, body: await res.json().catch(() => ({})) }
    },
  }
}
const loginBody = (who, remember = false) => ({ email: who.user.email, password: 'Test1234', remember, ...(who.user.role === 'ADMIN' && { portal: 'ADMIN' }) })
async function login(who, remember = false, client = browser()) {
  const bootstrap = await client.request('/auth/csrf')
  const res = await client.request('/auth/login', { method: 'POST', body: loginBody(who, remember), headers: { 'X-CSRF-Token': bootstrap.body.csrfToken, Origin: new URL(env.clientUrl).origin } })
  expect(res.status).toBe(200)
  return { client, res, raw: client.cookies.get(sessionCookieName()) }
}

test('anonymous CSRF bootstrap uses an HttpOnly seed and discloses no login credential', async () => {
  const client = browser(), res = await client.request('/auth/csrf')
  expect(res.status).toBe(200)
  expect(res.body).toEqual({ csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) })
  expect(res.headers.get('cache-control')).toContain('no-store')
  const seedCookie = res.headers.getSetCookie().find(h => h.startsWith(anonymousCookieName() + '='))
  expect(seedCookie).toMatch(/HttpOnly/)
  expect(seedCookie).toMatch(/SameSite=Lax/)
  expect(client.cookies.has(sessionCookieName())).toBe(false)
  expect((await client.request('/auth/me')).status).toBe(401)
})

test.each(['PARENT', 'TUTOR', 'ADMIN'])('%s signs in, reloads its session and retains its role permissions', async role => {
  const who = { PARENT: parent, TUTOR: tutor, ADMIN: admin }[role]
  const { client, res, raw } = await login(who)
  expect(res.body.token).toBeUndefined()
  expect(res.body.user.passwordHash).toBeUndefined()
  expect(res.body.user.role).toBe(role)
  expect(res.body.csrfToken).toBe(csrfForSession(raw))
  const sessionCookie = res.headers.getSetCookie().find(h => h.startsWith(sessionCookieName() + '='))
  expect(sessionCookie).toMatch(/HttpOnly/)
  expect(sessionCookie).toMatch(/SameSite=Lax/)
  expect(sessionCookie).toMatch(/Path=\//)
  expect(sessionCookie).not.toMatch(/Max-Age=|Expires=|Domain=/)
  const stored = await prisma.authSession.findUnique({ where: { id: hashSessionId(raw) } })
  expect(stored.userId).toBe(who.user.id)
  expect(stored.id).not.toBe(raw)
  expect(JSON.stringify(stored)).not.toContain(raw)
  const me = await client.request('/auth/me')
  expect(me.status).toBe(200)
  expect(me.body.user.role).toBe(role)
  const ownPath = { PARENT: '/parent/profile', TUTOR: '/tutor/profile', ADMIN: '/admin/users' }[role]
  expect((await client.request(ownPath)).status).toBe(200)
  const wrongPath = role === 'ADMIN' ? '/parent/profile' : '/admin/users'
  expect((await client.request(wrongPath)).status).toBe(403)
})

test('Remember Me persists for seven days while ordinary sessions expire after twelve hours', async () => {
  const remembered = await login(parent, true)
  const header = remembered.res.headers.getSetCookie().find(h => h.startsWith(sessionCookieName() + '='))
  expect(header).toContain('Max-Age=604800')
  const normal = await createSession(parent.user)
  const long = await prisma.authSession.findUnique({ where: { id: hashSessionId(remembered.raw) } })
  expect(long.expiresAt.getTime() - long.createdAt.getTime()).toBeCloseTo(7 * 24 * 3600000, -3)
  expect(normal.expiresAt.getTime() - normal.record.createdAt.getTime()).toBeCloseTo(12 * 3600000, -3)
})

test('production cookies are host-bound, Secure and HttpOnly without requiring new environment secrets', async () => {
  const previous = env.nodeEnv
  try {
    env.nodeEnv = 'production'
    expect(sessionCookieName()).toBe('__Host-wt_session')
    expect(cookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    const res = await browser().request('/auth/csrf')
    expect(res.headers.getSetCookie()[0]).toMatch(/^__Host-wt_csrf_seed=/)
    expect(res.headers.getSetCookie()[0]).toMatch(/; Secure;.*SameSite=Lax/)
    expect(res.headers.getSetCookie()[0]).not.toMatch(/Domain=/)
  } finally { env.nodeEnv = previous }
})

test.each(['/auth/login', '/auth/register', '/auth/google', '/auth/verify-otp', '/auth/logout'])('missing CSRF cannot reach %s', async path => {
  const res = await browser().request(path, { method: 'POST', body: loginBody(parent) })
  expect(res.status).toBe(403)
  expect(res.body.code).toBe('CSRF_INVALID')
})

test.each([undefined, 'wrong', 'é'.repeat(43)])('missing or malformed CSRF rejects an authenticated profile change', async value => {
  const before = await prisma.user.findUnique({ where: { id: parent.user.id } })
  const headers = { Cookie: authHeaders(parent.token).Cookie, ...(value && { 'X-CSRF-Token': value }) }
  const res = await browser().request('/parent/profile', { method: 'PUT', body: { fullName: 'Should Never Be Saved' }, headers })
  expect(res.status).toBe(403)
  expect(res.body.code).toBe('CSRF_INVALID')
  expect((await prisma.user.findUnique({ where: { id: parent.user.id } })).fullName).toBe(before.fullName)
})

test('CSRF is bound to its anonymous browser and to the authenticated session', async () => {
  const first = browser(), second = browser()
  const a = await first.request('/auth/csrf'); await second.request('/auth/csrf')
  expect((await second.request('/auth/login', { method: 'POST', body: loginBody(parent), headers: { 'X-CSRF-Token': a.body.csrfToken } })).body.code).toBe('CSRF_INVALID')
  const other = await createSession(parent.user)
  const response = await browser().request('/parent/profile', { method: 'PUT', body: { fullName: 'Wrong session' }, headers: { Cookie: authHeaders(parent.token).Cookie, 'X-CSRF-Token': other.csrfToken } })
  expect(response.body.code).toBe('CSRF_INVALID')
})

test.each([{ Origin: 'https://evil.example' }, { Origin: 'null' }, { Referer: 'https://evil.example/form' }, { 'Sec-Fetch-Site': 'cross-site' }])('a foreign request is rejected even with correct CSRF: %j', async extra => {
  const res = await browser().request('/auth/logout', { method: 'POST', headers: { ...authHeaders(parent.token), ...extra } })
  expect(res.status).toBe(403)
  expect(res.body.code).toBe('CSRF_ORIGIN')
  expect(await prisma.authSession.findUnique({ where: { id: hashSessionId(parent.token) } })).not.toBeNull()
})

test('server logout deletes its session, clears its cookie and rejects replay; another session survives', async () => {
  const { client, res, raw } = await login(parent)
  const another = await createSession(parent.user)
  const loggedOut = await client.request('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': res.body.csrfToken } })
  expect(loggedOut.status).toBe(200)
  expect(loggedOut.headers.getSetCookie().find(h => h.startsWith(sessionCookieName() + '='))).toMatch(/Expires=Thu, 01 Jan 1970/)
  expect(await prisma.authSession.findUnique({ where: { id: hashSessionId(raw) } })).toBeNull()
  expect((await api(raw).get('/auth/me')).status).toBe(401)
  expect((await api(another.raw).get('/auth/me')).status).toBe(200)
  expect((await client.request('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': loggedOut.body.csrfToken } })).status).toBe(200)
})

test('successful authentication rotates the cookie and revokes the previous browser session', async () => {
  const first = await login(parent)
  const next = await login(tutor, false, first.client)
  expect(next.raw).not.toBe(first.raw)
  expect((await api(first.raw).get('/auth/me')).status).toBe(401)
  expect((await api(next.raw).get('/auth/me')).user.role).toBe('TUTOR')
  const stale = await browser().request('/auth/logout', { method: 'POST', headers: { Cookie: authHeaders(next.raw).Cookie, 'X-CSRF-Token': first.res.body.csrfToken } })
  expect(stale.body.code).toBe('CSRF_INVALID')
})

test('expired sessions and password changes invalidate cookies on the server', async () => {
  const expired = await createSession(parent.user, { now: new Date(Date.now() - 13 * 3600000) })
  expect((await api(expired.raw).get('/auth/me')).status).toBe(401)
  const person = await makeParent(), session = await createSession(person.user)
  await prisma.user.update({ where: { id: person.user.id }, data: { passwordHash: await bcrypt.hash('Replacement123', 4) } })
  expect((await api(session.raw).get('/auth/me')).status).toBe(401)
  expect(await prisma.authSession.findUnique({ where: { id: hashSessionId(session.raw) } })).toBeNull()
})

test('legacy JWT/Bearer, invented IDs and ambiguous cookies cannot authenticate', async () => {
  const legacy = signToken(parent.user)
  expect((await browser().request('/auth/me', { headers: { Authorization: 'Bearer ' + legacy } })).status).toBe(401)
  expect((await api(legacy).get('/auth/me')).status).toBe(401)
  expect((await api(randomBytes(32).toString('base64url')).get('/auth/me')).status).toBe(401)
  const cookie = `${sessionCookieName()}=${parent.token}; ${sessionCookieName()}=${tutor.token}`
  expect((await browser().request('/auth/me', { headers: { Cookie: cookie } })).status).toBe(401)
})

test('unauthenticated checks never clear a newer concurrently issued browser cookie', async () => {
  const res = await browser().request('/auth/me')
  expect(res.status).toBe(401)
  expect(res.headers.getSetCookie()).toEqual([])
})

test('only the signed Billplz callback is exempt from browser CSRF checks', async () => {
  const callback = await browser().request('/payments/billplz/callback', { method: 'POST', body: {} })
  expect(String(callback.body.code || '')).not.toMatch(/^CSRF_/)
  expect(callback.status).not.toBe(200)
  expect((await browser().request('/parent/payments/return', { method: 'POST', body: {} })).body.code).toBe('CSRF_INVALID')
  expect((await browser().request('/payments/billplz/callback/extra', { method: 'POST', body: {} })).body.code).toBe('CSRF_INVALID')
})

test('expiry cleanup keeps active sessions and removes only expired rows', async () => {
  const stale = await createSession(parent.user, { now: new Date(Date.now() - 13 * 3600000) })
  await cleanupExpiredSessions()
  expect(await prisma.authSession.findUnique({ where: { id: hashSessionId(stale.raw) } })).toBeNull()
  expect(await prisma.authSession.findUnique({ where: { id: hashSessionId(parent.token) } })).not.toBeNull()
})
