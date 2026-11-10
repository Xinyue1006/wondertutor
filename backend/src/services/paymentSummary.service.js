// Payment totals for one parent, shared by GET /parent/payments and the AI assistant's get_payment_summary tool so both
// use exactly the same rules. Read-only. Money is added up as Prisma Decimals and only turned into numbers at the end.
//
// Meaning of the totals (kept identical to the Payments page):
//   - "paid" = payments with status PAID or PARTIALLY_REFUNDED, counted by paidAt, at their ORIGINAL amount. This is not a
//     net figure: refunds are reported separately and are never subtracted here.
//   - "pending" = bookings AWAITING_PAYMENT, valued at agreed hourly price x lesson hours.
//   - "this month" = the Malaysian calendar month, whatever time zone the server runs in.
import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma.js'
import { addDays, mytParts, mytToDate } from '../utils/time.js'

export const PAID_STATUSES = ['PAID', 'PARTIALLY_REFUNDED']
export const money = (d) => Number(d ?? 0)

// Amount = agreed hourly price x lesson hours. Decimal maths only: never floats for money.
export function lessonAmount(booking) {
  const hours = new Prisma.Decimal(booking.endAt - booking.startAt).div(3600000)
  return new Prisma.Decimal(booking.agreedPrice).mul(hours).toDecimalPlaces(2)
}

export const sumDecimal = (items, amountOf) => items.reduce((t, x) => t.add(amountOf(x)), new Prisma.Decimal(0))

// First instant of the current Malaysian month (inclusive)
export function mytMonthStart(now = new Date()) {
  const today = mytParts(now).date
  return mytToDate(`${today.slice(0, 8)}01`, '00:00')
}

// "YYYY-MM-DD" .. "YYYY-MM-DD" (Malaysian days, both ends included) -> [start, endExclusive)
export function mytDayRange(from, to) {
  return { start: from ? mytToDate(from, '00:00') : null, end: to ? mytToDate(addDays(to, 1), '00:00') : null }
}

// Totals for the assistant. from/to optional (default: the current Malaysian month).
export async function parentPaymentSummary(parentId, { from, to } = {}, now = new Date(), db = prisma) {
  const monthMode = !from && !to
  const range = monthMode ? { start: mytMonthStart(now), end: null } : mytDayRange(from, to)
  const [awaiting, payments] = await Promise.all([
    db.booking.findMany({ where: { parentId, status: 'AWAITING_PAYMENT' }, select: { startAt: true, endAt: true, agreedPrice: true } }),
    db.payment.findMany({
      where: { booking: { parentId }, status: { in: ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'] } },
      select: { amount: true, status: true, paidAt: true, refunds: { select: { amount: true, status: true, type: true, createdAt: true } } },
    }),
  ])
  const inRange = (d) => d && (!range.start || d >= range.start) && (!range.end || d < range.end)
  const paid = payments.filter((p) => PAID_STATUSES.includes(p.status))
  const paidInPeriod = paid.filter((p) => inRange(p.paidAt))
  // Refund requests made in the period, grouped by their recorded status (APPROVED does not mean the money has arrived)
  const refunds = payments.flatMap((p) => p.refunds).filter((r) => inRange(r.createdAt))
  const byStatus = {}
  for (const r of refunds) {
    const s = (byStatus[r.status] ||= { status: r.status, count: 0, amount: new Prisma.Decimal(0) })
    s.count++
    s.amount = s.amount.add(r.amount)
  }
  const fullyRefundedInPeriod = payments.filter((p) => p.status === 'REFUNDED' && inRange(p.paidAt)).length
  return {
    period: monthMode ? { kind: 'CURRENT_MONTH', from: `${mytParts(now).date.slice(0, 8)}01`, to: mytParts(now).date } : { kind: 'RANGE', from: from ?? null, to: to ?? null },
    paidInPeriod: { amount: money(sumDecimal(paidInPeriod, (p) => p.amount)), count: paidInPeriod.length, basis: 'Original amounts of PAID and PARTIALLY_REFUNDED payments by payment date; refunds are listed separately and not subtracted' },
    fullyRefundedPaymentsInPeriod: fullyRefundedInPeriod,
    pendingPayment: { amount: money(sumDecimal(awaiting, lessonAmount)), count: awaiting.length },
    totalPaidAllTime: money(sumDecimal(paid, (p) => p.amount)),
    refundRequestsInPeriod: Object.values(byStatus).map((s) => ({ status: s.status, count: s.count, amount: money(s.amount) })),
    currency: 'RM',
  }
}
