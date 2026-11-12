// Tutor Portal API [YH]. Every route requires a logged-in TUTOR, and every query is scoped to req.tutor.
import { Router } from 'express'
import { validateIdParams } from '../middleware/params.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { loadTutorProfile } from '../middleware/tutor.js'
import * as exceptions from '../controllers/tutor/availabilityExceptions.controller.js'
import * as profile from '../controllers/tutor/profile.controller.js'
import * as availability from '../controllers/tutor/availability.controller.js'
import * as bookings from '../controllers/tutor/bookings.controller.js'
import * as session from '../controllers/tutor/lessonSession.controller.js'
import * as earnings from '../controllers/tutor/earnings.controller.js'
import { rateLimit } from '../middleware/rateLimit.js'

const router = validateIdParams(Router(), { publicIds: [
  { prefix: '/bookings/', model: 'booking', scope: (req) => ({ tutorId: req.tutor.id }), notFound: 'Booking not found' },
] })
router.use(requireAuth, requireRole('TUTOR'), loadTutorProfile)

// Every tutor can use every feature straight after sign-up. Admin verification only adds the verified badge
// and places the tutor before unverified ones in search and matching (see rankTutors in matching.service.js).

// Profile setup and verification
router.get('/catalog', profile.catalog)
router.get('/profile', profile.getProfile)
router.put('/profile', profile.updateProfile)
router.post('/documents', profile.addDocument)
router.delete('/documents/:id', profile.removeDocument)
router.post('/portfolio', profile.addPortfolioItem)
router.delete('/portfolio/:id', profile.removePortfolioItem)
router.post('/submit-for-verification', profile.submitForVerification)

// Teaching features: availability, requests, sessions and earnings go below this line
router.get('/dashboard', profile.dashboard)
router.get('/earnings', earnings.dashboard)
router.post('/earnings/bank-code', rateLimit({ name: 'bank-code', max: 5, windowMs: 900000, keyBy: req => req.user.id }), earnings.bankCode)
router.put('/earnings/bank', rateLimit({ name: 'bank-confirm', max: 10, windowMs: 900000, keyBy: req => req.user.id }), earnings.bank)
router.post('/earnings/withdrawals', earnings.withdraw)
router.get('/bookings', bookings.list)
router.get('/bookings/:id/session', session.get)
router.post('/bookings/:id/session', session.update)
router.post('/bookings/:id', bookings.update)
router.get('/availability', availability.getSchedule)
router.put('/availability', availability.updateSchedule)
router.put('/availability/quick-add', availability.updateQuickAdd)
router.post('/availability/weeks/copy', availability.copySchedule)
router.put('/availability/weeks/:weekStart', availability.updateWeek)
router.delete('/availability/weeks/:weekStart', availability.deleteWeek)

router.get('/availability/exceptions', exceptions.list)
router.put('/availability/exceptions', exceptions.save)
router.delete('/availability/exceptions/:date', exceptions.remove)
export default router
