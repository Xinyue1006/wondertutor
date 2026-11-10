import { createHmac } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export function credentialTag(user) {
  return createHmac('sha256', env.jwtSecret).update(JSON.stringify(['credential-v1', user.id, user.passwordHash ?? null])).digest('base64url')
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, credential: credentialTag(user) }, env.jwtSecret, { expiresIn: env.jwtExpiresIn })
}

export function verifyToken(token) {
  return jwt.verify(token, env.jwtSecret)
}
