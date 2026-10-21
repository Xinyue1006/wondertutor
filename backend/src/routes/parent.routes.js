// Parent Portal API [XY]. Every route requires a logged-in PARENT, and every query is scoped to req.parent.
import { Router } from 'express'
import { validateIdParams } from '../middleware/params.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { loadParentProfile } from '../middleware/parent.js'
import * as children from '../controllers/parent/children.controller.js'
import * as tutors from '../controllers/parent/tutors.controller.js'
import * as matching from '../controllers/parent/matching.controller.js'
import * as bookings from '../controllers/parent/bookings.controller.js'
import * as payments from '../controllers/parent/payments.controller.js'
import * as reviews from '../controllers/parent/reviews.controller.js'
import * as profile from '../controllers/parent/profile.controller.js'
import * as complaints from '../controllers/parent/complaints.controller.js'
import * as calendar from '../controllers/parent/calendar.controller.js'
import * as account from '../controllers/parent/account.controller.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { dashboard } from '../controllers/parent/dashboard.controller.js'

const router = validateIdParams(Router()) // every :id in these URLs must be a positive whole number
router.use(requireAuth, requireRole('PARENT'), loadParentProfile)

router.get('/dashboard', dashboard)

router.get('/profile', profile.getProfile)
router.put('/profile', profile.updateProfile)
router.post('/profile/password', profile.changePassword)

// Privacy and account controls
router.put('/account/email-reminders', account.setEmailReminders)
router.get('/account/export', account.exportMyData)
router.get('/account/deletion-check', account.deletionCheck)
// Deleting needs the password, so wrong guesses are slowed down like on the login form
router.post('/account/delete', rateLimit({ name: 'account-delete', windowMs: 15 * 60_000, max: 5, keyBy: (req) => req.user.id }), account.deleteMyAccount)

router.get('/children', children.listChildren)
router.post('/children', children.createChild)
router.put('/children/:id', children.updateChild)
router.delete('/children/:id', children.deleteChild)
router.get('/children/:id/progress', children.childProgress)

router.get('/catalog', tutors.catalog)
router.get('/tutors', tutors.browseTutors)
router.get('/tutors/:id', tutors.getTutor)
router.get('/tutors/:id/reviews', tutors.tutorReviews)
router.get('/tutors/:id/slots', tutors.tutorSlots)
router.get('/favourites', tutors.listFavourites)
router.post('/favourites/:tutorId', tutors.toggleFavourite)

router.post('/matching', matching.createMatching)
router.get('/matching/latest', matching.latestMatching)

router.post('/bookings', bookings.createBooking)
router.get('/bookings', bookings.listBookings)
// Registered before '/bookings/:id' so "calendar.ics" is not read as a booking id
router.get('/bookings/calendar.ics', calendar.upcomingCalendar)
router.get('/bookings/:id', bookings.getBooking)
router.get('/bookings/:id/calendar.ics', calendar.lessonCalendar)
router.post('/bookings/:id/accept-counter', bookings.acceptCounter)
router.post('/bookings/:id/decline-counter', bookings.declineCounter)
router.post('/bookings/:id/cancel', bookings.cancelBooking)
router.post('/bookings/:id/refund-request', bookings.requestRefund)
router.post('/bookings/:id/review', reviews.createReview)
router.post('/bookings/:id/reschedule', bookings.requestReschedule)
router.post('/bookings/:id/reschedule/:requestId/:action', bookings.answerReschedule)

router.get('/complaints', complaints.listComplaints)
router.post('/complaints', complaints.createComplaint)

router.get('/payments', payments.paymentsOverview)
router.post('/payments/checkout', payments.checkout)
router.post('/payments/:id/confirm', payments.confirmPayment)

export default router
