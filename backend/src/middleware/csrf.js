import { timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'
import { currentCsrfToken } from '../services/session.service.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const invalidOrigin = (res) => res.status(403).json({ code: 'CSRF_ORIGIN', message: 'This request was blocked because it came from another website.' })

function trustedOrigin(value) {
  try { return new URL(value).origin === new URL(env.clientUrl).origin } catch { return false }
}

export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next()
  // Billplz's server-to-server callback has its own signature verification. No
  // browser return, checkout or other payment operation is exempted.
  if (req.method === 'POST' && req.path === '/payments/billplz/callback') return next()
  res.set('Cache-Control', 'private, no-store')
  if (req.get('Sec-Fetch-Site') === 'cross-site') return invalidOrigin(res)
  const origin = req.get('Origin')
  if (origin !== undefined && !trustedOrigin(origin)) return invalidOrigin(res)
  const referer = req.get('Referer')
  if (origin === undefined && referer !== undefined && !trustedOrigin(referer)) return invalidOrigin(res)
  const expected = currentCsrfToken(req)
  const supplied = req.get('X-CSRF-Token')
  if (!expected || typeof supplied !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(403).json({ code: 'CSRF_INVALID', message: 'The security check expired. Please try again.' })
  }
  next()
}
