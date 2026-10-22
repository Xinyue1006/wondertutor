// Turns a gateway result (paid / not paid) into the right changes in our own data. The mock gateway, the Billplz
// browser return and the Billplz server callback all end here, so a payment is settled in exactly one way.
import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { notify, notifyWithEmail } from './notification.service.js'

const settleInclude = { booking: { include: { tutor: { include: { user: true } }, child: true, parent: { include: { user: true } } } } }

// real = true for a real gateway: the money has already moved, so it must never be thrown away
// (see "paid too late" below). The mock gateway keeps the stricter behaviour: nothing is charged, so we just refuse.
export async function settlePayment(paymentId, { paid, method = 'FPX', real = false }) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId }, include: settleInclude })
  if (!payment) throw new AppError(404, 'Payment not found')
  // Gateways retry callbacks and people refresh pages, so a payment that is already settled is not an error
  if (payment.status !== 'PENDING') return { result: 'ALREADY', payment }

  if (!paid) {
    const { count } = await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
    return { result: count ? 'FAILED' : 'ALREADY', payment }
  }

  const b = payment.booking
  // Commission: platform base rate unless the Admin set a rate for this tutor. The rate is snapshotted on the
  // Payment so later rate changes never alter past transactions.
  const base = await prisma.systemSetting.findUnique({ where: { key: 'BASE_COMMISSION_RATE' } })
  const rate = b.tutor.commissionRate ?? new Prisma.Decimal(base?.value ?? 0)
  const commissionAmount = new Prisma.Decimal(payment.amount).mul(rate).div(100).toDecimalPlaces(2)

  let late = false
  // Both changes are conditional, so a double click (or the scheduler expiring the booking at the same moment)
  // cannot confirm twice or confirm a booking that was released.
  await prisma.$transaction(async (tx) => {
    const done = await tx.payment.updateMany({
      where: { id: payment.id, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date(), method, commissionRate: rate, commissionAmount },
    })
    if (!done.count) throw new AppError(409, 'This payment has already been processed')
    const confirmed = await tx.booking.updateMany({ where: { id: payment.bookingId, status: 'AWAITING_PAYMENT' }, data: { status: 'CONFIRMED' } })
    if (confirmed.count) return
    if (!real) throw new AppError(400, 'This booking is no longer waiting for payment. You have not been charged.')
    // Paid too late: the parent paid at the gateway after the booking was cancelled or its slot released.
    // The money is real, so keep the record and queue a full refund for the Admin instead of losing it.
    late = true
    await tx.refund.create({
      data: { paymentId: payment.id, amount: payment.amount, type: 'AUTO', reason: 'Paid after the booking was cancelled or released, so the lesson was not confirmed.' },
    })
  })

  const parentUser = b.parent.user
  if (late) {
    await notify(parentUser.id, {
      type: 'REFUND_REQUESTED',
      title: 'Payment received but the lesson was not confirmed',
      message: `We received RM ${Number(payment.amount).toFixed(2)}, but the booking had already been cancelled or released. A full refund has been queued.`,
      link: '/parent/payments',
    })
    return { result: 'LATE', payment }
  }

  const when = b.startAt.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' })
  // Payment success + booking confirmed are record-worthy, so they are also emailed
  await notifyWithEmail(parentUser, {
    type: 'PAYMENT_SUCCESS',
    title: 'Payment successful. Booking confirmed',
    message: `We received RM ${Number(payment.amount).toFixed(2)} for ${b.child.name}'s ${b.subject} lesson with ${b.tutor.user.fullName} on ${when}.`,
    link: '/parent/bookings',
  })
  await notify(b.tutor.userId, {
    type: 'BOOKING_CONFIRMED',
    title: 'Booking confirmed',
    message: `${parentUser.fullName} paid for the ${b.subject} lesson on ${when}.`,
    link: '/tutor/bookings',
  })
  return { result: 'SUCCESS', payment }
}
