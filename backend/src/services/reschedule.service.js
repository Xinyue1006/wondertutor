// Rescheduling a lesson (client rule: a reschedule needs MUTUAL agreement, otherwise it escalates to Admin).
//
//   one side asks for a new time  ->  PENDING
//   the other side accepts         ->  APPROVED  (the booking moves to the new time)
//   the other side declines        ->  ESCALATED (Admin is notified and decides; the booking keeps its time)
//   the asker withdraws            ->  REJECTED
//
// Used by the Parent Portal (and ready for the Tutor Portal): both sides call the same functions, so the rules can't drift.
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { notify } from './notification.service.js'
import { assertChildFree, assertSlotBookable } from './booking.service.js'
import { mytToDate } from '../utils/time.js'
import { publicReference } from '../utils/publicIds.js'

export const RESCHEDULABLE = ['AWAITING_PAYMENT', 'CONFIRMED']

const when = (d) =>
  new Date(d).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

// booking must include { parent: { userId }, tutor: { userId } }
const otherParty = (booking, userId) => (userId === booking.parent.userId ? booking.tutor.userId : booking.parent.userId)
const linkFor = (booking, userId) => (userId === booking.parent.userId ? `/parent/bookings?booking=${publicReference(booking)}` : '/tutor/bookings')

async function assertNewTimeOk(booking, startAt, endAt, db = prisma) {
  await assertSlotBookable({ tutorId: booking.tutorId, startAt, endAt, ignoreBookingId: booking.id, teachingMode: booking.teachingMode }, db)
  await assertChildFree({ childId: booking.childId, startAt, endAt, ignoreBookingId: booking.id }, db)
}

const stale = () => new AppError(409, 'This lesson or request has just changed. Please refresh and try again.')
async function answerPending(db, requestId, status) {
  const { count } = await db.rescheduleRequest.updateMany({ where: { id: requestId, status: 'PENDING' }, data: { status } })
  if (!count) throw stale()
}

export async function requestReschedule({ booking, byUserId, date, startTime, reason }) {
  if (!RESCHEDULABLE.includes(booking.status)) throw new AppError(400, 'Only upcoming lessons can be rescheduled')
  if (booking.startAt <= new Date()) throw new AppError(400, 'This lesson has already started')

  const startAt = mytToDate(date, startTime)
  const endAt = new Date(startAt.getTime() + (booking.endAt - booking.startAt)) // same lesson length
  if (startAt.getTime() === booking.startAt.getTime()) throw new AppError(400, 'Choose a different time from the current one')
  const request = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${booking.id} FOR UPDATE`
    const current = await tx.booking.findUnique({ where: { id: booking.id } })
    if (!current || current.status !== booking.status || current.startAt.getTime() !== booking.startAt.getTime() || current.startAt <= new Date()) throw stale()
    const open = await tx.rescheduleRequest.findFirst({ where: { bookingId: booking.id, status: { in: ['PENDING', 'ESCALATED'] } } })
    if (open) throw new AppError(409, open.status === 'ESCALATED'
      ? 'An administrator is reviewing the existing time change. Wait for their decision before requesting another change.'
      : 'There is already a reschedule request waiting for an answer')
    await assertNewTimeOk(booking, startAt, endAt, tx)
    return tx.rescheduleRequest.create({
      data: { bookingId: booking.id, requestedById: byUserId, newStartAt: startAt, newEndAt: endAt, reason: reason || null },
    })
  })
  const who = byUserId === booking.parent.userId ? 'The parent' : 'The tutor'
  const to = otherParty(booking, byUserId)
  await notify(to, {
    type: 'RESCHEDULE_REQUESTED',
    title: 'Reschedule requested',
    message: `${who} asked to move the ${booking.subject} lesson from ${when(booking.startAt)} to ${when(startAt)}.${reason ? ` Reason: ${reason}` : ''}`,
    link: linkFor(booking, to),
  })
  return request
}

export async function respondReschedule({ booking, requestId, byUserId, accept }) {
  const request = await prisma.rescheduleRequest.findFirst({ where: { id: requestId, bookingId: booking.id } })
  if (!request) throw new AppError(404, 'Reschedule request not found')
  if (request.status !== 'PENDING') throw new AppError(400, 'This request has already been answered')
  if (request.requestedById === byUserId) throw new AppError(403, 'The other side has to answer your request')

  if (accept) {
    if (!RESCHEDULABLE.includes(booking.status)) throw new AppError(400, 'This lesson can no longer be rescheduled')
    if (booking.startAt <= new Date()) throw new AppError(400, 'This lesson has already started and cannot be rescheduled')
    // The new time was free when asked; check again in case something was booked since
    await prisma.$transaction(async (tx) => {
      // Serialise ALL reservations for the tutor/child, not only answers to the
      // same request. Otherwise two separate lessons could move into one slot.
      await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${booking.tutorId} FOR UPDATE`
      await tx.$queryRaw`SELECT id FROM Child WHERE id = ${booking.childId} FOR UPDATE`
      const current = await tx.booking.findUnique({ where: { id: booking.id } })
      if (!current || current.status !== booking.status || current.startAt.getTime() !== booking.startAt.getTime() ||
          current.endAt.getTime() !== booking.endAt.getTime() || current.startAt <= new Date()) throw stale()
      await answerPending(tx, request.id, 'APPROVED')
      await assertNewTimeOk(booking, request.newStartAt, request.newEndAt, tx)
      const { count } = await tx.booking.updateMany({
        where: { id: booking.id, status: booking.status, startAt: booking.startAt, endAt: booking.endAt },
        data: { startAt: request.newStartAt, endAt: request.newEndAt },
      })
      if (!count) throw stale()
    })
    await notify(request.requestedById, {
      type: 'RESCHEDULE_APPROVED',
      title: 'Reschedule accepted',
      message: `The ${booking.subject} lesson has moved to ${when(request.newStartAt)}.`,
      link: linkFor(booking, request.requestedById),
    })
    return { status: 'APPROVED' }
  }

  // No mutual agreement: Admin decides. The lesson keeps its current time until then.
  await answerPending(prisma, request.id, 'ESCALATED')
  await notify(request.requestedById, {
    type: 'RESCHEDULE_ESCALATED',
    title: 'Reschedule declined',
    message: `The new time for the ${booking.subject} lesson was not accepted. Our admin team will review it and contact you. The lesson stays on ${when(booking.startAt)} for now.`,
    link: linkFor(booking, request.requestedById),
  })
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
  await Promise.all(admins.map((a) => notify(a.id, {
    type: 'RESCHEDULE_ESCALATED',
    title: 'Reschedule needs a decision',
    message: `Booking #${booking.id} (${booking.subject}): the parent and tutor did not agree on a new time (${when(request.newStartAt)}).`,
    link: '/admin/bookings',
  })))
  return { status: 'ESCALATED' }
}

export async function withdrawReschedule({ booking, requestId, byUserId }) {
  const request = await prisma.rescheduleRequest.findFirst({ where: { id: requestId, bookingId: booking.id } })
  if (!request) throw new AppError(404, 'Reschedule request not found')
  if (request.requestedById !== byUserId) throw new AppError(403, 'Only the person who asked can withdraw it')
  if (request.status !== 'PENDING') throw new AppError(400, 'This request has already been answered')
  await answerPending(prisma, request.id, 'REJECTED')
  await notify(otherParty(booking, byUserId), {
    type: 'RESCHEDULE_WITHDRAWN',
    title: 'Reschedule withdrawn',
    message: `The request to move the ${booking.subject} lesson was withdrawn. It stays on ${when(booking.startAt)}.`,
    link: linkFor(booking, otherParty(booking, byUserId)),
  })
  return { status: 'REJECTED' }
}
