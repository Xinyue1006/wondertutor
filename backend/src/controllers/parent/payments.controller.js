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
import { mytParts } from '../../utils/time.js'
import { billplzConfigured, createBill, getBill, signatureIsValid } from '../../services/billplz.service.js'
import { settlePayment } from '../../services/payment.service.js'
import { randomBytes } from 'node:crypto'
// Amount/total rules are shared with the AI assistant (services/paymentSummary.service.js)
import { PAID_STATUSES, lessonAmount, money, mytMonthStart, sumDecimal } from '../../services/paymentSummary.service.js'

export const SANDBOX_BANKS = ['Maybank2u', 'CIMB Clicks', 'Public Bank', 'RHB Now', 'Hong Leong Connect', 'Bank Islam']

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
  const startOfMonth = mytMonthStart()
  const paid = payments.filter((p) => PAID_STATUSES.includes(p.status))
  // Totals are added up as Decimals and only turned into numbers at the end (no floating-point drift)
  const sum = (items, amountOf) => money(sumDecimal(items, amountOf))

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
  if (env.nodeEnv === 'production' && !billplzConfigured())
    throw new AppError(503, 'Online payments are not configured. Please contact the centre.')
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
  if (env.nodeEnv === 'production' || billplzConfigured()) throw new AppError(404, 'Not found')
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

// Keep the original bill reference: a delayed callback must still find its payment.
async function checkoutWithBillplz(req, res, booking, amount) {
  const cents = amount.mul(100).toFixed(0)
  if (Number(cents) < 100) throw new AppError(400, 'The amount is too small to pay online')
  if (booking.payment) {
    const p = booking.payment
    if (!p.gatewayRef || !['PENDING', 'FAILED'].includes(p.status) || p.method !== 'Billplz')
      throw new AppError(409, 'A payment already exists. Refresh payment history or contact the centre.')
    const existing = await getBill(p.gatewayRef)
    if (existing.paid === true || existing.state === 'deleted') {
      await settleFromBillplz(p.gatewayRef, { expectedBookingId: booking.id, parentId: req.parent.id })
      return res.json({ reconciled: true })
    }
    if (existing.collection_id !== env.billplz.collectionId || existing.id !== p.gatewayRef || existing.paid || existing.state !== 'due' || !existing.url || Number(existing.amount) !== Number(cents) || !p.amount.equals(amount))
      throw new AppError(409, 'The original bill cannot be reopened. Refresh payment history or contact the centre.')
    return res.json({ paymentId: p.id, gatewayRef: p.gatewayRef, amount: money(amount), redirectUrl: existing.url })
  }
  let payment
  try {
    payment = await prisma.payment.create({ data: { bookingId: booking.id, amount, commissionRate: 0, commissionAmount: 0, method: 'Billplz' } })
  } catch (err) {
    if (err.code === 'P2002') throw new AppError(409, 'Checkout already started. Refresh and reopen the original bill.')
    throw err
  }

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
    throw new AppError(502, `Checkout could not be confirmed. Give the centre booking #${booking.id} so they can check the original bill.`)
  }
  const linked = await prisma.payment.updateMany({ where: { id: payment.id, OR: [{ gatewayRef: null }, { gatewayRef: bill.id }] }, data: { gatewayRef: bill.id } })
  if (!linked.count) throw new AppError(409, 'Another bill is linked to this payment. Contact the centre.')
  res.status(201).json({ paymentId: payment.id, gatewayRef: bill.id, amount: money(amount), redirectUrl: bill.url })
}

// Asks Billplz itself whether the bill is paid, and settles our Payment to match
export async function settleFromBillplz(billId, { expectedBookingId, parentId } = {}) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(billId)) throw new AppError(400, 'Invalid bill ID')
  const bill = await getBill(billId)
  if (bill.id !== billId || bill.collection_id !== env.billplz.collectionId)
    throw new AppError(404, 'Bill does not belong to this collection')
  const owner = parentId ? { booking: { parentId } } : {}
  let payment = await prisma.payment.findFirst({ where: { gatewayRef: billId, ...owner } })
  if (!payment) {
    // If the create response was lost, recover only from the provider's stored
    // merchant reference, amount and application callback, never from a caller's claim.
    const bookingId = Number(bill.reference_1)
    if (!Number.isSafeInteger(bookingId) || bookingId < 1 || String(bookingId) !== bill.reference_1 ||
        bill.reference_1_label !== 'Booking' || bill.description !== 'WonderTutor lesson #' + bookingId ||
        bill.callback_url !== env.clientUrl.replace(/\/$/, '') + '/api/payments/billplz/callback')
      throw new AppError(404, 'Original WonderTutor bill not found')
    payment = await prisma.payment.findFirst({ where: { bookingId, method: 'Billplz', gatewayRef: null, ...owner } })
    if (!payment) {
      payment = await prisma.payment.findFirst({ where: { bookingId, gatewayRef: billId, ...owner } })
      if (!payment) throw new AppError(404, 'No matching payment')
    }
  }
  if (expectedBookingId !== undefined && payment.bookingId !== expectedBookingId)
    throw new AppError(409, 'Bill belongs to a different booking')
  const expected = new Prisma.Decimal(payment.amount).mul(100).toFixed(0)
  if (String(bill.amount) !== expected || (bill.paid && (bill.state !== 'paid' || String(bill.paid_amount) !== expected)))
    throw new AppError(400, 'The paid amount or state does not match this payment')
  if (!((bill.paid === true && bill.state === 'paid') || (bill.paid === false && ['due', 'deleted'].includes(bill.state))))
    throw new AppError(502, 'Unrecognised bill state')
  if (!payment.gatewayRef) {
    const linked = await prisma.payment.updateMany({ where: { id: payment.id, OR: [{ gatewayRef: null }, { gatewayRef: billId }] }, data: { gatewayRef: billId } })
    if (!linked.count) throw new AppError(409, 'Another bill was linked concurrently')
  }
  if (bill.paid === true) return settlePayment(payment.id, { paid: true, method: 'Billplz', real: true })
  if (bill.state === 'deleted') {
    await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
    return { result: 'FAILED', payment }
  }
  return { result: 'WAITING', payment }
}

// POST /parent/payments/return { id, paid, paid_at, x_signature }: the parent's browser coming back from Billplz.
// The page sends the three values Billplz put in the address bar; the signature proves Billplz made them.
export async function gatewayReturn(req, res) {
  if (!billplzConfigured()) throw new AppError(404, 'Not found')
  const body = z.object({ id: z.string().min(1).max(64), paid: z.string().max(10), paid_at: z.string().max(60).optional(), x_signature: z.string().max(100) }).parse(req.body)
  const params = { 'billplz[id]': body.id, 'billplz[paid]': body.paid, ...(body.paid_at !== undefined && { 'billplz[paid_at]': body.paid_at }) }
  if (!signatureIsValid({ ...params, 'billplz[x_signature]': body.x_signature })) throw new AppError(400, 'This payment result could not be verified')

  const { result } = await settleFromBillplz(body.id, { parentId: req.parent.id })
  const fresh = await prisma.payment.findFirstOrThrow({ where: { gatewayRef: body.id, booking: { parentId: req.parent.id } }, include: { refunds: true } })
  const effectiveResult = result === 'ALREADY' && fresh.status === 'PAID' && fresh.refunds.some((r) => r.type === 'AUTO') ? 'LATE' : result
  const messages = {
    SUCCESS: 'Payment successful. Your lesson is confirmed.',
    ALREADY: fresh.status === 'PAID' ? 'Payment successful. Your lesson is confirmed.' : 'This payment was not completed. You have not been charged.',
    LATE: 'We received your payment, but the booking had already been released. A full refund has been queued.',
    FAILED: 'The payment was not completed. You have not been charged.',
    WAITING: 'We have not received the payment yet. If you already paid, it can take a minute to show up: check Payments again shortly.',
  }
  const status = effectiveResult === 'SUCCESS' || (effectiveResult === 'ALREADY' && fresh.status === 'PAID') ? 'SUCCESS' : effectiveResult === 'LATE' ? 'LATE' : effectiveResult === 'WAITING' ? 'WAITING' : 'FAILED'
  // `outcome` (not `status`) so it cannot be confused with an HTTP status
  res.json({ outcome: status, message: messages[effectiveResult] })
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

// GET /parent/payments/:id/receipt: the receipt of a payment that went through (FR 4.2). Only the parent who paid can see it.
export async function getReceipt(req, res) {
  const payment = await prisma.payment.findFirst({
    where: { id: Number(req.params.id), booking: { parentId: req.parent.id } },
    include: { refunds: true, booking: { include: { tutor: { include: { user: { select: { fullName: true } } } }, child: { select: { name: true } }, parent: { include: { user: { select: { fullName: true, email: true } } } } } } },
  })
  if (!payment || !['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment.status)) throw new AppError(404, 'Receipt not found')
  const b = payment.booking
  const paidAt = payment.paidAt ?? payment.createdAt
  res.json({
    receipt: {
      number: `WT-${mytParts(paidAt).date.slice(0, 4)}-${String(payment.id).padStart(6, '0')}`,
      paidAt,
      status: payment.status,
      method: payment.method,
      reference: payment.gatewayRef,
      amount: money(payment.amount),
      payer: { name: b.parent.user.fullName, email: b.parent.user.email },
      lesson: { subject: b.subject, child: b.child.name, tutor: b.tutor.user.fullName, startAt: b.startAt, endAt: b.endAt, teachingMode: b.teachingMode, isTrial: b.isTrial },
      refunds: payment.refunds.map((r) => ({ amount: money(r.amount), status: r.status, type: r.type })),
    },
  })
}
