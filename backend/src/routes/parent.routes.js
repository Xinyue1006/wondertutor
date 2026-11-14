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
import * as assistant from '../controllers/parent/assistant.controller.js'
import { env } from '../config/env.js'

const router = validateIdParams(Router(), { publicIds: [
  { prefix: '/children/', model: 'child', scope: (req) => ({ parentId: req.parent.id }), notFound: 'Child not found' },
  { prefix: '/bookings/', model: 'booking', scope: (req) => ({ parentId: req.parent.id }), notFound: 'Booking not found' },
  { prefix: '/payments/', model: 'payment', scope: (req) => ({ booking: { parentId: req.parent.id } }), notFound: 'Payment not found' },
] })
router.use(requireAuth, requireRole('PARENT'), loadParentProfile)

router.get('/dashboard', dashboard)

router.get('/profile', profile.getProfile)
router.put('/profile', profile.updateProfile)
router.put('/profile/photo', profile.updatePhoto)
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
router.get('/children/:id/report', children.childReport)

router.get('/catalog', tutors.catalog)
router.get('/tutors', tutors.browseTutors)
router.get('/tutors/:id', tutors.getTutor)
router.get('/tutors/:id/reviews', tutors.tutorReviews)
router.get('/tutors/:id/slots', tutors.tutorSlots)
router.get('/favourites', tutors.listFavourites)
router.post('/favourites/:tutorId', tutors.toggleFavourite)

router.post('/matching', matching.createMatching)
router.post('/matching/preview', matching.previewMatching)
router.get('/matching/latest', matching.latestMatching)

router.post('/bookings', bookings.createBooking)
router.get('/bookings', bookings.listBookings)
// Registered before '/bookings/:id' so "calendar.ics" is not read as a booking id
router.get('/bookings/calendar.ics', calendar.upcomingCalendar)
router.get('/bookings/:id', bookings.getBooking)
router.put('/bookings/:id/location', bookings.updateLessonLocation)
router.get('/bookings/:id/calendar.ics', calendar.lessonCalendar)
router.post('/bookings/:id/negotiate', bookings.negotiate)
router.post('/bookings/:id/accept-counter', bookings.acceptCounter)
router.post('/bookings/:id/decline-counter', bookings.declineCounter)
router.post('/bookings/:id/cancel', bookings.cancelBooking)
router.post('/bookings/:id/refund-request', bookings.requestRefund)
router.post('/bookings/:id/review', reviews.createReview)
router.post('/reviews/:id/report', reviews.reportReview)
router.post('/bookings/:id/reschedule', bookings.requestReschedule)
router.post('/bookings/:id/reschedule/:requestId/:action', bookings.answerReschedule)

router.get('/complaints', complaints.listComplaints)
router.post('/complaints', complaints.createComplaint)

router.get('/payments', payments.paymentsOverview)
router.post('/payments/checkout', payments.checkout)
router.post('/payments/:id/confirm', payments.confirmPayment)
router.post('/payments/return', payments.gatewayReturn)
router.get('/payments/:id/receipt', payments.getReceipt)

// Read-only AI assistant (Phase 1). Messages are limited per logged-in user, on top of the general API limit.
router.get('/assistant/capabilities', assistant.capabilities)
router.post('/assistant/messages', rateLimit({ name: 'assistant', windowMs: 60_000, max: env.ai.messagesPerMinute, keyBy: (req) => req.user.id }), assistant.postMessage)
router.delete('/assistant/conversations/:conversationId', assistant.deleteConversation)

export default router
