import { money } from '../lib/format'

const paymentLabels = { PAID: 'Paid', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Partially refunded', PENDING: 'Pending', FAILED: 'Failed' }
const refundLabels = { PENDING: 'Pending review', ESCALATED: 'Escalated for review', APPROVED: 'Approved · awaiting transfer',
  TRANSFERRED: 'Transfer recorded', REJECTED: 'Declined', ON_HOLD: 'On hold during attendance review' }

export default function TutorPaymentStatus({ payment }) {
  if (!payment) return null
  return <div className="min-w-0 space-y-1 break-words text-sm">
    <p>Payment · {paymentLabels[payment.status] || payment.status}</p>
    {payment.refunds.map(r => <p key={r.id}>Refund · {money(r.amount)} · {refundLabels[r.stage] || r.stage}</p>)}
  </div>
}
