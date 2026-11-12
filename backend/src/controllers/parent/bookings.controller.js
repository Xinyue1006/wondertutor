import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { assertChildFree, assertSlotBookable } from '../../services/booking.service.js'
import { bookingInclude, toBookingDto } from '../../services/booking.dto.js'
import { notify } from '../../services/notification.service.js'
import { requestReschedule as askReschedule, respondReschedule, withdrawReschedule } from '../../services/reschedule.service.js'
import { mytToDate, toMinutes } from '../../utils/time.js'
import { hhmm, id, ringgit, ymd } from '../../utils/validators.js'
import { SUBJECTS } from '../../data/catalog.js'
import { subjectsOf } from '../../utils/childSubjects.js'
import { recordReference, referenceWhere } from '../../utils/publicIds.js'

import { assertCanAccept, newPayBy } from '../../services/paymentWindow.js'
import { escalateBooking } from '../../services/tutorBooking.service.js'

export async function negotiate(req, res) {
  const b = await ownBooking(req)
  const data = z.discriminatedUnion('action', [
    z.object({ action: z.literal('counter'), price: ringgit('Hourly rate') }),
    z.object({ action: z.literal('escalate'), reason: z.string().trim().min(1).max(200) }),
  ]).parse(req.body)
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${b.tutorId} FOR UPDATE`
    const current = await tx.booking.findUnique({ where: { id: b.id } })
    if (current.updatedAt.getTime() !== b.updatedAt.getTime()) throw new AppError(409, 'Booking changed. Refresh and try again.')
    if (data.action === 'escalate') return escalateBooking(tx, b, req.user.id, data.reason)
    if (b.status !== 'COUNTER_OFFERED' || b.startAt <= new Date()) throw new AppError(409, 'This offer is no longer open.')
    if (data.price === Number(b.counterPrice)) throw new AppError(400, 'Accept the offer or choose a different price.')
    await changeStatus(tx, b, { status: 'PENDING', proposedPrice: data.price, counterPrice: null })
  })
  await notify(b.tutor.userId, { type: 'BOOKING_UPDATED', title: data.action === 'counter' ? 'Parent proposed a new rate' : 'Parent requested admin review',
    message: data.action === 'counter' ? 'New offer: RM' + data.price + ' per hour.' : data.reason, link: '/tutor/bookings?booking=' + b.id })
  res.json({ booking: toBookingDto(await reload(b.id)) })
}

const createSchema = z.object({
  tutorId: id('Tutor'),
  childId: recordReference('Child'),
  date: ymd('Choose a date').optional(),
  startTime: hhmm('Choose a time').optional(),
  slots: z.array(z.object({ date: ymd('Choose a date'), startTime: hhmm('Choose a time') })).min(1).max(12).optional(),
  teachingMode: z.enum(['ONLINE', 'PHYSICAL'], { message: 'Choose online or physical' }),
  proposedPrice: ringgit('Proposed price'),
  subject: z.enum(SUBJECTS, { message: 'Choose a subject from the list' }).optional(),
  messageToTutor: z.string().trim().max(200, 'Message must be 200 characters or fewer').optional(),
  isTrial: z.literal(false).optional(),
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
  if (data.slots && (data.date || data.startTime)) throw new AppError(400, 'Send slots or a single date and time')
  const slots = data.slots || (data.date && data.startTime ? [{ date: data.date, startTime: data.startTime }] : [])
  if (!slots.length) throw new AppError(400, 'Select at least one slot')
  if (new Set(slots.map(s => s.date + s.startTime)).size !== slots.length) throw new AppError(400, 'Duplicate slots are not allowed')
  if (slots.some(s => toMinutes(s.startTime) > 23 * 60)) throw new AppError(400, 'Lessons must finish on the selected date')
  slots.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))


  const child = await prisma.child.findFirst({ where: { ...referenceWhere(data.childId), parentId: req.parent.id } })
  if (!child) throw new AppError(404, 'Child not found')

  const tutor = await prisma.tutorProfile.findFirst({
    where: { id: data.tutorId, user: { status: 'ACTIVE' } },
    include: { subjects: true, user: true },
  })
  if (!tutor) throw new AppError(404, 'Tutor not found')
  if (data.teachingMode === 'ONLINE' && !tutor.offersOnline) throw new AppError(400, 'This tutor does not offer online lessons')
  if (data.teachingMode === 'PHYSICAL' && !tutor.offersPhysical) throw new AppError(400, 'This tutor does not offer physical lessons')

  // No subject chosen: the first of the child's subjects that this tutor teaches at the child's level, else the child's
  // first subject, else anything the tutor teaches at that level
  const atLevel = tutor.subjects.filter((s) => s.educationLevel === child.educationLevel && child.grade >= s.minGrade && child.grade <= s.maxGrade)
  const wanted = subjectsOf(child)
  const subject = data.subject || wanted.find((w) => atLevel.some((s) => s.subject === w)) || wanted[0] || atLevel[0]?.subject
  const teachesIt = tutor.subjects.some(
    (s) => s.subject === subject && s.educationLevel === child.educationLevel && child.grade >= s.minGrade && child.grade <= s.maxGrade,
  )
  if (!teachesIt) throw new AppError(400, `This tutor does not teach ${subject ?? 'that subject'} at your child's level`)

  // Lessons are 1 hour long (one cell of the availability grid)
  const bookings = await prisma.$transaction(async (tx) => {
    // Serialise requests for this child. Checking and inserting separately allowed
    // simultaneous browser requests to both pass the overlap/trial checks.
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${tutor.id} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM Child WHERE id = ${child.id} FOR UPDATE`


    const created = []
    for (const slot of slots) {
      const startAt = mytToDate(slot.date, slot.startTime)
      const endAt = new Date(startAt.getTime() + 3600000)
      await assertSlotBookable({ tutorId: tutor.id, startAt, endAt, teachingMode: data.teachingMode }, tx)
      await assertChildFree({ childId: child.id, startAt, endAt }, tx)
      created.push(await tx.booking.create({
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
          isTrial: false,
          messageToTutor: data.messageToTutor || null,
          proposedPrice: data.proposedPrice,
        },
        include: bookingInclude,
      }))
    }
    return created
  })

  await notify(tutor.userId, {
    type: 'BOOKING_REQUEST',
    title: 'New booking request',
    message: `${req.user.fullName} requested ${bookings.length} ${subject} lesson(s) for ${child.name}.`,
    link: '/tutor/bookings',
  })
  await notify(req.user.id, {
    type: 'BOOKING_SENT',
    title: `Booking request sent to ${tutor.user.fullName}`,
    message: `${subject} · ${child.educationLevel === 'SECONDARY' ? 'Form' : child.educationLevel === 'PRIMARY' ? 'Primary' : 'Kindergarten'} ${child.grade}`,
    link: '/parent/bookings',
  })

  res.status(201).json({ booking: toBookingDto(bookings[0]), bookings: bookings.map(toBookingDto) })
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
  await prisma.$transaction(async (tx) => {
    // Use the same resource order as booking creation and availability changes.
    // Two competing counter offers must not both reserve the tutor's last slot.
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${b.tutorId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM Child WHERE id = ${b.childId} FOR UPDATE`
    const tutor = await tx.tutorProfile.findFirst({ where: { id: b.tutorId, user: { status: 'ACTIVE' } } })
    if (!tutor) throw new AppError(409, 'This tutor is no longer available. Please choose another tutor.')
    await assertSlotBookable({ tutorId: b.tutorId, startAt: b.startAt, endAt: b.endAt, teachingMode: b.teachingMode }, tx)
    await assertChildFree({ childId: b.childId, startAt: b.startAt, endAt: b.endAt, ignoreBookingId: b.id }, tx)
    assertCanAccept(b.startAt)
    const changed = await tx.booking.updateMany({
      where: { id: b.id, status: b.status, counterPrice: b.counterPrice, startAt: b.startAt, endAt: b.endAt },
      data: { status: 'AWAITING_PAYMENT', agreedPrice: b.counterPrice, payBy: newPayBy(b.startAt) },
    })
    if (!changed.count) throw new AppError(409, 'This counter offer has changed. Please refresh the page and try again.')
  })
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
    // An administrator may have completed a refund, or the lesson may have
    // changed, after the form was loaded. Validate the locked state again.
    const payment = await tx.payment.findUnique({ where: { id: b.payment.id }, select: { status: true } })
    const current = await tx.booking.findUnique({ where: { id: b.id }, select: { status: true, startAt: true } })
    if (payment?.status !== 'PAID' || current?.status !== b.status || current.startAt.getTime() !== b.startAt.getTime())
      throw new AppError(409, 'This payment or lesson has changed. Please refresh before requesting a refund.')
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
