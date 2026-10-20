// Tutor Portal API [YH]. Every route requires a logged-in TUTOR, and every query is scoped to req.tutor.
import { Router } from 'express'
import { validateIdParams } from '../middleware/params.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { loadTutorProfile, requireVerifiedTutor } from '../middleware/tutor.js'
import * as profile from '../controllers/tutor/profile.controller.js'

const router = validateIdParams(Router()) // every :id in these URLs must be a positive whole number
router.use(requireAuth, requireRole('TUTOR'), loadTutorProfile)

// Onboarding: open to every tutor, verified or not
router.get('/catalog', profile.catalog)
router.get('/profile', profile.getProfile)
router.put('/profile', profile.updateProfile)
router.post('/documents', profile.addDocument)
router.delete('/documents/:id', profile.removeDocument)
router.post('/portfolio', profile.addPortfolioItem)
router.delete('/portfolio/:id', profile.removePortfolioItem)
router.post('/submit-for-verification', profile.submitForVerification)

// Teaching features: only after Admin verification. Availability, requests, sessions and earnings go below this line.
router.use(requireVerifiedTutor)
router.get('/dashboard', profile.dashboard)

export default router
