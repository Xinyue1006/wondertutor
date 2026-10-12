import { prisma } from '../config/prisma.js'
import { verifyToken } from '../services/token.service.js'
import { AppError } from '../utils/AppError.js'

// Requires a valid JWT. Attaches req.user (fresh from DB).
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) throw new AppError(401, 'Please log in')

  let payload
  try {
    payload = verifyToken(token)
  } catch {
    throw new AppError(401, 'Session expired, please log in again')
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } })
  if (!user) throw new AppError(401, 'Account not found')
  if (user.status === 'DEACTIVATED') throw new AppError(403, 'Your account has been deactivated. Please contact Admin.')

  req.user = user
  next()
}

// Role-based access control: requireRole('ADMIN') or requireRole('PARENT', 'ADMIN')
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) throw new AppError(403, 'You do not have permission to do this')
    next()
  }
}
