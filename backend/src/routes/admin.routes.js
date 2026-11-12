// Admin API. Xin Yue: user management + complaints. Yan Hsi adds booking oversight, finance and settings below.
import { Router } from 'express'
import { validateIdParams } from '../middleware/params.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import * as users from '../controllers/admin/users.controller.js'
import * as complaints from '../controllers/admin/complaints.controller.js'
import { moderateReview } from '../controllers/admin/reviews.controller.js'
import * as settings from '../controllers/admin/settings.controller.js'
import * as withdrawals from '../controllers/admin/withdrawals.controller.js'

const router = validateIdParams(Router(), { publicIds: [
  { prefix: '/complaints/', model: 'complaint', scope: () => ({}), notFound: 'Complaint not found' },
] })
router.use(requireAuth, requireRole('ADMIN'))

router.get('/dashboard', users.dashboard)

// [XY] user management
router.get('/users', users.listUsers)
router.get('/users/:id', users.getUser)
router.post('/users/:id/deactivate', users.setStatus)
router.post('/users/:id/reactivate', users.setStatus)
router.post('/users/:id/warn', users.warnUser)
router.post('/qualifications/:id/review', users.reviewQualification)

// [XY] complaints
router.get('/complaints', complaints.listComplaints)
router.get('/complaints/report', complaints.complaintsReport)
router.get('/complaints/export', complaints.exportComplaints)
router.get('/complaints/:id', complaints.getComplaint)
router.patch('/complaints/:id', complaints.updateComplaint)
router.patch('/reviews/:id/moderation', moderateReview)

router.get('/withdrawals', withdrawals.list)
router.post('/withdrawals/:id/review', withdrawals.review)
router.get('/settings', settings.list)
router.patch('/settings', settings.update)

export default router
