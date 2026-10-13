import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { notify } from '../../services/notification.service.js'

const reviewSchema = z.object({
  rating: z.number({ message: 'Choose a rating' }).int('Choose a rating').min(1, 'Choose a rating').max(5, 'Rating is 1 to 5 stars'),
  comment: z.string().trim().max(500, 'Comment must be 500 characters or fewer').optional(),
})

// POST /parent/bookings/:id/review: one review per completed booking, parent -> tutor only
export async function createReview(req, res) {
  const data = reviewSchema.parse(req.body)
  const booking = await prisma.booking.findFirst({
    where: { id: Number(req.params.id), parentId: req.parent.id },
    include: { review: true, tutor: { include: { user: true } } },
  })
  if (!booking) throw new AppError(404, 'Booking not found')
  if (booking.status !== 'COMPLETED') throw new AppError(400, 'You can only review a completed lesson')
  if (booking.review) throw new AppError(409, 'You have already reviewed this lesson')

  const before = { avg: booking.tutor.ratingAvg, count: booking.tutor.ratingCount }
  const review = await prisma.$transaction(async (tx) => {
    const created = await tx.review.create({
      data: { bookingId: booking.id, parentId: req.parent.id, tutorId: booking.tutorId, rating: data.rating, comment: data.comment || null },
    })
    // Keep the tutor's average in sync so cards and sorting don't need to aggregate every time
    const agg = await tx.review.aggregate({ where: { tutorId: booking.tutorId }, _avg: { rating: true }, _count: { _all: true } })
    await tx.tutorProfile.update({
      where: { id: booking.tutorId },
      data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count._all },
    })
    return { created, avg: agg._avg.rating ?? 0, count: agg._count._all }
  }).catch((err) => {
    // Two submits at the same moment: the database allows one review per booking, so the second one lands here
    if (err.code === 'P2002') throw new AppError(409, 'You have already reviewed this lesson')
    throw err
  })

  await notify(booking.tutor.userId, {
    type: 'NEW_REVIEW',
    title: 'You received a new review',
    message: `${req.user.fullName} rated you ${data.rating}/5.`,
    link: '/tutor',
  })

  // Rating-threshold rule: a tutor whose average drops below the Admin-set threshold is flagged for review.
  // Admin is told once, when the tutor crosses the line, not again for every later low review.
  const setting = await prisma.systemSetting.findUnique({ where: { key: 'RATING_THRESHOLD' } })
  const threshold = Number(setting?.value ?? 3)
  const flagged = (r) => r.count >= 3 && r.avg < threshold
  if (flagged(review) && !flagged(before)) {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
    await Promise.all(
      admins.map((a) =>
        notify(a.id, {
          type: 'TUTOR_FLAGGED',
          title: 'Tutor below rating threshold',
          message: `${booking.tutor.user.fullName} now averages ${review.avg.toFixed(1)}. Please review.`,
          link: '/admin/users',
        }),
      ),
    )
  }

  res.status(201).json({ review: { id: review.created.id, rating: review.created.rating, comment: review.created.comment } })
}
