// Small in-memory rate limiter (no extra library). Slows down password guessing and code guessing on the
// auth endpoints: after `max` attempts inside `windowMs` the caller gets 429 until the window has passed.
//
// In-memory is fine for one server process (this project's deployment). With several servers you would
// keep the counters in a shared store such as Redis instead.
import { AppError } from '../utils/AppError.js'
import { env } from '../config/env.js'

export function rateLimit({ name, windowMs, max, keyBy = (req) => req.ip, enabled = env.nodeEnv !== 'test' }) {
  const hits = new Map() // key -> { count, resetAt }

  // Forget old entries now and then so the map cannot grow without limit
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
  }, windowMs)
  sweep.unref?.()

  const middleware = (req, res, next) => {
    if (!enabled) return next()
    const key = `${name}:${keyBy(req)}`
    const now = Date.now()
    let entry = hits.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      hits.set(key, entry)
    }
    entry.count += 1
    if (entry.count > max) {
      const seconds = Math.ceil((entry.resetAt - now) / 1000)
      res.set('Retry-After', String(seconds))
      const minutes = Math.ceil(seconds / 60)
      return next(new AppError(429, `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`))
    }
    next()
  }
  middleware.reset = () => hits.clear() // used by tests
  return middleware
}

// Limit per IP + email, so one attacker cannot try many passwords on one account, and one office
// sharing an IP does not lock everybody else out
export const byIpAndEmail = (req) => `${req.ip}|${String(req.body?.email || '').trim().toLowerCase()}`
