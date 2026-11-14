// A linked refund stays paused through reconsideration and follow-up questions.
export function attendanceRefundState(review, refund) {
  if (!review || !refund || review.status !== 'IN_PROGRESS') return null
  if (refund.issuedAt || (refund.status === 'APPROVED' && !refund.reviewNote && ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(refund.payment?.status))) return 'TRANSFERRED'
  return refund.status === 'REJECTED' ? null : 'ON_HOLD'
}
