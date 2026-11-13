import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'

const schema = z.object({ isHidden: z.boolean(), expectedHidden: z.boolean(), reason: z.string().trim().min(3, 'Explain the moderation decision (at least 3 characters)').max(500) })

// Reporting does not automatically hide a review. An authenticated admin must investigate and record a reason.
export async function moderateReview(req, res) {
  const data = schema.parse(req.body)
  const id = Number(req.params.id)
  const found = await prisma.review.findUnique({ where: { id }, select: { tutorId: true } })
  if (!found) throw new AppError(404, 'Review not found')
  const review = await prisma.$transaction(async (tx) => {
    // Same lock as review creation: cached rating count/average remain consistent under concurrent moderation.
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${found.tutorId} FOR UPDATE`
    const current = await tx.review.findUnique({ where: { id }, include: { parent: true } })
    if (!current) throw new AppError(404, 'Review not found')
    if (current.isHidden !== data.expectedHidden) throw new AppError(409, 'This review was changed by another administrator. Refresh the complaint before trying again.')
    if (current.isHidden === data.isHidden) return current
    const updated = await tx.review.update({ where: { id }, data: { isHidden: data.isHidden, moderationReason: data.reason, moderatedAt: new Date(), moderatedById: req.user.id } })
    const agg = await tx.review.aggregate({ where: { tutorId: current.tutorId, isHidden: false }, _avg: { rating: true }, _count: { _all: true } })
    await tx.tutorProfile.update({ where: { id: current.tutorId }, data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count._all } })
    // This retains the action/reason for the author; the original review is never deleted or rewritten.
    await tx.notification.create({ data: { userId: current.parent.userId, type: 'REVIEW_MODERATED', title: data.isHidden ? 'Your review was hidden' : 'Your review was restored', message: `${data.isHidden ? 'An administrator hid your review from the public tutor profile' : 'An administrator restored your review to the public tutor profile'}. Reason: ${data.reason}`, link: '/parent/bookings?tab=completed' } })
    return updated
  })
  res.json({ review: { id: review.id, isHidden: review.isHidden, moderationReason: review.moderationReason, moderatedAt: review.moderatedAt } })
}
