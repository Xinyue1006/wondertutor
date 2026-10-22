// Payments. Two gateways behind one flow:
//  - Billplz (real sandbox/live gateway) when BILLPLZ_API_KEY is set: checkout creates a bill and sends the parent to
//    Billplz's page; the result comes back through the browser return (`gatewayReturn`) and Billplz's server callback
//    (`billplzCallback`). Both are checked against Billplz's signature AND against Billplz's own record of the bill.
//  - A built-in test gateway otherwise (no account needed): `confirmPayment` plays the gateway's role.
// Either way the result is applied by `settlePayment`, so a payment is confirmed in exactly one way.
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { env } from '../../config/env.js'
import { AppError } from '../../utils/AppError.js'
import { bookingInclude, toBookingDto } from '../../services/booking.dto.js'
import { id } from '../../utils/validators.js'
import { PAYMENT_DEADLINE_MINUTES } from '../../services/lifecycle.service.js'
import { mytParts, mytToDate } from '../../utils/time.js'
import { billplzConfigured, createBill, getBill, signatureIsValid } from '../../services/billplz.service.js'
import { settlePayment } from '../../services/payment.service.js'
import { randomBytes } from 'node:crypto'

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

  // "This month" is the Malaysian calendar month, whatever time zone the server runs in
  const today = mytParts(new Date()).date
  const startOfMonth = mytToDate(`${today.slice(0, 8)}01`, '00:00')
  const paid = payments.filter((p) => p.status === 'PAID' || p.status === 'PARTIALLY_REFUNDED')
  // Totals are added up as Decimals and only turned into numbers at the end (no floating-point drift)
  const sum = (items, amountOf) => money(items.reduce((t, x) => t.add(amountOf(x)), new Prisma.Decimal(0)))

  res.json({
    required: awaiting.map((b) => ({ ...toBookingDto(b), totalAmount: money(lessonAmount(b)) })),
    summary: {
      totalPaid: sum(paid, (p) => p.amount),
      pendingPayment: sum(awaiting, lessonAmount),
      paidThisMonth: sum(paid.filter((p) => p.paidAt && p.paidAt >= startOfMonth), (p) => p.amount),
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
    gateway: billplzConfigured() ? 'billplz' : 'sandbox',
  })
}

// POST /parent/payments/checkout { bookingId }: start a sandbox FPX payment
export async function checkout(req, res) {
  const { bookingId } = z.object({ bookingId: id('Booking') }).parse(req.body)
  const booking = await prisma.booking.findFirst({ where: { id: bookingId, parentId: req.parent.id }, include: { payment: true } })
  if (!booking) throw new AppError(404, 'Booking not found')
  if (booking.status !== 'AWAITING_PAYMENT' || booking.agreedPrice == null)
    throw new AppError(400, 'This booking is not waiting for payment')
  // Same deadline as the expiry scheduler: an unpaid booking is released 1 hour before the lesson
  if (booking.startAt.getTime() - Date.now() < PAYMENT_DEADLINE_MINUTES * 60_000)
    throw new AppError(400, `Payment closes ${PAYMENT_DEADLINE_MINUTES} minutes before the lesson starts. Please book another time.`)

  const amount = lessonAmount(booking)
  if (billplzConfigured()) return checkoutWithBillplz(req, res, booking, amount)
  const gatewayRef = `SBX-${randomBytes(5).toString('hex').toUpperCase()}`

  // One Payment per booking (bookingId is unique), so a failed attempt is retried on the same row
  const payment = booking.payment
    ? await prisma.payment.update({ where: { id: booking.payment.id }, data: { status: 'PENDING', amount, gatewayRef } })
    : await prisma.payment.create({
        data: { bookingId: booking.id, amount, commissionRate: 0, commissionAmount: 0, method: 'FPX', gatewayRef },
      })

  res.status(201).json({ paymentId: payment.id, gatewayRef, amount: money(amount), banks: SANDBOX_BANKS })
}

// POST /parent/payments/:id/confirm { bank, outcome }: the built-in test gateway's "callback" (never used with Billplz)
export async function confirmPayment(req, res) {
  if (billplzConfigured()) throw new AppError(404, 'Not found')
  const { bank, outcome } = z
    .object({ bank: z.enum(SANDBOX_BANKS, { message: 'Choose a bank from the list' }), outcome: z.enum(['SUCCESS', 'FAILED']) })
    .parse(req.body)

  const payment = await prisma.payment.findFirst({
    where: { id: Number(req.params.id), booking: { parentId: req.parent.id } },
    include: { booking: true },
  })
  if (!payment) throw new AppError(404, 'Payment not found')
  if (payment.status !== 'PENDING') throw new AppError(400, 'This payment has already been processed')
  // The booking may have been cancelled or expired after checkout started: it must not come back to life
  if (payment.booking.status !== 'AWAITING_PAYMENT')
    throw new AppError(400, 'This booking is no longer waiting for payment. You have not been charged.')

  const { result } = await settlePayment(payment.id, { paid: outcome === 'SUCCESS', method: `FPX (${bank})` })
  if (result === 'ALREADY') throw new AppError(409, 'This payment has already been processed')
  if (result === 'FAILED') return res.json({ status: 'FAILED', message: 'The payment was not completed. You have not been charged.' })
  res.json({ status: 'SUCCESS', message: 'Payment successful. Your lesson is confirmed.' })
}

// ───────────── Billplz ─────────────

// Creates (or re-creates, after a failed attempt) the Payment row and a Billplz bill for it
async function checkoutWithBillplz(req, res, booking, amount) {
  const cents = amount.mul(100).toFixed(0)
  if (Number(cents) < 100) throw new AppError(400, 'The amount is too small to pay online')
  const payment = booking.payment
    ? await prisma.payment.update({ where: { id: booking.payment.id }, data: { status: 'PENDING', amount, gatewayRef: null } })
    : await prisma.payment.create({ data: { bookingId: booking.id, amount, commissionRate: 0, commissionAmount: 0, method: 'Billplz' } })

  let bill
  try {
    bill = await createBill({
      email: req.user.email,
      name: req.user.fullName,
      amountCents: cents,
      description: `WonderTutor lesson #${booking.id}`,
      reference: String(booking.id),
      callbackUrl: `${env.clientUrl.replace(/\/$/, '')}/api/payments/billplz/callback`,
      redirectUrl: `${env.clientUrl.replace(/\/$/, '')}/parent/payments/return`,
    })
  } catch (err) {
    // Details stay in the server log; the parent only needs to know it did not start
    console.error('[billplz] could not create the bill:', err.message)
    throw new AppError(502, 'The payment service is not available right now. You have not been charged. Please try again in a moment.')
  }
  await prisma.payment.update({ where: { id: payment.id }, data: { gatewayRef: bill.id } })
  res.status(201).json({ paymentId: payment.id, gatewayRef: bill.id, amount: money(amount), redirectUrl: bill.url })
}

// Asks Billplz itself whether the bill is paid, and settles our Payment to match
async function settleFromBillplz(billId) {
  const payment = await prisma.payment.findFirst({ where: { gatewayRef: billId } })
  if (!payment) throw new AppError(404, 'Payment not found')
  const bill = await getBill(billId)
  // The amount Billplz holds must be the amount we asked for, so a bill cannot be "paid" with a smaller sum
  const expected = new Prisma.Decimal(payment.amount).mul(100).toFixed(0)
  if (String(bill.amount) !== expected) throw new AppError(400, 'The paid amount does not match this payment')
  // Billplz marks an unpaid bill as "due" until it is paid (or it expires/deleted), so "not paid yet" is not "failed"
  if (!bill.paid) return { result: bill.state === 'deleted' ? 'FAILED' : 'WAITING', payment }
  const settled = await settlePayment(payment.id, { paid: true, method: 'Billplz', real: true })
  return settled
}

// POST /parent/payments/return { id, paid, paid_at, x_signature }: the parent's browser coming back from Billplz.
// The page sends the three values Billplz put in the address bar; the signature proves Billplz made them.
export async function gatewayReturn(req, res) {
  if (!billplzConfigured()) throw new AppError(404, 'Not found')
  const body = z.object({ id: z.string().min(1).max(64), paid: z.string().max(10), paid_at: z.string().max(60).optional(), x_signature: z.string().max(100) }).parse(req.body)
  const params = { 'billplz[id]': body.id, 'billplz[paid]': body.paid, ...(body.paid_at !== undefined && { 'billplz[paid_at]': body.paid_at }) }
  if (!signatureIsValid({ ...params, 'billplz[x_signature]': body.x_signature })) throw new AppError(400, 'This payment result could not be verified')

  const owned = await prisma.payment.findFirst({ where: { gatewayRef: body.id, booking: { parentId: req.parent.id } } })
  if (!owned) throw new AppError(404, 'Payment not found')

  const { result } = await settleFromBillplz(body.id)
  const fresh = await prisma.payment.findUnique({ where: { id: owned.id } })
  const messages = {
    SUCCESS: 'Payment successful. Your lesson is confirmed.',
    ALREADY: fresh.status === 'PAID' ? 'Payment successful. Your lesson is confirmed.' : 'This payment was not completed. You have not been charged.',
    LATE: 'We received your payment, but the booking had already been released. A full refund has been queued.',
    FAILED: 'The payment was not completed. You have not been charged.',
    WAITING: 'We have not received the payment yet. If you already paid, it can take a minute to show up: check Payments again shortly.',
  }
  const status = result === 'SUCCESS' || (result === 'ALREADY' && fresh.status === 'PAID') ? 'SUCCESS' : result === 'LATE' ? 'LATE' : result === 'WAITING' ? 'WAITING' : 'FAILED'
  // `outcome` (not `status`) so it cannot be confused with an HTTP status
  res.json({ outcome: status, message: messages[result] })
}

// POST /api/payments/billplz/callback: Billplz telling our server (not the browser) that a bill was paid.
// Public route: its only protection is the signature, so anything unsigned or wrongly signed is refused.
export async function billplzCallback(req, res) {
  if (!billplzConfigured() || !signatureIsValid(req.body)) return res.status(400).json({ message: 'Invalid signature' })
  const billId = String(req.body.id || '')
  if (!billId) return res.status(400).json({ message: 'Missing bill' })
  try {
    await settleFromBillplz(billId)
  } catch (err) {
    // 404 means a bill that is not ours (Billplz account shared with another site): acknowledge it, there is nothing to do.
    // Anything else makes Billplz retry, which is what we want for a temporary problem.
    if (err.status !== 404) {
      console.error('[billplz] callback failed:', err.message)
      return res.status(500).json({ message: 'Try again' })
    }
  }
  res.sendStatus(200)
}
