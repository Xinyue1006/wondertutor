// Admin API. Xin Yue: user management + complaints. Yan Hsi adds booking oversight, finance and settings below.
import { Router } from 'express'
import { validateIdParams } from '../middleware/params.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import * as users from '../controllers/admin/users.controller.js'
import * as complaints from '../controllers/admin/complaints.controller.js'

const router = validateIdParams(Router()) // every :id in these URLs must be a positive whole number
router.use(requireAuth, requireRole('ADMIN'))

router.get('/dashboard', users.dashboard)

// [XY] user management
router.get('/users', users.listUsers)
router.get('/users/:id', users.getUser)
router.post('/users/:id/deactivate', users.setStatus)
router.post('/users/:id/reactivate', users.setStatus)
router.post('/qualifications/:id/review', users.reviewQualification)

// [XY] complaints
router.get('/complaints', complaints.listComplaints)
router.get('/complaints/report', complaints.complaintsReport)
router.get('/complaints/export', complaints.exportComplaints)
router.patch('/complaints/:id', complaints.updateComplaint)

// [YH] booking oversight / finance / system settings go here

export default router
