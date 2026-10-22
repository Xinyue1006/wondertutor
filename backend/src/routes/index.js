import { Router } from 'express'
import { validateIdParams } from '../middleware/params.js'
import authRoutes from './auth.routes.js'
import parentRoutes from './parent.routes.js'
import adminRoutes from './admin.routes.js'
import tutorRoutes from './tutor.routes.js'
import { uploadSignature } from '../controllers/uploads.controller.js'
import { homeData, places } from '../controllers/public.controller.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { requireAuth } from '../middleware/auth.js'
import * as notifications from '../controllers/notifications.controller.js'
import { billplzCallback } from '../controllers/parent/payments.controller.js'

const router = validateIdParams(Router()) // every :id in these URLs must be a positive whole number

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))
router.use('/auth', authRoutes)

// [XY] Public landing page data (top tutors + filter lists), no login needed
router.get('/public/home', homeData)
// Typing in the area picker sends a request per pause, so one address may ask at most 120 times a minute
router.get('/public/places', rateLimit({ name: 'places', windowMs: 60_000, max: 120 }), places)

// [XY] Billplz tells the server a bill was paid. Public on purpose: it is protected by Billplz's signature, not a login.
router.post('/payments/billplz/callback', rateLimit({ name: 'billplz-callback', windowMs: 60_000, max: 60 }), billplzCallback)

// [XY] Parent Portal: children, matching, bookings, payments, reviews
router.use('/parent', parentRoutes)

// [YH] Tutor Portal: profile setup and verification, then the teaching features once verified
router.use('/tutor', tutorRoutes)

// [XY] Admin: user management + complaints ([YH] adds finance/settings inside admin.routes.js)
router.use('/admin', adminRoutes)

// [Shared] Signed Cloudinary upload (the browser uploads straight to Cloudinary; the secret never leaves the server)
router.post('/uploads/signature', requireAuth, uploadSignature)

// [Shared] In-app notifications for every role (bell icon)
router.get('/notifications', requireAuth, notifications.listNotifications)
router.post('/notifications/read-all', requireAuth, notifications.markAllRead)
router.post('/notifications/:id/read', requireAuth, notifications.markRead)

export default router
