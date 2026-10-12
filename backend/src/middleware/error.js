import { ZodError } from 'zod'
import { isDev } from '../config/env.js'

export function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` })
}

// Express 5 forwards errors thrown in async handlers here automatically
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ message: err.issues[0]?.message || 'Invalid input', issues: err.issues })
  }
  const status = err.status || 500
  if (status === 500) console.error(err)
  res.status(status).json({
    message: status === 500 && !isDev ? 'Internal server error' : err.message,
  })
}
