import { Router } from 'express'
import * as auth from '../controllers/auth.controller.js'
import { requireAuth } from '../middleware/auth.js'
import { byIpAndEmail, rateLimit } from '../middleware/rateLimit.js'

const router = Router()

// Brute-force protection on everything that checks a password or a code, or sends an email
const FIFTEEN_MIN = 15 * 60 * 1000
export const limiters = {
  login: rateLimit({ name: 'login', windowMs: FIFTEEN_MIN, max: 10, keyBy: byIpAndEmail }),
  code: rateLimit({ name: 'code', windowMs: FIFTEEN_MIN, max: 10, keyBy: byIpAndEmail }),
  email: rateLimit({ name: 'email', windowMs: FIFTEEN_MIN, max: 5 }),
}

router.post('/register', limiters.email, auth.register)
router.post('/verify-otp', limiters.code, auth.verifyOtp)
router.post('/resend-otp', limiters.email, auth.resendOtp)
router.post('/login', limiters.login, auth.login)
router.post('/google', limiters.login, auth.googleLogin)
router.post('/forgot-password', limiters.email, auth.forgotPassword)
router.post('/reset-password', limiters.code, auth.resetPassword)
router.get('/me', requireAuth, auth.me)

export default router
