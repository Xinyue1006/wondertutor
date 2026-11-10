// Tutor Portal API [YH]. Every route requires a logged-in TUTOR, and every query is scoped to req.tutor.
import { Router } from 'express'
import { validateIdParams } from '../middleware/params.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { loadTutorProfile } from '../middleware/tutor.js'
import * as exceptions from '../controllers/tutor/availability.controller.js'
import * as profile from '../controllers/tutor/profile.controller.js'

const router = validateIdParams(Router()) // every :id in these URLs must be a positive whole number
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

router.get('/availability/exceptions', exceptions.list)
router.put('/availability/exceptions', exceptions.save)
router.delete('/availability/exceptions/:date', exceptions.remove)
export default router
