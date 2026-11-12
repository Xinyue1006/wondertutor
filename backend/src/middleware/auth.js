import { loadSession, readSessionId } from '../services/session.service.js'
import { AppError } from '../utils/AppError.js'

// The browser's opaque HttpOnly cookie must resolve to a live server-side session.
// Bearer tokens and old stateless JWTs are deliberately not authentication paths.
export async function requireAuth(req, res, next) {
  res.set('Cache-Control', 'private, no-store')
  const session = await loadSession(req)
  if (!session) {
    const hadCookie = Boolean(readSessionId(req))
    // Never clear cookies on a read/auth failure: a late response from an older
    // request could otherwise erase a fresh login's cookie. Logout owns clearing.
    if (!hadCookie) throw new AppError(401, 'Please log in')
    throw new AppError(401, 'Session expired, please log in again')
  }
  const user = session.user
  if (user.status === 'DEACTIVATED') throw new AppError(403, 'Your account has been deactivated. Please contact Admin.')
  req.user = user
  req.session = session
  next()
}

// Role-based access control: requireRole('ADMIN') or requireRole('PARENT', 'ADMIN')
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) throw new AppError(403, 'You do not have permission to do this')
    next()
  }
}
