import { attendanceRefundState } from './attendanceRefund.js'

export const tutorRefunds = {
  select: { id: true, amount: true, status: true, issuedAt: true, reviewNote: true,
    attendanceCases: { select: { status: true } } },
  orderBy: { id: 'asc' },
}

export function tutorPaymentStatus(payment) {
  if (!payment) return null
  return { status: payment.status, refunds: payment.refunds.map(r => {
    const transferred = r.issuedAt || (r.status === 'APPROVED' && !r.reviewNote && ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(payment.status))
    const held = r.attendanceCases.some(c => attendanceRefundState(c, { ...r, payment }) === 'ON_HOLD')
    return { id: r.id, amount: Number(r.amount), stage: transferred ? 'TRANSFERRED' : held ? 'ON_HOLD' : r.status }
  }) }
}
