import { Router } from 'express'
import * as auth from '../controllers/auth.controller.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.post('/register', auth.register)
router.post('/verify-otp', auth.verifyOtp)
router.post('/resend-otp', auth.resendOtp)
router.post('/login', auth.login)
router.post('/google', auth.googleLogin)
router.get('/me', requireAuth, auth.me)

export default router
