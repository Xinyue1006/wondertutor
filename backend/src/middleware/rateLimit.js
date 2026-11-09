// Small in-memory rate limiter (no extra library). Slows down password guessing and code guessing on the
// auth endpoints: after `max` attempts inside `windowMs` the caller gets 429 until the window has passed.
//
// In-memory is fine for one server process (this project's deployment). With several servers you would
// keep the counters in a shared store such as Redis instead.
import { AppError } from '../utils/AppError.js'
import { env } from '../config/env.js'

// Responses that count as a failed attempt when failuresOnly is on: a guess was rejected or the account refused.
const FAILED_STATUSES = new Set([401, 403])

// failuresOnly: successful requests are not counted. Each request still takes a try when it arrives and gives it
// back on finish if it did not fail, so a burst of simultaneous guesses cannot all get past the limit.
export function rateLimit({ name, windowMs, max, keyBy = (req) => req.ip, enabled = env.nodeEnv !== 'test', failuresOnly = false }) {
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
    const atLimit = failuresOnly && entry.count >= max // a blocked request does not take a try
    if (!atLimit) entry.count += 1
    if (atLimit || entry.count > max) {
      const seconds = Math.ceil((entry.resetAt - now) / 1000)
      res.set('Retry-After', String(seconds))
      const minutes = Math.ceil(seconds / 60)
      return next(new AppError(429, `Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`))
    }
    if (failuresOnly) {
      res.on('finish', () => {
        if (FAILED_STATUSES.has(res.statusCode)) return
        entry.count -= 1
        // Nothing counted: forget the entry, so the window starts at the first failure
        if (entry.count <= 0 && hits.get(key) === entry) hits.delete(key)
      })
    }
    next()
  }
  middleware.reset = () => hits.clear() // used by tests
  return middleware
}

// Limit per IP + email, so one attacker cannot try many passwords on one account, and one office
// sharing an IP does not lock everybody else out
export const byIpAndEmail = (req) => `${req.ip}|${String(req.body?.email || '').trim().toLowerCase()}`
