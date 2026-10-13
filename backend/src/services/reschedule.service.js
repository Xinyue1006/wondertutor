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

export const RESCHEDULABLE = ['AWAITING_PAYMENT', 'CONFIRMED']

const when = (d) =>
  new Date(d).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

// booking must include { parent: { userId }, tutor: { userId } }
const otherParty = (booking, userId) => (userId === booking.parent.userId ? booking.tutor.userId : booking.parent.userId)
const linkFor = (booking, userId) => (userId === booking.parent.userId ? `/parent/bookings?booking=${booking.id}` : '/tutor/bookings')

async function assertNewTimeOk(booking, startAt, endAt) {
  await assertSlotBookable({ tutorId: booking.tutorId, startAt, endAt, ignoreBookingId: booking.id })
  await assertChildFree({ childId: booking.childId, startAt, endAt, ignoreBookingId: booking.id })
}

export async function requestReschedule({ booking, byUserId, date, startTime, reason }) {
  if (!RESCHEDULABLE.includes(booking.status)) throw new AppError(400, 'Only upcoming lessons can be rescheduled')
  if (booking.startAt <= new Date()) throw new AppError(400, 'This lesson has already started')
  const pending = await prisma.rescheduleRequest.findFirst({ where: { bookingId: booking.id, status: 'PENDING' } })
  if (pending) throw new AppError(409, 'There is already a reschedule request waiting for an answer')

  const startAt = mytToDate(date, startTime)
  const endAt = new Date(startAt.getTime() + (booking.endAt - booking.startAt)) // same lesson length
  if (startAt.getTime() === booking.startAt.getTime()) throw new AppError(400, 'Choose a different time from the current one')
  await assertNewTimeOk(booking, startAt, endAt)

  const request = await prisma.rescheduleRequest.create({
    data: { bookingId: booking.id, requestedById: byUserId, newStartAt: startAt, newEndAt: endAt, reason: reason || null },
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
    // The new time was free when asked; check again in case something was booked since
    await assertNewTimeOk(booking, request.newStartAt, request.newEndAt)
    await prisma.$transaction([
      prisma.booking.update({ where: { id: booking.id }, data: { startAt: request.newStartAt, endAt: request.newEndAt } }),
      prisma.rescheduleRequest.update({ where: { id: request.id }, data: { status: 'APPROVED' } }),
    ])
    await notify(request.requestedById, {
      type: 'RESCHEDULE_APPROVED',
      title: 'Reschedule accepted',
      message: `The ${booking.subject} lesson has moved to ${when(request.newStartAt)}.`,
      link: linkFor(booking, request.requestedById),
    })
    return { status: 'APPROVED' }
  }

  // No mutual agreement: Admin decides. The lesson keeps its current time until then.
  await prisma.rescheduleRequest.update({ where: { id: request.id }, data: { status: 'ESCALATED' } })
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
  await prisma.rescheduleRequest.update({ where: { id: request.id }, data: { status: 'REJECTED' } })
  await notify(otherParty(booking, byUserId), {
    type: 'RESCHEDULE_WITHDRAWN',
    title: 'Reschedule withdrawn',
    message: `The request to move the ${booking.subject} lesson was withdrawn. It stays on ${when(booking.startAt)}.`,
    link: linkFor(booking, otherParty(booking, byUserId)),
  })
  return { status: 'REJECTED' }
}
