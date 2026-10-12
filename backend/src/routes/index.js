import { Router } from 'express'
import authRoutes from './auth.routes.js'
import parentRoutes from './parent.routes.js'
import { requireAuth } from '../middleware/auth.js'
import * as notifications from '../controllers/notifications.controller.js'

const router = Router()

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }))
router.use('/auth', authRoutes)

// [XY] Parent Portal: children, matching, bookings, payments, reviews
router.use('/parent', parentRoutes)

// [Shared] In-app notifications for every role (bell icon)
router.get('/notifications', requireAuth, notifications.listNotifications)
router.post('/notifications/read-all', requireAuth, notifications.markAllRead)
router.post('/notifications/:id/read', requireAuth, notifications.markRead)

// Add the other modules here as they are built, e.g.
// [YH] router.use('/tutor', tutorRoutes)         — profile, availability, attendance, earnings
// [Shared] router.use('/admin', adminRoutes)     — users, complaints (XY) / finance, settings (YH)

export default router
