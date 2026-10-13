import { useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../api/client'
import Avatar from './ui/Avatar'
import Icon from './ui/Icon'
import { ErrorBox, Modal, StatusPill, Stars, VerifiedTick } from './ui/Common'
import { fmtDateLong, fmtShortDate, fmtTime, fmtTimeRange, money } from '../lib/format'
import { gradeLabel } from '../lib/education'

function Row({ icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-2 text-sm">
      <Icon name={icon} className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
      <span className="w-28 shrink-0 text-slate-500">{label}</span>
      <span className="flex-1 font-medium text-navy">{children}</span>
    </div>
  )
}

// Read-only "View Lesson Details" popup shared by the dashboard and My Bookings
export default function LessonDetails({ booking: b, onClose, footer, onChanged }) {
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  const [dispute, setDispute] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!b) return null

  // Parent-initiated refunds are reviewed by Admin (never automatic)
  const refunds = b.payment?.refunds || []
  const canAsk = b.payment?.status === 'PAID' && ['CONFIRMED', 'COMPLETED'].includes(b.status) && !refunds.some((r) => ['PENDING', 'APPROVED'].includes(r.status))
  const REFUND_LABEL = { PENDING: 'Pending Admin review', APPROVED: 'Approved', REJECTED: 'Not approved' }

  async function sendRefund() {
    setError('')
    // Admin needs a real explanation to decide a refund, so a one-word reason is not enough
    if (reason.trim().length < 10) return setError('Please explain why you are asking for a refund (at least 10 characters).')
    setBusy(true)
    try {
      await api.post(`/parent/bookings/${b.id}/refund-request`, { reason, ...(dispute && { attendanceDispute: true }) })
      setAsking(false); setReason('')
      onChanged?.()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const online = b.teachingMode === 'ONLINE'
  return (
    <Modal open onClose={onClose} title={`${b.subject}${b.isTrial ? ' (Trial Lesson)' : ''}`} width="max-w-xl" footer={footer}>
      <div className="mb-3 flex items-center gap-3 rounded-xl bg-brand-25 p-3">
        <Avatar src={b.tutor.photoUrl} name={b.tutor.name} className="h-14 w-14" rounded="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-bold text-navy">{b.tutor.name} {b.tutor.verified && <VerifiedTick />}</div>
          <div className="flex items-center gap-1 text-xs text-slate-500"><Icon name="star" fill className="h-3.5 w-3.5 text-accent" /> {b.tutor.rating.toFixed(1)} ({b.tutor.reviewCount} reviews)</div>
        </div>
        <StatusPill status={b.status} />
      </div>

      <div className="divide-y divide-slate-100">
        <Row icon="calendar" label="Date">{fmtDateLong(b.startAt)}</Row>
        <Row icon="clock" label="Time">{fmtTimeRange(b.startAt, b.endAt)}</Row>
        <Row icon="user" label="Child">{b.child.name} ({gradeLabel(b.child.educationLevel, b.child.grade)})</Row>
        <Row icon={online ? 'monitor' : 'home'} label="Teaching mode">{online ? 'Online' : 'Physical'}</Row>
        {!online && b.location && <Row icon="pin" label="Location">{b.location}</Row>}
        {online && b.meetingLink && (
          <Row icon="globe" label="Meeting link"><a href={b.meetingLink} target="_blank" rel="noreferrer" className="break-all text-brand-500 hover:underline">{b.meetingLink}</a></Row>
        )}
        <Row icon="tag" label="Price">
          {b.hourlyPrice != null ? `RM ${b.hourlyPrice} / hour` : '—'}
          {b.status === 'COUNTER_OFFERED' && b.proposedPrice != null && <span className="ml-2 text-xs font-normal text-slate-500">(you proposed RM {b.proposedPrice})</span>}
          {b.totalAmount != null && <span className="ml-2 text-xs font-normal text-slate-500">· {b.hours}h = {money(b.totalAmount)}</span>}
        </Row>
        {b.payment && (
          <Row icon="wallet" label="Payment">
            <StatusPill status={b.payment.status} /> <span className="ml-2 text-xs font-normal text-slate-500">{b.payment.method} · Ref {b.payment.gatewayRef}</span>
          </Row>
        )}
        {b.messageToTutor && <Row icon="file" label="Your message">{b.messageToTutor}</Row>}
        {b.rejectionReason && <Row icon="info" label="Tutor's reason">{b.rejectionReason}</Row>}
        {b.cancelReason && <Row icon="info" label="Cancel reason">{b.cancelReason}</Row>}
      </div>

      {/* Attendance + summary are recorded by the tutor; parents only see them */}
      {b.attendance?.checkInAt && (
        <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm">
          <div className="mb-1 flex items-center gap-2 font-bold text-emerald-800"><Icon name="check-circle" className="h-4 w-4" /> Attendance verified</div>
          <div className="text-slate-600">
            Checked in {fmtTime(b.attendance.checkInAt)}{b.attendance.checkOutAt && <> · Checked out {fmtTime(b.attendance.checkOutAt)}</>}
          </div>
          {b.attendance.checkInPhotoUrl && <img src={b.attendance.checkInPhotoUrl} alt="Check-in" className="mt-2 h-28 rounded-lg object-cover" />}
        </div>
      )}
      {b.summary && (
        <div className="mt-3 rounded-xl border border-brand-100 bg-brand-25 p-3 text-sm">
          <div className="mb-1 flex items-center gap-2 font-bold text-navy"><Icon name="file" className="h-4 w-4 text-brand-500" /> Session summary</div>
          <p className="text-slate-600">{b.summary.content}</p>
          {b.summary.progressNote && <p className="mt-1 text-slate-500"><b className="text-navy">Progress:</b> {b.summary.progressNote}</p>}
        </div>
      )}
      {b.review && (
        <div className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          Your review: <Stars value={b.review.rating} /> {b.review.comment && <span className="truncate">“{b.review.comment}”</span>}
        </div>
      )}
      {refunds.length > 0 && (
        <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-sm">
          <div className="mb-1 font-bold text-navy">Refund</div>
          {refunds.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-slate-600">
              <span>{money(r.amount)} · {r.reason}</span><span className="pill bg-white text-sky-700">{REFUND_LABEL[r.status]}</span>
            </div>))}
        </div>
      )}
      {canAsk && (asking ? (
        <div className="mt-3 space-y-2 rounded-xl border border-slate-100 p-3">
          <ErrorBox>{error}</ErrorBox>
          <label className="block text-sm font-bold text-navy">Why are you asking for a refund?
            <textarea rows={3} maxLength={300} className="input mt-1 resize-none" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The tutor did not attend the lesson." /></label>
          {b.status === 'COMPLETED' && (
            <label className="flex min-h-10 cursor-pointer items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-500" checked={dispute} onChange={(e) => setDispute(e.target.checked)} />
              <span>The lesson did not happen as recorded (for example, the tutor did not come or left early). <span className="text-slate-500">The lesson is marked as disputed for our admin team.</span></span>
            </label>
          )}
          <p className="text-xs text-slate-500">Our team reviews every request and will let you know the outcome.</p>
          <div className="flex gap-2"><button disabled={busy} onClick={sendRefund} className="btn-primary px-4 py-1.5">{busy ? 'Sending…' : 'Send Request'}</button><button onClick={() => setAsking(false)} className="btn-outline px-4 py-1.5">Cancel</button></div>
        </div>
      ) : (
        <button onClick={() => setAsking(true)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-500 hover:underline"><Icon name="refresh" className="h-3.5 w-3.5" /> Request a refund</button>
      ))}
      <div className="mt-3 text-xs text-slate-400">Requested on {fmtShortDate(b.createdAt)}</div>
      {['CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(b.status) && (
        <Link to={`/parent/complaints?booking=${b.id}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-red-500">
          <Icon name="shield" className="h-3.5 w-3.5" /> Report a problem with this lesson
        </Link>
      )}
      {b.status === 'AWAITING_PAYMENT' && (
        <Link to="/parent/payments" className="btn-primary mt-3 w-full">Pay Now <Icon name="arrow-right" className="h-4 w-4" /></Link>
      )}
    </Modal>
  )
}
