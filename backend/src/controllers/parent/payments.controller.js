// Payments: SANDBOX only. There is no real gateway yet, so "checkout" creates a pending Payment and
// "confirm" plays the role of the gateway's callback. When Billplz/ToyyibPay/Stripe test mode is wired,
// only `confirmPayment` needs to be replaced by the gateway's webhook handler.
import { randomBytes } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { bookingInclude, toBookingDto } from '../../services/booking.dto.js'
import { notify, notifyWithEmail } from '../../services/notification.service.js'
import { id } from '../../utils/validators.js'

export const SANDBOX_BANKS = ['Maybank2u', 'CIMB Clicks', 'Public Bank', 'RHB Now', 'Hong Leong Connect', 'Bank Islam']

const money = (d) => Number(d ?? 0)

// Amount = agreed hourly price x lesson hours. Decimal maths only: never floats for money.
function lessonAmount(booking) {
  const hours = new Prisma.Decimal(booking.endAt - booking.startAt).div(3600000)
  return new Prisma.Decimal(booking.agreedPrice).mul(hours).toDecimalPlaces(2)
}

// GET /parent/payments
export async function paymentsOverview(req, res) {
  const [awaiting, payments] = await Promise.all([
    prisma.booking.findMany({
      where: { parentId: req.parent.id, status: 'AWAITING_PAYMENT' },
      include: bookingInclude,
      orderBy: { startAt: 'asc' },
    }),
    prisma.payment.findMany({
      where: { booking: { parentId: req.parent.id }, status: { in: ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FAILED'] } },
      include: { booking: { include: bookingInclude }, refunds: true },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const paid = payments.filter((p) => p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED')

  res.json({
    required: awaiting.map((b) => ({ ...toBookingDto(b), totalAmount: money(lessonAmount(b)) })),
    summary: {
      totalPaid: paid.reduce((s, p) => s + money(p.amount), 0),
      pendingPayment: awaiting.reduce((s, b) => s + money(lessonAmount(b)), 0),
      paidThisMonth: paid.filter((p) => p.paidAt && p.paidAt >= startOfMonth).reduce((s, p) => s + money(p.amount), 0),
    },
    transactions: payments.map((p) => ({
      id: p.id,
      status: p.status,
      amount: money(p.amount),
      method: p.method,
      gatewayRef: p.gatewayRef,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
      refunds: p.refunds.map((r) => ({ id: r.id, amount: money(r.amount), type: r.type, status: r.status, reason: r.reason })),
      booking: toBookingDto(p.booking),
    })),
    banks: SANDBOX_BANKS,
  })
}

// POST /parent/payments/checkout { bookingId }: start a sandbox FPX payment
export async function checkout(req, res) {
  const { bookingId } = z.object({ bookingId: id('Booking') }).parse(req.body)
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, parentId: req.parent.id }, include: { payment: true } })
  if (!booking) throw new AppError(404, 'Booking not found')
  if (booking.status !== 'AWAITING_PAYMENT' || booking.agreedPrice == null)
    throw new AppError(400, 'This booking is not waiting for payment')

  const amount = lessonAmount(booking)
  const gatewayRef = `SBX-${randomBytes(5).toString('hex').toUpperCase()}`

  // One Payment per booking (bookingId is unique), so a failed attempt is retried on the same row
  const payment = booking.payment
    ? await prisma.payment.update({ where: { id: booking.payment.id }, data: { status: 'PENDING', amount, gatewayRef } })
    : await prisma.payment.create({
        data: { bookingId: booking.id, amount, commissionRate: 0, commissionAmount: 0, method: 'FPX', gatewayRef },
      })

  res.status(201).json({ paymentId: payment.id, gatewayRef, amount: money(amount), banks: SANDBOX_BANKS })
}

// POST /parent/payments/:id/confirm { bank, outcome }: stands in for the gateway callback
export async function confirmPayment(req, res) {
  const { bank, outcome } = z
    .object({ bank: z.enum(SANDBOX_BANKS, { message: 'Choose a bank from the list' }), outcome: z.enum(['SUCCESS', 'FAILED']) })
    .parse(req.body)

  const payment = await prisma.payment.findFirst({
    where: { id: Number(req.params.id), booking: { parentId: req.parent.id } },
    include: { booking: { include: { tutor: { include: { user: true } }, child: true } } },
  })
  if (!payment) throw new AppError(404, 'Payment not found')
  if (payment.status !== 'PENDING') throw new AppError(400, 'This payment has already been processed')

  if (outcome === 'FAILED') {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } })
    return res.json({ status: 'FAILED', message: 'The payment was not completed. You have not been charged.' })
  }

  // Commission: platform base rate unless the Admin set a rate for this tutor. The rate is
  // snapshotted on the Payment so later rate changes never alter past transactions.
  const base = await prisma.systemSetting.findUnique({ where: { key: 'BASE_COMMISSION_RATE' } })
  const rate = payment.booking.tutor.commissionRate ?? new Prisma.Decimal(base?.value ?? 0)
  const commissionAmount = new Prisma.Decimal(payment.amount).mul(rate).div(100).toDecimalPlaces(2)

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', paidAt: new Date(), method: `FPX (${bank})`, commissionRate: rate, commissionAmount },
    }),
    prisma.booking.update({ where: { id: payment.bookingId }, data: { status: 'CONFIRMED' } }),
  ])

  const b = payment.booking
  const when = b.startAt.toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' })
  // Payment success + booking confirmed are record-worthy, so they are also emailed
  await notifyWithEmail(req.user, {
    type: 'PAYMENT_SUCCESS',
    title: 'Payment successful. Booking confirmed',
    message: `We received RM ${Number(payment.amount).toFixed(2)} for ${b.child.name}'s ${b.subject} lesson with ${b.tutor.user.fullName} on ${when}.`,
    link: '/parent/bookings',
  })
  await notify(b.tutor.userId, {
    type: 'BOOKING_CONFIRMED',
    title: 'Booking confirmed',
    message: `${req.user.fullName} paid for the ${b.subject} lesson on ${when}.`,
    link: '/tutor/bookings',
  })

  res.json({ status: 'SUCCESS', message: 'Payment successful. Your lesson is confirmed.' })
}
