import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { imageUrl } from '../../utils/validators.js'
import { reviewContentProblem, reviewFingerprint } from '../../services/reviewContent.js'
import { complaintInclude, toComplaintDto } from './complaints.controller.js'

const reviewSchema = z.object({
  rating: z.number({ message: 'Choose a rating' }).int('Choose a rating').min(1, 'Choose a rating').max(5, 'Rating is 1 to 5 stars'),
  comment: z.string().trim().max(500, 'Comment must be 500 characters or fewer').optional().superRefine((value, ctx) => {
    const message = reviewContentProblem(value)
    if (message) ctx.addIssue({ code: 'custom', message })
  }),
  // Attendance/qualification URLs are authenticated evidence, not public review photos.
  photoUrl: imageUrl().refine((url) => {
    try { return new URL(url).pathname.includes('/image/upload/') } catch { return false }
  }, 'Upload a public review image through this form; private evidence links cannot be published.').optional().nullable(),
})

async function notifyAdmins(tx, payload) {
  const admins = await tx.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
  if (admins.length) await tx.notification.createMany({ data: admins.map((a) => ({ userId: a.id, ...payload })) })
}

// One review per completed owned booking. Locks serialize aggregates and account-level spam checks.
export async function createReview(req, res) {
  const data = reviewSchema.parse(req.body)
  const booking = await prisma.booking.findFirst({ where: { id: Number(req.params.id), parentId: req.parent.id } })
  if (!booking) throw new AppError(404, 'Booking not found')
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM ParentProfile WHERE id = ${req.parent.id} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${booking.tutorId} FOR UPDATE`
    const current = await tx.booking.findUnique({ where: { id: booking.id }, include: { review: true, tutor: { include: { user: true } } } })
    if (current.status !== 'COMPLETED') throw new AppError(400, 'You can only review a completed lesson')
    if (current.review) throw new AppError(409, 'You have already reviewed this lesson')
    const recent = await tx.review.findMany({ where: { parentId: req.parent.id, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } }, select: { comment: true } })
    if (recent.length >= 10) throw new AppError(429, 'You have submitted several reviews recently. Please wait before posting another review.')
    const fingerprint = reviewFingerprint(data.comment)
    if (fingerprint.length >= 40 && recent.filter((r) => reviewFingerprint(r.comment) === fingerprint).length >= 2) {
      throw new AppError(400, 'This review repeats your recent reviews. Please describe this particular lesson in your own words.')
    }
    const created = await tx.review.create({ data: { bookingId: booking.id, parentId: req.parent.id, tutorId: booking.tutorId, rating: data.rating, comment: data.comment || null, photoUrl: data.photoUrl || null } })
    const agg = await tx.review.aggregate({ where: { tutorId: booking.tutorId, isHidden: false }, _avg: { rating: true }, _count: { _all: true } })
    const avg = agg._avg.rating ?? 0
    const count = agg._count._all
    await tx.tutorProfile.update({ where: { id: booking.tutorId }, data: { ratingAvg: avg, ratingCount: count } })
    await tx.notification.create({ data: { userId: current.tutor.userId, type: 'NEW_REVIEW', title: 'You received a new review', message: `${req.user.fullName} rated you ${data.rating}/5.`, link: '/tutor' } })
    const setting = await tx.systemSetting.findUnique({ where: { key: 'RATING_THRESHOLD' } })
    const threshold = Number(setting?.value ?? 3)
    const beforeFlagged = current.tutor.ratingCount >= 3 && current.tutor.ratingAvg < threshold
    if (count >= 3 && avg < threshold && !beforeFlagged) {
      await notifyAdmins(tx, { type: 'TUTOR_FLAGGED', title: 'Tutor below rating threshold', message: `${current.tutor.user.fullName} now averages ${avg.toFixed(1)}. Please review.`, link: '/admin/users' })
    }
    return created
  }).catch((err) => {
    if (err.code === 'P2002') throw new AppError(409, 'You have already reviewed this lesson')
    throw err
  })
  res.status(201).json({ review: { id: result.id, rating: result.rating, comment: result.comment, photoUrl: result.photoUrl } })
}

export const REVIEW_REPORT_REASONS = ['Abusive or discriminatory content', 'Personal information', 'Spam or advertising', 'Misleading or unrelated content', 'Other']
const reportSchema = z.object({ reason: z.enum(REVIEW_REPORT_REASONS), details: z.string().trim().max(500).optional() })

// Reports remain private. Never attach another family's booking to the reporter's complaint.
export async function reportReview(req, res) {
  const data = reportSchema.parse(req.body)
  const review = await prisma.review.findFirst({ where: { id: Number(req.params.id), isHidden: false, tutor: { user: { status: 'ACTIVE' } } }, include: { parent: true } })
  if (!review) throw new AppError(404, 'Review not found')
  const complaint = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${req.user.id} FOR UPDATE`
    if (await tx.complaint.findFirst({ where: { filedById: req.user.id, reviewId: review.id } })) throw new AppError(409, 'You have already reported this review. Check My Complaints for updates.')
    const recent = await tx.complaint.count({ where: { filedById: req.user.id, reviewId: { not: null }, createdAt: { gte: new Date(Date.now() - 60 * 60_000) } } })
    if (recent >= 10) throw new AppError(429, 'You have submitted several reports recently. Please wait before reporting another review.')
    const created = await tx.complaint.create({ data: { filedById: req.user.id, againstUserId: review.parent.userId, reviewId: review.id, category: 'Review content', description: `${data.reason}${data.details ? ': ' + data.details : ''}` }, include: complaintInclude })
    await notifyAdmins(tx, { type: 'COMPLAINT_NEW', title: 'Review reported', message: 'A parent reported a public review. Please investigate before taking action.', link: '/admin/complaints' })
    return created
  }).catch((err) => {
    if (err.code === 'P2002') throw new AppError(409, 'You have already reported this review. Check My Complaints for updates.')
    throw err
  })
  res.status(201).json({ complaint: toComplaintDto(complaint) })
}
