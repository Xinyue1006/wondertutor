import { createHash, createHmac, randomBytes } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { credentialTag } from './token.service.js'

export const SESSION_HOURS = 12
export const REMEMBER_DAYS = 7
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/
const secret = () => randomBytes(32).toString('base64url')

export const sessionCookieName = () => env.nodeEnv === 'production' ? '__Host-wt_session' : 'wt_session'
export const anonymousCookieName = () => env.nodeEnv === 'production' ? '__Host-wt_csrf_seed' : 'wt_csrf_seed'
export const hashSessionId = (raw) => createHash('sha256').update(raw).digest('hex')
export const csrfForSession = (raw) => createHmac('sha256', env.jwtSecret).update('session-csrf-v1:' + raw).digest('base64url')
const csrfForAnonymous = (raw) => createHmac('sha256', env.jwtSecret).update('anonymous-csrf-v1:' + raw).digest('base64url')

export function readSecretCookie(req, name) {
  const values = String(req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='))
  // Reject ambiguous cookies instead of choosing an attacker-controlled duplicate.
  if (values.length !== 1) return null
  const raw = values[0].slice(name.length + 1)
  return SECRET_PATTERN.test(raw) ? raw : null
}

export const readSessionId = (req) => readSecretCookie(req, sessionCookieName())

export const cookieOptions = () => ({
  httpOnly: true,
  secure: env.nodeEnv === 'production',
  sameSite: 'lax',
  path: '/',
  // No Domain attribute: production __Host- cookies cannot be set by sibling hosts.
})

export function clearSessionCookie(res) {
  res.clearCookie(sessionCookieName(), cookieOptions())
}

export async function createSession(user, { remember = false, now = new Date(), db = prisma } = {}) {
  const raw = secret()
  const lifetime = remember ? REMEMBER_DAYS * 24 * 3_600_000 : SESSION_HOURS * 3_600_000
  const expiresAt = new Date(now.getTime() + lifetime)
  const record = await db.authSession.create({ data: { id: hashSessionId(raw), userId: user.id, credentialTag: credentialTag(user), expiresAt } })
  return { raw, csrfToken: csrfForSession(raw), expiresAt, remember, record }
}

// Rotate on every successful authentication. An existing browser session is revoked
// in the same transaction, so logging into another account cannot retain it.
export async function startSession(req, res, user, { remember = false } = {}) {
  const previous = readSessionId(req)
  const session = await prisma.$transaction(async (tx) => {
    const created = await createSession(user, { remember, db: tx })
    if (previous) await tx.authSession.deleteMany({ where: { id: hashSessionId(previous) } })
    return created
  })
  const options = cookieOptions()
  if (remember) options.maxAge = REMEMBER_DAYS * 24 * 3_600_000
  res.cookie(sessionCookieName(), session.raw, options)
  res.clearCookie(anonymousCookieName(), cookieOptions())
  res.set('Cache-Control', 'private, no-store')
  return session
}

export async function loadSession(req) {
  if (!req.authSessionLookup) {
    req.authSessionLookup = (async () => {
      const raw = readSessionId(req)
      if (!raw) return null
      const session = await prisma.authSession.findUnique({ where: { id: hashSessionId(raw) }, include: { user: true } })
      if (!session) return null
      if (session.expiresAt <= new Date() || session.credentialTag !== credentialTag(session.user)) {
        await prisma.authSession.deleteMany({ where: { id: session.id } })
        return null
      }
      return { ...session, raw, csrfToken: csrfForSession(raw) }
    })()
  }
  return req.authSessionLookup
}

// The CSRF token can be read by JavaScript, but neither authentication cookie can.
// An expired/revoked session may still obtain its CSRF token to safely log in or
// log out; only loadSession/requireAuth can grant authenticated access.
export function currentCsrfToken(req) {
  const sessionId = readSessionId(req)
  if (sessionId) return csrfForSession(sessionId)
  const seed = readSecretCookie(req, anonymousCookieName())
  return seed ? csrfForAnonymous(seed) : null
}

export function anonymousCsrf(req, res, { rotate = false } = {}) {
  const existing = !rotate && readSecretCookie(req, anonymousCookieName())
  const seed = existing || secret()
  if (!existing) res.cookie(anonymousCookieName(), seed, { ...cookieOptions(), maxAge: SESSION_HOURS * 3_600_000 })
  return csrfForAnonymous(seed)
}

export async function revokeSession(req, res) {
  const raw = readSessionId(req)
  if (raw) await prisma.authSession.deleteMany({ where: { id: hashSessionId(raw) } })
  clearSessionCookie(res)
  res.set('Cache-Control', 'private, no-store')
  return anonymousCsrf(req, res, { rotate: true })
}

export async function cleanupExpiredSessions(now = new Date()) {
  return prisma.authSession.deleteMany({ where: { expiresAt: { lte: now } } })
}
