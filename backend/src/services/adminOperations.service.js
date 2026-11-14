import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { publicReference } from '../utils/publicIds.js'
import { baseCommission } from './systemSettings.service.js'
import { assertSlotBookable, assertChildFree } from './booking.service.js'
import { assertCanAccept, newPayBy, paymentDeadline } from './paymentWindow.js'
import { renderEmail } from './notification.service.js'
import { sendEmail } from './email.service.js'

const lockTutor = (tx, id) => tx.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${id} FOR UPDATE`
const stale = () => new AppError(409, 'This record has changed. Refresh and review the current details.')
const zero = new Prisma.Decimal(0)
const person = { select: { user: { select: { id: true, fullName: true, email: true } } } }
const parties = { parent: person, tutor: person }
async function mail(user, payload) {
  try { await sendEmail({ to: user.email, subject: 'WonderTutor — ' + payload.title, html: renderEmail({ ...payload, name: user.fullName }) }) }
  catch { console.error('Decision email could not be delivered') }
}

export async function listRates() {
  const [base, tutors] = await Promise.all([baseCommission(prisma), prisma.tutorProfile.findMany({
    select: { id: true, user: { select: { fullName: true } }, hourlyRate: true, commissionRate: true,
      rateHistory: { orderBy: { id: 'desc' } } }, orderBy: { user: { fullName: 'asc' } },
  })])
  return { base, tutors: tutors.map(t => ({ id: t.id, name: t.user.fullName, hourly: t.hourlyRate,
    commission: t.commissionRate ?? base, history: t.rateHistory })) }
}

export async function setRate(tutorId, admin, input) {
  const result = await prisma.$transaction(async tx => {
    await lockTutor(tx, tutorId)
    const tutor = await tx.tutorProfile.findUnique({ where: { id: tutorId }, include: { user: true } })
    if (!tutor) throw new AppError(404, 'Tutor not found')
    const commission = input.kind === 'COMMISSION'
    const field = commission ? 'commissionRate' : 'hourlyRate'
    const previous = new Prisma.Decimal(tutor[field] ?? await baseCommission(tx))
    if (!previous.eq(input.previous)) throw stale()
    if (previous.eq(input.rate)) throw new AppError(400, 'Enter a different rate.')
    await tx.tutorProfile.update({ where: { id: tutorId }, data: { [field]: input.rate } })
    await tx.tutorRateChange.create({ data: { tutorId, ...input, previous, changedBy: admin.fullName, adminId: admin.id } })
    const payload = { title: commission ? 'Commission rate changed' : 'Hourly salary rate changed',
      message: (commission ? input.rate + '%' : 'RM ' + input.rate + ' per hour') + ' takes effect now. ' + input.reason,
      link: commission ? '/tutor/earnings' : '/tutor/setup', type: 'RATE_UPDATED' }
    await tx.notification.create({ data: { userId: tutor.userId, ...payload } })
    return { user: tutor.user, payload }
  })
  await mail(result.user, result.payload)
}

const relatedCases = ['Fee negotiation', 'Booking cancellation']
export async function bookingOverview() {
  const rows = await prisma.booking.findMany({ include: { ...parties, child: { select: { name: true } },
    reschedules: { where: { status: 'ESCALATED' } },
    complaints: { where: { category: { in: relatedCases }, status: { in: ['OPEN','IN_PROGRESS'] } } },
    attendance: { select: { checkInAt: true, checkOutAt: true, checkInDistance: true } },
  }, orderBy: { startAt: 'desc' } })
  return rows.map(b => ({ id: b.id, parent: b.parent.user.fullName, tutor: b.tutor.user.fullName, student: b.child.name, subject: b.subject,
    startAt: b.startAt, endAt: b.endAt, status: b.status, mode: b.teachingMode, offered: b.proposedPrice, counter: b.counterPrice, agreed: b.agreedPrice,
    attendance: b.attendance, version: b.updatedAt, cases: [
      ...b.reschedules.map(x => ({ id: x.id, kind: 'Schedule change', reason: x.reason, proposed: x.newStartAt })),
      ...b.complaints.map(x => ({ id: x.id, kind: x.category, reason: x.description })),
    ] }))
}

export async function decideBooking(id, adminId, input) {
  const ids = await prisma.booking.findUnique({ where: { id }, select: { tutorId: true, childId: true } })
  if (!ids) throw new AppError(404, 'Booking not found')
  await prisma.$transaction(async tx => {
    await lockTutor(tx, ids.tutorId)
    await tx.$queryRaw`SELECT id FROM Child WHERE id = ${ids.childId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM Booking WHERE id = ${id} FOR UPDATE`
    const b = await tx.booking.findUniqueOrThrow({ where: { id }, include: { ...parties, payment: true } })
    if (b.updatedAt.toISOString() !== input.version) throw stale()
    const schedule = input.kind === 'Schedule change'
    const issue = schedule ? await tx.rescheduleRequest.findFirst({ where: { id: input.caseId, bookingId: id, status: 'ESCALATED' } }) :
      await tx.complaint.findFirst({ where: { id: input.caseId, bookingId: id, category: input.kind, status: { in: ['OPEN','IN_PROGRESS'] } } })
    if (!issue) throw stale()
    let outcome = 'Keep current booking'
    if (input.action === 'move' || input.action === 'set-fee') {
      const move = input.action === 'move'
      if (move ? !schedule || !['CONFIRMED','AWAITING_PAYMENT'].includes(b.status) : input.kind !== 'Fee negotiation' || !['PENDING','COUNTER_OFFERED'].includes(b.status)) throw stale()
      if (b.startAt <= new Date() || (b.status === 'AWAITING_PAYMENT' && paymentDeadline(b) <= new Date())) throw new AppError(409, 'This lesson or payment hold has expired.')
      const slot = { tutorId: b.tutorId, childId: b.childId, ignoreBookingId: id, teachingMode: b.teachingMode,
        startAt: move ? issue.newStartAt : b.startAt, endAt: move ? issue.newEndAt : b.endAt }
      await assertSlotBookable(slot, tx)
      await assertChildFree(slot, tx)
      if (!move || b.status === 'AWAITING_PAYMENT') assertCanAccept(slot.startAt)
      await tx.booking.update({ where: { id }, data: move ? { startAt: slot.startAt, endAt: slot.endAt } :
        { agreedPrice: input.price, status: 'AWAITING_PAYMENT', payBy: newPayBy(b.startAt) } })
      outcome = move ? 'Schedule change approved' : 'Final fee: RM ' + input.price + ' per hour. Payment required'
    } else if (input.action === 'cancel') {
      if (!['PENDING','COUNTER_OFFERED','AWAITING_PAYMENT','CONFIRMED'].includes(b.status) || b.startAt <= new Date()) throw stale()
      await tx.booking.update({ where: { id }, data: { status: 'CANCELLED', cancelledById: adminId, cancelReason: input.reason } })
      await tx.payment.updateMany({ where: { bookingId: id, status: 'PENDING' }, data: { status: 'FAILED' } })
      if (['PAID', 'PARTIALLY_REFUNDED'].includes(b.payment?.status)) {
        const refunds = await tx.refund.findMany({ where: { paymentId: b.payment.id } })
        const reserved = refunds.filter(r => r.status === 'APPROVED').reduce((sum, r) => sum.plus(r.amount), zero)
        const remaining = b.payment.amount.minus(reserved)
        if (remaining.gt(0) && !refunds.some(r => ['PENDING', 'ESCALATED'].includes(r.status))) {
          await tx.refund.create({ data: { paymentId: b.payment.id, amount: remaining, type: 'ADMIN_REVIEW', reason: input.reason } })
        }
      }
      await tx.rescheduleRequest.updateMany({ where: { bookingId: id, status: { in: ['PENDING', 'ESCALATED'] } }, data: { status: 'REJECTED' } })
      outcome = 'Booking cancelled'
    }
    const message = outcome + '. ' + input.reason
    if (schedule) await tx.rescheduleRequest.update({ where: { id: issue.id }, data: { status: input.action === 'move' ? 'APPROVED' : 'REJECTED' } })
    else {
      const closed = await tx.complaint.updateMany({ where: { id: issue.id, status: issue.status, updatedAt: issue.updatedAt },
        data: { status: 'RESOLVED', handledById: adminId, adminResponse: message } })
      if (!closed.count) throw stale()
    }
    for (const [user, link] of [[b.parent.user, '/parent/bookings?booking=' + publicReference(b)], [b.tutor.user, '/tutor/bookings?booking=' + id]]) {
      await tx.notification.create({ data: { userId: user.id, type: 'BOOKING_DECISION', title: 'Admin decision on ' + b.subject, message, link } })
    }
  })
}

export async function refundQueue() {
  const rows = await prisma.refund.findMany({ where: { OR: [{ status: { in: ['PENDING', 'ESCALATED'] } }, { status: 'APPROVED', issuedAt: null }] },
    include: { payment: { include: { booking: { include: parties } } } }, orderBy: { id: 'asc' } })
  return rows.filter(r => r.status !== 'APPROVED' || r.reviewNote || r.payment.status === 'PAID').map(r => ({ id: r.id, bookingId: r.payment.bookingId, parent: r.payment.booking.parent.user.fullName,
    reason: r.reason, type: r.type, status: r.status, amount: r.amount, paid: r.payment.amount, decision: r.reviewNote }))
}

export async function decideRefund(id, adminId, input) {
  const ref = await prisma.refund.findUnique({ where: { id }, select: { paymentId: true, payment: { select: { booking: { select: { tutorId: true } } } } } })
  if (!ref) throw new AppError(404, 'Refund not found')
  const result = await prisma.$transaction(async tx => {
    await lockTutor(tx, ref.payment.booking.tutorId)
    await tx.$queryRaw`SELECT id FROM Payment WHERE id = ${ref.paymentId} FOR UPDATE`
    const r = await tx.refund.findUniqueOrThrow({ where: { id }, include: { payment: { include: { booking: { include: parties }, refunds: true } } } })
    const p = r.payment, b = p.booking
    const issue = input.action === 'issued'
    const transferred = x => x.issuedAt || (x.status === 'APPROVED' && !x.reviewNote && ['REFUNDED','PARTIALLY_REFUNDED'].includes(p.status))
    if (transferred(r) || (issue ? r.status !== 'APPROVED' : !['PENDING', 'ESCALATED'].includes(r.status))) throw stale()
    const approved = p.refunds.filter(x => x.id !== id && x.status === 'APPROVED').reduce((n,x) => n.plus(x.amount), zero)
    const amount = input.action === 'approve' ? new Prisma.Decimal(input.amount) : r.amount
    if (input.action !== 'reject' && (!['PAID','PARTIALLY_REFUNDED'].includes(p.status) || amount.gt(r.amount) || amount.plus(approved).gt(p.amount))) throw new AppError(409, 'Amount exceeds the refundable payment.')
    if (issue) {
      const issued = p.refunds.filter(transferred).reduce((n,x) => n.plus(x.amount), amount)
      try {
        await tx.refund.update({ where: { id }, data: { issuedAt: new Date(), transferRef: input.reference } })
      } catch (err) {
        if (err.code === 'P2002') throw new AppError(409, 'This transfer reference has already been recorded.')
        throw err
      }
      await tx.payment.update({ where: { id: p.id }, data: { status: issued.eq(p.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } })
    } else {
      await tx.refund.update({ where: { id }, data: { status: input.action === 'approve' ? 'APPROVED' : 'REJECTED',
        amount, reviewedAt: new Date(), reviewedById: adminId, reviewNote: input.reason } })
    }
    if (b.status === 'DISPUTED' && (issue || input.action === 'reject')) await tx.booking.update({ where: { id: b.id }, data: { status: 'COMPLETED' } })
    const title = issue ? 'Refund transfer recorded' : input.action === 'approve' ? 'Refund approved' : 'Refund rejected'
    const message = b.subject + ' · RM ' + amount.toFixed(2) + '. ' + (issue ? 'Transfer reference: ' + input.reference : input.reason)
    const payload = { type: 'REFUND_DECISION', title, message, link: '/parent/payments' }
    await tx.notification.create({ data: { userId: b.parent.user.id, ...payload } })
    await tx.notification.create({ data: { userId: b.tutor.user.id, ...payload, link: '/tutor/earnings' } })
    return { user: b.parent.user, payload }
  })
  await mail(result.user, result.payload)
}
