import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { assertChildFree, assertSlotBookable } from '../../services/booking.service.js'
import { bookingInclude, toBookingDto } from '../../services/booking.dto.js'
import { notify } from '../../services/notification.service.js'
import { requestReschedule as askReschedule, respondReschedule, withdrawReschedule } from '../../services/reschedule.service.js'
import { fromMinutes, mytToDate, toMinutes } from '../../utils/time.js'
import { hhmm, id, ringgit, ymd } from '../../utils/validators.js'
import { SUBJECTS } from '../../data/catalog.js'

const createSchema = z.object({
  tutorId: id('Tutor'),
  childId: id('Child'),
  date: ymd('Choose a date'),
  startTime: hhmm('Choose a time'),
  teachingMode: z.enum(['ONLINE', 'PHYSICAL'], { message: 'Choose online or physical' }),
  proposedPrice: ringgit('Proposed price'),
  subject: z.enum(SUBJECTS, { message: 'Choose a subject from the list' }).optional(),
  messageToTutor: z.string().trim().max(200, 'Message must be 200 characters or fewer').optional(),
  isTrial: z.boolean().optional(),
})

// Loads a booking only if it belongs to the logged-in parent
async function ownBooking(req) {
  const booking = await prisma.booking.findFirst({
    where: { id: Number(req.params.id), parentId: req.parent.id },
    include: bookingInclude,
  })
  if (!booking) throw new AppError(404, 'Booking not found')
  return booking
}

// Changes a booking only if it is still in the status it was loaded in. If the tutor, the expiry scheduler or a
// second click changed it in the meantime, nothing is written and the parent is asked to refresh, so an action
// can never be applied twice or to a booking that has already moved on.
async function changeStatus(db, booking, data) {
  const { count } = await db.booking.updateMany({ where: { id: booking.id, status: booking.status }, data })
  if (!count) throw new AppError(409, 'This booking has just been updated. Please refresh the page and try again.')
}

const reload = (id) => prisma.booking.findUnique({ where: { id }, include: bookingInclude })

// Locks the payment row until the transaction ends, then counts its open refund requests. Two refund requests sent
// at the same moment (double click, two tabs) are handled one after the other, so only the first one is created.
async function lockPaymentAndCountOpenRefunds(tx, paymentId) {
  await tx.$queryRaw`SELECT id FROM Payment WHERE id = ${paymentId} FOR UPDATE`
  return tx.refund.count({ where: { paymentId, status: { in: ['PENDING', 'APPROVED'] } } })
}

// POST /parent/bookings: send a booking request (PENDING)
export async function createBooking(req, res) {
  const data = createSchema.parse(req.body)

  const child = await prisma.child.findFirst({ where: { id: data.childId, parentId: req.parent.id } })
  if (!child) throw new AppError(404, 'Child not found')

  const tutor = await prisma.tutorProfile.findFirst({
    where: { id: data.tutorId, user: { status: 'ACTIVE' } },
    include: { subjects: true, user: true },
  })
  if (!tutor) throw new AppError(404, 'Tutor not found')
  if (data.teachingMode === 'ONLINE' && !tutor.offersOnline) throw new AppError(400, 'This tutor does not offer online lessons')
  if (data.teachingMode === 'PHYSICAL' && !tutor.offersPhysical) throw new AppError(400, 'This tutor does not offer physical lessons')

  const subject = data.subject || child.subject || tutor.subjects.find((s) => s.educationLevel === child.educationLevel)?.subject
  const teachesIt = tutor.subjects.some(
    (s) => s.subject === subject && s.educationLevel === child.educationLevel && child.grade >= s.minGrade && child.grade <= s.maxGrade,
  )
  if (!teachesIt) throw new AppError(400, `This tutor does not teach ${subject ?? 'that subject'} at your child's level`)

  // Lessons are 1 hour long (one cell of the availability grid)
  const startAt = mytToDate(data.date, data.startTime)
  const endAt = mytToDate(data.date, fromMinutes(toMinutes(data.startTime) + 60))
  await assertSlotBookable({ tutorId: tutor.id, startAt, endAt })
  await assertChildFree({ childId: child.id, startAt, endAt })

  // A trial is the child's first lesson with this tutor (paid like any lesson, only marked so both sides know)
  if (data.isTrial) {
    const before = await prisma.booking.count({ where: { childId: child.id, tutorId: tutor.id, status: { notIn: ['REJECTED', 'CANCELLED'] } } })
    if (before) throw new AppError(400, `${child.name} has already had a lesson booked with this tutor, so this cannot be a trial lesson`)
  }

  const booking = await prisma.booking.create({
    data: {
      parentId: req.parent.id,
      childId: child.id,
      tutorId: tutor.id,
      subject,
      startAt,
      endAt,
      teachingMode: data.teachingMode,
      location: data.teachingMode === 'PHYSICAL' ? req.parent.address || tutor.location : null,
      latitude: data.teachingMode === 'PHYSICAL' ? req.parent.latitude : null,
      longitude: data.teachingMode === 'PHYSICAL' ? req.parent.longitude : null,
      isTrial: data.isTrial ?? false,
      messageToTutor: data.messageToTutor || null,
      proposedPrice: data.proposedPrice,
    },
    include: bookingInclude,
  })

  await notify(tutor.userId, {
    type: 'BOOKING_REQUEST',
    title: 'New booking request',
    message: `${req.user.fullName} requested a ${subject} lesson for ${child.name}.`,
    link: '/tutor/bookings',
  })
  await notify(req.user.id, {
    type: 'BOOKING_SENT',
    title: `Booking request sent to ${tutor.user.fullName}`,
    message: `${subject} · ${child.educationLevel === 'SECONDARY' ? 'Form' : child.educationLevel === 'PRIMARY' ? 'Primary' : 'Kindergarten'} ${child.grade}`,
    link: '/parent/bookings',
  })

  res.status(201).json({ booking: toBookingDto(booking) })
}

// GET /parent/bookings
export async function listBookings(req, res) {
  const bookings = await prisma.booking.findMany({
    where: { parentId: req.parent.id },
    include: bookingInclude,
    orderBy: { startAt: 'desc' },
  })
  res.json({ bookings: bookings.map(toBookingDto) })
}

// GET /parent/bookings/:id
export async function getBooking(req, res) {
  res.json({ booking: toBookingDto(await ownBooking(req)) })
}

// POST /parent/bookings/:id/accept-counter: parent agrees to the tutor's price, then must pay
export async function acceptCounter(req, res) {
  const b = await ownBooking(req)
  if (b.status !== 'COUNTER_OFFERED' || b.counterPrice == null) throw new AppError(400, 'There is no counter offer to accept')
  await assertSlotBookable({ tutorId: b.tutorId, startAt: b.startAt, endAt: b.endAt })
  await changeStatus(prisma, b, { status: 'AWAITING_PAYMENT', agreedPrice: b.counterPrice })
  const updated = await reload(b.id)
  await notify(b.tutor.userId, {
    type: 'COUNTER_ACCEPTED',
    title: 'Counter offer accepted',
    message: `${req.user.fullName} accepted your counter offer. Waiting for payment.`,
    link: '/tutor/bookings',
  })
  res.json({ booking: toBookingDto(updated) })
}

// POST /parent/bookings/:id/decline-counter
export async function declineCounter(req, res) {
  const b = await ownBooking(req)
  if (b.status !== 'COUNTER_OFFERED') throw new AppError(400, 'There is no counter offer to decline')
  await changeStatus(prisma, b, { status: 'CANCELLED', cancelReason: 'Parent declined the counter offer', cancelledById: req.user.id })
  const updated = await reload(b.id)
  await notify(b.tutor.userId, {
    type: 'COUNTER_DECLINED',
    title: 'Counter offer declined',
    message: `${req.user.fullName} declined your counter offer.`,
    link: '/tutor/bookings',
  })
  res.json({ booking: toBookingDto(updated) })
}

// POST /parent/bookings/:id/refund-request
// Parent-initiated refunds (dissatisfaction, disputed attendance) are never automatic: they go to Admin review.
// The refund percentage is decided by the Admin, so the request only states the reason.
// A COMPLETED lesson whose attendance the parent disputes ("the lesson did not happen as recorded") is also marked
// DISPUTED, so it is clearly escalated to Admin and cannot be reviewed as a normal finished lesson in the meantime.
export async function requestRefund(req, res) {
  const { reason, attendanceDispute } = z
    .object({
      reason: z.string().trim().min(10, 'Please explain why you are asking for a refund (at least 10 characters)').max(300),
      attendanceDispute: z.boolean().optional(),
    })
    .parse(req.body)
  const b = await ownBooking(req)
  if (!b.payment || b.payment.status !== 'PAID') throw new AppError(400, 'Only paid lessons can be refunded')
  if (!['CONFIRMED', 'COMPLETED'].includes(b.status)) throw new AppError(400, 'This booking is not eligible for a refund request')
  // Money back for a lesson that has not started yet goes through Cancel (which also sends the refund to Admin),
  // so a lesson can never stay booked while its refund is being processed
  if (b.status === 'CONFIRMED' && b.startAt > new Date())
    throw new AppError(400, 'This lesson has not started yet. To get your money back, cancel the booking instead.')
  const alreadyAsked = () => new AppError(409, 'A refund request for this lesson is already being handled')
  if (b.payment.refunds.some((r) => r.status === 'PENDING' || r.status === 'APPROVED')) throw alreadyAsked()

  const disputing = attendanceDispute && b.status === 'COMPLETED'
  await prisma.$transaction(async (tx) => {
    if (await lockPaymentAndCountOpenRefunds(tx, b.payment.id)) throw alreadyAsked()
    await tx.refund.create({
      data: { paymentId: b.payment.id, amount: b.payment.amount, type: 'ADMIN_REVIEW', reason: disputing ? `Attendance disputed: ${reason}` : reason },
    })
    if (disputing) await changeStatus(tx, b, { status: 'DISPUTED' })
  })
  if (disputing) {
    await notify(b.tutor.userId, { type: 'BOOKING_DISPUTED', title: 'Lesson disputed', message: `The parent disputed the attendance for the ${b.subject} lesson. Our admin team will review it.`, link: '/tutor/bookings' })
  }
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
  await Promise.all(
    admins.map((a) => notify(a.id, {
      type: disputing ? 'BOOKING_DISPUTED' : 'REFUND_REQUEST',
      title: disputing ? 'Attendance disputed' : 'New refund request',
      message: `${req.user.fullName} ${disputing ? 'disputed the attendance and' : ''} requested a refund for ${b.subject} (RM ${Number(b.payment.amount).toFixed(2)}).`.replace('  ', ' '),
      link: disputing ? '/admin/bookings' : '/admin/finance',
    })),
  )
  await notify(req.user.id, { type: 'REFUND_REQUESTED', title: 'Refund request sent', message: 'Our team will review it and update you.', link: '/parent/payments' })
  res.status(201).json({ booking: toBookingDto(await ownBooking(req)) })
}

// POST /parent/bookings/:id/cancel
//  - before payment: just cancels the request (nothing to refund)
//  - after payment: parent-initiated cancellation => refund goes to Admin for review (never automatic)
export async function cancelBooking(req, res) {
  const { reason } = z.object({ reason: z.string().trim().max(200).optional() }).parse(req.body ?? {})
  const b = await ownBooking(req)
  if (!['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT', 'CONFIRMED'].includes(b.status))
    throw new AppError(400, 'This booking can no longer be cancelled')
  if (b.status === 'CONFIRMED' && b.startAt <= new Date()) throw new AppError(400, 'This lesson has already started')

  await prisma.$transaction(async (tx) => {
    await changeStatus(tx, b, { status: 'CANCELLED', cancelReason: reason || 'Cancelled by parent', cancelledById: req.user.id })
    // A paid lesson goes to Admin for a refund decision, unless a refund request for it is already open
    if (b.status === 'CONFIRMED' && b.payment?.status === 'PAID' && !(await lockPaymentAndCountOpenRefunds(tx, b.payment.id))) {
      await tx.refund.create({
        data: { paymentId: b.payment.id, amount: b.payment.amount, type: 'ADMIN_REVIEW', reason: reason || 'Parent cancelled the booking' },
      })
    }
    // A checkout that was started but not finished can never be completed for a cancelled lesson
    if (b.payment?.status === 'PENDING') await tx.payment.update({ where: { id: b.payment.id }, data: { status: 'FAILED' } })
  })
  const updated = await reload(b.id)

  await notify(b.tutor.userId, {
    type: 'BOOKING_CANCELLED',
    title: 'Booking cancelled',
    message: `${req.user.fullName} cancelled the ${b.subject} lesson.`,
    link: '/tutor/bookings',
  })
  res.json({ booking: toBookingDto(updated) })
}

// ───────────── Reschedule (mutual agreement, otherwise Admin decides) ─────────────
// bookingInclude carries both user ids (parent.userId, tutor.userId), which the service needs to notify the right person
const withParties = ownBooking

const reloadDto = async (id) => toBookingDto(await reload(id))

// POST /parent/bookings/:id/reschedule { date, startTime, reason? }
export async function requestReschedule(req, res) {
  const data = z
    .object({
      date: ymd('Choose a date'),
      startTime: hhmm('Choose a time'),
      reason: z.string().trim().max(200, 'Reason must be 200 characters or fewer').optional(),
    })
    .parse(req.body)
  const booking = await withParties(req)
  await askReschedule({ booking, byUserId: req.user.id, ...data })
  res.status(201).json({ booking: await reloadDto(booking.id) })
}

// POST /parent/bookings/:id/reschedule/:requestId/accept | decline | withdraw
export async function answerReschedule(req, res) {
  const booking = await withParties(req)
  const requestId = Number(req.params.requestId)
  const action = req.params.action
  if (action === 'withdraw') await withdrawReschedule({ booking, requestId, byUserId: req.user.id })
  else if (action === 'accept' || action === 'decline') await respondReschedule({ booking, requestId, byUserId: req.user.id, accept: action === 'accept' })
  else throw new AppError(404, 'Unknown action')
  res.json({ booking: await reloadDto(booking.id) })
}
