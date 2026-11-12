import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { publicReference } from '../utils/publicIds.js'
import { assertSlotBookable, assertChildFree } from './booking.service.js'
import { newPayBy, assertCanAccept } from './paymentWindow.js'
import { notify, notifyWithEmail } from './notification.service.js'

const include = {
  parent: { select: { userId: true, user: { select: { id: true, fullName: true, email: true, createdAt: true } },
    _count: { select: { bookings: { where: { status: 'COMPLETED' } } } } } },
  tutor: { select: { userId: true } },
  child: { select: { name: true, grade: true, educationLevel: true } },
  reschedules: { orderBy: { createdAt: 'desc' }, take: 1 },
}

export async function ownBooking(tutorId, id, db = prisma) {
  const b = await db.booking.findFirst({ where: { tutorId, id }, include })
  if (!b) throw new AppError(404, 'Booking not found')
  return b
}

export function tutorBooking(b) {
  const r = b.reschedules[0]
  return {
    id: b.id, subject: b.subject, parentName: b.parent.user.fullName, child: b.child,
    parentSince: b.parent.user.createdAt, completedLessons: b.parent._count.bookings,
    startAt: b.startAt, endAt: b.endAt, status: b.status, teachingMode: b.teachingMode,
    proposedPrice: Number(b.proposedPrice), counterPrice: b.counterPrice, agreedPrice: b.agreedPrice,
    messageToTutor: b.messageToTutor, location: b.location, meetingLink: b.meetingLink,
    rejectionReason: b.rejectionReason, cancelReason: b.cancelReason, payBy: b.payBy, updatedAt: b.updatedAt,
    reschedule: r && { id: r.id, status: r.status, startAt: r.newStartAt, reason: r.reason, mine: r.requestedById === b.tutor.userId },
  }
}

export async function listBookings(tutorId) {
  const rows = await prisma.booking.findMany({ where: { tutorId }, include, orderBy: { startAt: 'asc' } })
  return rows.map(tutorBooking)
}

export async function checkOfferTime(tx, b) {
  try {
    await assertSlotBookable({ ...b, ignoreBookingId: b.id }, tx)
  } catch (err) {
    if (err instanceof AppError) throw new AppError(409, 'You are no longer available at this time.')
    throw err
  }
  await assertChildFree({ ...b, ignoreBookingId: b.id }, tx)
}

export async function escalateBooking(tx, b, userId, reason) {
  const category = ['PENDING', 'COUNTER_OFFERED'].includes(b.status) ? 'Fee negotiation' : 'Booking cancellation'
  if (!['PENDING', 'COUNTER_OFFERED', 'CANCELLED', 'CONFIRMED', 'AWAITING_PAYMENT'].includes(b.status)) throw new AppError(409, 'This booking cannot be escalated.')
  const where = { bookingId: b.id, category, status: { in: ['OPEN', 'IN_PROGRESS'] } }
  if (await tx.complaint.findFirst({ where })) throw new AppError(409, 'Admin is already reviewing this issue.')
  await tx.complaint.create({ data: { bookingId: b.id, filedById: userId, category, description: reason } })
  const admins = await tx.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
  if (admins.length) await tx.notification.createMany({ data: admins.map(a => ({ userId: a.id, type: 'BOOKING_ESCALATED', title: category + ' needs review', message: reason, link: '/admin/complaints' })) })
}

export async function tutorAction(tutorId, id, input) {
  const { action, reason } = input
  const first = await ownBooking(tutorId, id)
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${tutorId} FOR UPDATE`
    // Take both reservation locks before the first consistent read in this transaction.
    if (action === 'accept' || action === 'counter') await tx.$queryRaw`SELECT id FROM Child WHERE id = ${first.childId} FOR UPDATE`
    const b = await ownBooking(tutorId, id, tx)
    if (b.updatedAt.toISOString() !== input.version) throw new AppError(409, 'This booking changed. Refresh before responding.')
    if (action === 'escalate') {
      await escalateBooking(tx, b, b.tutor.userId, reason)
      return { b, title: 'Tutor requested admin review', message: reason }
    }
    let data, title, message
    if (['accept', 'counter', 'decline'].includes(action)) {
      if (b.status !== 'PENDING') throw new AppError(409, 'This request has already been answered.')
      if (action !== 'decline') {
        await checkOfferTime(tx, b)
        assertCanAccept(b.startAt)
      }
      if (action === 'accept') {
        data = { status: 'AWAITING_PAYMENT', agreedPrice: b.proposedPrice, payBy: newPayBy(b.startAt) }
        title = 'Tutor accepted your request'
        message = 'Pay to confirm your ' + b.subject + ' lesson.'
      } else if (action === 'counter') {
        if (input.price === Number(b.proposedPrice)) throw new AppError(400, 'Choose a different hourly rate or accept the offer.')
        data = { status: 'COUNTER_OFFERED', counterPrice: input.price }
        title = 'Tutor proposed a different rate'
        message = 'Your tutor offered RM' + input.price + ' per hour for ' + b.subject + '.'
      } else {
        data = { status: 'REJECTED', rejectionReason: reason }
        title = 'Tutor declined your request'
        message = reason
      }
    } else if (action === 'link') {
      if (b.teachingMode !== 'ONLINE' || !['AWAITING_PAYMENT', 'CONFIRMED'].includes(b.status) || b.endAt <= new Date()) throw new AppError(409, 'Only active online lessons can have a class link.')
      data = { meetingLink: input.url }
      title = 'Online class link updated'
      message = 'Your class link is available in the confirmed lesson details.'
    } else {
      if (!['AWAITING_PAYMENT', 'CONFIRMED'].includes(b.status) || b.startAt <= new Date()) throw new AppError(409, 'This lesson can no longer be cancelled.')
      data = { status: 'CANCELLED', cancelReason: reason, cancelledById: b.tutor.userId }
      title = 'Tutor cancelled your lesson'
      message = reason
    }
    const changed = await tx.booking.updateMany({ where: { id, tutorId, updatedAt: b.updatedAt, status: b.status }, data })
    if (!changed.count) throw new AppError(409, 'This booking changed. Refresh before responding.')
    if (action === 'cancel') {
      await tx.payment.updateMany({ where: { bookingId: id, status: 'PENDING' }, data: { status: 'FAILED' } })
      const paid = await tx.payment.findFirst({ where: { bookingId: id, status: 'PAID' } })
      if (paid) await tx.refund.create({ data: { paymentId: paid.id, amount: paid.amount, type: 'AUTO', reason } })
      await tx.rescheduleRequest.updateMany({ where: { bookingId: id, status: 'PENDING' }, data: { status: 'REJECTED' } })
    }
    return { b, title, message }
  })
  const { b, title, message } = result
  const payload = { title, message, type: 'TUTOR_' + action.toUpperCase(), link: '/parent/bookings?booking=' + publicReference(b) }
  if (action === 'accept' || action === 'cancel') await notifyWithEmail(b.parent.user, payload)
  else if (action !== 'link' || b.status === 'CONFIRMED') await notify(b.parent.userId, payload)
}
