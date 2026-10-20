import { Router } from 'express'
import { validateIdParams } from '../middleware/params.js'
import authRoutes from './auth.routes.js'
import parentRoutes from './parent.routes.js'
import adminRoutes from './admin.routes.js'
import tutorRoutes from './tutor.routes.js'
import { uploadSignature } from '../controllers/uploads.controller.js'
import { homeData } from '../controllers/public.controller.js'
import { requireAuth } from '../middleware/auth.js'
import * as notifications from '../controllers/notifications.controller.js'

const router = validateIdParams(Router()) // every :id in these URLs must be a positive whole number

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))
router.use('/auth', authRoutes)

// [XY] Public landing page data (top tutors + filter lists), no login needed
router.get('/public/home', homeData)

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
