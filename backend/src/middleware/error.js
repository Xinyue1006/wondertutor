import { ZodError } from 'zod'
import { Prisma } from '@prisma/client'
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
  // Safety net: input that slipped past validation and was rejected by Prisma is the caller's mistake (400),
  // and the message would expose table and column names, so it is logged but never sent
  if (err instanceof Prisma.PrismaClientValidationError) {
    console.error(err.message)
    return res.status(400).json({ message: 'Invalid input' })
  }
  // Two requests raced (e.g. a double click) and the second hit a unique rule, or the row was removed meanwhile
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return res.status(409).json({ message: 'This has already been saved. Please refresh the page.' })
    if (err.code === 'P2025') return res.status(404).json({ message: 'This record no longer exists. Please refresh the page.' })
  }
  // A JSON body that is not valid JSON (express.json() parse error)
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'The request body is not valid JSON' })
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'The request is too large' })
  const status = err.status || 500
  if (status === 500) console.error(err)
  res.status(status).json({
    message: status === 500 && !isDev ? 'Internal server error' : err.message,
  })
}
