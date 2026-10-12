// Parent Portal API [XY]. Every route requires a logged-in PARENT, and every query is scoped to req.parent.
import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { loadParentProfile } from '../middleware/parent.js'
import * as children from '../controllers/parent/children.controller.js'
import * as tutors from '../controllers/parent/tutors.controller.js'
import * as matching from '../controllers/parent/matching.controller.js'
import * as bookings from '../controllers/parent/bookings.controller.js'
import * as payments from '../controllers/parent/payments.controller.js'
import * as reviews from '../controllers/parent/reviews.controller.js'
import * as complaints from '../controllers/parent/complaints.controller.js'
import { dashboard } from '../controllers/parent/dashboard.controller.js'

const router = Router()
router.use(requireAuth, requireRole('PARENT'), loadParentProfile)

router.get('/dashboard', dashboard)

router.get('/children', children.listChildren)
router.post('/children', children.createChild)
router.put('/children/:id', children.updateChild)
router.delete('/children/:id', children.deleteChild)

router.get('/catalog', tutors.catalog)
router.get('/tutors', tutors.browseTutors)
router.get('/tutors/:id', tutors.getTutor)
router.get('/tutors/:id/reviews', tutors.tutorReviews)
router.get('/tutors/:id/slots', tutors.tutorSlots)
router.post('/favourites/:tutorId', tutors.toggleFavourite)

router.post('/matching', matching.createMatching)
router.get('/matching/latest', matching.latestMatching)

router.post('/bookings', bookings.createBooking)
router.get('/bookings', bookings.listBookings)
router.get('/bookings/:id', bookings.getBooking)
router.post('/bookings/:id/accept-counter', bookings.acceptCounter)
router.post('/bookings/:id/decline-counter', bookings.declineCounter)
router.post('/bookings/:id/cancel', bookings.cancelBooking)
router.post('/bookings/:id/review', reviews.createReview)

router.get('/complaints', complaints.listComplaints)
router.post('/complaints', complaints.createComplaint)

router.get('/payments', payments.paymentsOverview)
router.post('/payments/checkout', payments.checkout)
router.post('/payments/:id/confirm', payments.confirmPayment)

export default router
