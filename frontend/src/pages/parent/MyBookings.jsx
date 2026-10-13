import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import { EmptyState, ErrorBox, Modal, PageTitle, Spinner, StatusPill, Stars, VerifiedTick } from '../../components/ui/Common'
import LessonDetails from '../../components/LessonDetails'
import RescheduleModal from '../../components/RescheduleModal'
import { daysUntil, fmtDate, fmtDateLong, fmtTime, fmtTimeRange, money } from '../../lib/format'
import { gradeLabel } from '../../lib/education'

const GROUPS = {
  pending: ['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT'],
  upcoming: ['CONFIRMED'],
  completed: ['COMPLETED'],
  cancelled: ['CANCELLED', 'REJECTED', 'DISPUTED'],
}

export default function MyBookings() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'all'
  const [bookings, setBookings] = useState(null)
  const [sortNewest, setSortNewest] = useState(true)
  const [detail, setDetail] = useState(null)
  const [cancelFor, setCancelFor] = useState(null)
  const [reviewFor, setReviewFor] = useState(null)
  const [rescheduleFor, setRescheduleFor] = useState(null)
  const [notice, setNotice] = useState('')

  const load = useCallback(() => api.get('/parent/bookings').then((r) => setBookings(r.data.bookings)), [])
  useEffect(() => { load() }, [load])

  // Opened from a notification (".../bookings?booking=12"): show that booking's details straight away, once
  const focusId = Number(params.get('booking'))
  useEffect(() => {
    if (!focusId || !bookings) return
    const b = bookings.find((x) => x.id === focusId)
    if (b) setDetail(b)
    setParams((p) => { p.delete('booking'); return p }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, bookings])

  const counts = useMemo(() => {
    const list = bookings || []
    const n = (g) => list.filter((b) => GROUPS[g].includes(b.status)).length
    return { all: list.length, pending: n('pending'), upcoming: n('upcoming'), completed: n('completed'), cancelled: n('cancelled') }
  }, [bookings])

  if (!bookings) return <Spinner />

  const sorted = [...bookings].sort((a, b) => (sortNewest ? new Date(b.startAt) - new Date(a.startAt) : new Date(a.startAt) - new Date(b.startAt)))
  const show = (group) => tab === 'all' || tab === group
  const by = (...statuses) => sorted.filter((b) => statuses.includes(b.status))

  async function act(path, body) {
    setNotice('')
    try {
      await api.post(path, body)
      await load()
      return true
    } catch (err) {
      setNotice(errorMessage(err))
      return false
    }
  }

  const sections = [
    show('pending') && ['Pending Requests', "Waiting for tutor's response.", 'clock', 'bg-accent-50', 'text-accent-600', by('PENDING'), PendingRow],
    show('pending') && ['Counter Offer', 'Tutor has sent a counter offer for your consideration.', 'refresh', 'bg-accent-50', 'text-accent-600', by('COUNTER_OFFERED'), CounterRow],
    show('pending') && ['Payment Required', 'Your request was accepted. Pay to confirm the lesson.', 'wallet', 'bg-accent-50', 'text-accent-600', by('AWAITING_PAYMENT'), PayRow],
    show('upcoming') && ['Upcoming Lessons', 'Your confirmed upcoming lessons.', 'calendar', 'bg-brand-50', 'text-brand-500', by('CONFIRMED'), UpcomingRow],
    show('completed') && ['Completed Lessons', 'View past lessons and leave a review.', 'check-circle', 'bg-ok-50', 'text-ok', by('COMPLETED'), CompletedRow],
    show('cancelled') && ['Cancelled & Declined', 'These requests did not go ahead.', 'x', 'bg-red-50', 'text-red-500', by('CANCELLED', 'REJECTED', 'DISPUTED'), CancelledRow],
  ].filter(Boolean)

  const handlers = { onDetail: setDetail, onCancel: setCancelFor, onReview: setReviewFor, onReschedule: setRescheduleFor, act }

  return (
    <div>
      <PageTitle
        icon="calendar" title="My Bookings" subtitle="View and manage your tutor lessons and booking requests."
        right={
          <div className="grid grid-cols-3 gap-3">
            {[['calendar', counts.upcoming, 'Upcoming', 'bg-brand-50', 'bg-brand-100 text-brand-500'], ['clock', counts.pending, 'Pending', 'bg-accent-50', 'bg-accent-100 text-accent-600'], ['check', counts.completed, 'Completed', 'bg-ok-50', 'bg-ok text-white']].map(([icon, n, l, bg, tone]) => (
              <div key={l} className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${bg}`}>
                <span className={`flex h-10 w-10 items-center justify-center rounded-full ${tone}`}><Icon name={icon} className="h-5 w-5" /></span>
                <span><span className="block text-2xl font-extrabold leading-6 text-navy">{n}</span><span className="text-xs text-slate-600">{l}</span></span>
              </div>))}
          </div>
        }
      />

      <div className="card mb-4 flex flex-wrap items-center justify-between gap-3 p-3">
        <div className="flex flex-wrap gap-2">
          {[['all', 'All'], ['pending', 'Pending'], ['upcoming', 'Upcoming'], ['completed', 'Completed'], ['cancelled', 'Cancelled']].map(([k, l]) => (
            <button key={k} onClick={() => setParams(k === 'all' ? {} : { tab: k })} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${tab === k ? 'border-brand-500 bg-brand-500 text-white' : 'border-brand-200 bg-white text-navy hover:border-brand-500'}`}>
              {l} ({counts[k]})
            </button>))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">Sort by:
          <select className="input h-10 w-52 font-medium text-navy" value={sortNewest ? 'new' : 'old'} onChange={(e) => setSortNewest(e.target.value === 'new')}>
            <option value="new">Date (Newest First)</option><option value="old">Date (Oldest First)</option>
          </select></label>
      </div>
      <ErrorBox className="mb-4">{notice}</ErrorBox>

      {counts[tab] === 0 && (
        <div className="card"><EmptyState icon="calendar" title="No bookings here yet" action={<Link to="/parent/find-tutor" className="btn-primary mt-2">Find a Tutor</Link>}>
          Your booking requests and lessons will appear here.</EmptyState></div>
      )}

      <div className="space-y-4">
        {sections.map(([title, sub, icon, bg, tone, rows, Row]) => rows.length > 0 && (
          <section key={title} className="card overflow-hidden">
            <div className={`flex flex-wrap items-center gap-3 px-5 py-3 ${bg}`}>
              <span className={`flex h-8 w-8 items-center justify-center rounded-full bg-white ${tone}`}><Icon name={icon} className="h-[18px] w-[18px]" /></span>
              <h2 className="text-lg font-extrabold text-navy">{title}</h2>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs font-bold text-navy">{rows.length}</span>
              <span className="text-xs text-slate-500">{sub}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {rows.map((b) => (
                <div key={b.id} className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-[minmax(230px,1.1fr)_minmax(260px,1.2fr)_minmax(280px,1.3fr)_200px] xl:items-center">
                  <TutorBlock b={b} />
                  <LessonBlock b={b} />
                  <Row b={b} {...handlers} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <LessonDetails booking={detail} onClose={() => setDetail(null)} onChanged={load} />
      <RescheduleModal
        booking={rescheduleFor}
        onClose={() => setRescheduleFor(null)}
        onSubmit={async (body) => {
          try {
            await api.post(`/parent/bookings/${rescheduleFor.id}/reschedule`, body)
            setRescheduleFor(null)
            await load()
            return null
          } catch (err) {
            return errorMessage(err) // shown inside the dialog, next to the choice that caused it
          }
        }}
      />
      <CancelModal booking={cancelFor} onClose={() => setCancelFor(null)} onConfirm={async (reason) => { if (await act(`/parent/bookings/${cancelFor.id}/cancel`, { reason })) setCancelFor(null) }} />
      <ReviewModal booking={reviewFor} onClose={() => setReviewFor(null)} onDone={() => { setReviewFor(null); load() }} />
    </div>
  )
}

function TutorBlock({ b }) {
  return (
    <div className="flex items-center gap-4">
      <Avatar src={b.tutor.photoUrl} name={b.tutor.name} className="h-[100px] w-[88px]" rounded="rounded-xl" text="text-2xl" />
      <div className="min-w-0">
        <Link to={`/parent/tutors/${b.tutor.id}`} className="flex items-center gap-1.5 text-lg font-extrabold text-navy hover:text-brand-500">{b.tutor.name} {b.tutor.verified && <VerifiedTick />}</Link>
        <div className="text-sm text-slate-500">{b.subject} <span className="text-slate-300">|</span> {gradeLabel(b.child.educationLevel, b.child.grade)}</div>
        <div className="mt-0.5 flex items-center gap-1 text-sm"><Icon name="star" fill className="h-4 w-4 text-accent" /><b className="text-navy">{b.tutor.rating.toFixed(1)}</b> <span className="text-slate-500">({b.tutor.reviewCount} reviews)</span></div>
      </div>
    </div>
  )
}

const L = ({ icon, children }) => <div className="flex items-center gap-2 text-sm text-slate-600"><Icon name={icon} className="h-4 w-4 shrink-0 text-brand-500" /> {children}</div>

function LessonBlock({ b }) {
  const online = b.teachingMode === 'ONLINE'
  return (
    <div className="space-y-1.5">
      <div><div className="font-bold text-navy">{fmtDateLong(b.startAt)}</div><div className="text-sm text-slate-500">{fmtTimeRange(b.startAt, b.endAt)}</div></div>
      <L icon="user">Child: {b.child.name} ({gradeLabel(b.child.educationLevel, b.child.grade)})</L>
      <L icon={online ? 'monitor' : 'home'}>Teaching Mode: {online ? 'Online' : 'Physical'}</L>
      <L icon="tag">
        {b.status === 'COUNTER_OFFERED' ? 'Original Price' : b.status === 'PENDING' ? 'Proposed Price' : 'Price'}: <b className="text-navy">RM{b.status === 'COUNTER_OFFERED' ? b.proposedPrice : b.hourlyPrice} / hour</b>
      </L>
    </div>
  )
}

const Btn = ({ kind = 'outline', children, ...rest }) => <button className={`${kind === 'primary' ? 'btn-primary' : kind === 'danger' ? 'btn-danger' : 'btn-outline'} w-full`} {...rest}>{children}</button>

function PendingRow({ b, onDetail, onCancel }) {
  return (
    <>
      <div>
        <StatusPill status="PENDING" />
        <ol className="mt-3 flex items-start text-[11px] text-slate-500">
          {[['Request Sent', fmtTime(b.createdAt) + ', ' + new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuala_Lumpur', day: 'numeric', month: 'short' }).format(new Date(b.createdAt)), 'bg-brand-500 text-white', 'check'],
            ['Waiting for Tutor', 'Tutor will respond soon', 'bg-accent text-white', 'clock'], ['Booking Confirmation', '', 'bg-slate-300 text-white', 'clock']].map(([t, s, tone, icon], i) => (
            <li key={t} className="relative flex flex-1 flex-col items-center text-center">
              {i > 0 && <span className="absolute right-1/2 top-2.5 h-0.5 w-full bg-slate-200" />}
              <span className={`relative z-10 flex h-5 w-5 items-center justify-center rounded-full ${tone}`}><Icon name={icon} className="h-3 w-3" strokeWidth={3} /></span>
              <b className="mt-1 text-navy">{t}</b><span>{s}</span>
            </li>))}
        </ol>
      </div>
      <div className="space-y-2"><Btn onClick={() => onDetail(b)}>View Details <Icon name="arrow-right" className="h-4 w-4" /></Btn><Btn kind="danger" onClick={() => onCancel(b)}>Cancel Request</Btn></div>
    </>
  )
}

function CounterRow({ b, onDetail, act }) {
  return (
    <>
      <div className="space-y-2">
        <StatusPill status="COUNTER_OFFERED" />
        {b.messageToTutor && <div className="rounded-lg bg-brand-25 px-3 py-2 text-xs text-slate-600">{b.messageToTutor}</div>}
        <div className="flex items-center justify-between rounded-xl bg-brand-25 px-4 py-3">
          <div><div className="text-xs text-slate-500">Your Proposed Price</div><div className="text-lg font-bold text-slate-600">RM{b.proposedPrice} / hour</div></div>
          <Icon name="arrow-right" className="h-5 w-5 text-slate-400" />
          <div><div className="text-xs text-slate-500">Tutor's Counter Offer</div><div className="text-lg font-extrabold text-navy">RM{b.counterPrice} / hour</div></div>
        </div>
      </div>
      <div className="space-y-2">
        <Btn kind="primary" onClick={() => act(`/parent/bookings/${b.id}/accept-counter`)}>Accept Counter Offer</Btn>
        <Btn onClick={() => act(`/parent/bookings/${b.id}/decline-counter`)}>Decline</Btn>
        <Btn onClick={() => onDetail(b)}>View Details <Icon name="arrow-right" className="h-4 w-4" /></Btn>
      </div>
    </>
  )
}

// Shows where a reschedule stands, with the right buttons for whoever has to act next
function RescheduleBanner({ b, act }) {
  const r = b.reschedule
  if (!r || !['PENDING', 'ESCALATED'].includes(r.status)) return null
  const newTime = `${fmtDateLong(r.newStartAt)}, ${fmtTimeRange(r.newStartAt, r.newEndAt)}`
  if (r.status === 'ESCALATED')
    return <div role="status" className="flex gap-2 rounded-lg bg-accent-50 px-3 py-2 text-xs text-amber-900"><Icon name="info" className="h-4 w-4 shrink-0" /> The new time ({newTime}) was not agreed. Our admin team is reviewing it; the lesson stays at its current time for now.</div>
  if (r.requestedBy === 'PARENT')
    return (
      <div role="status" className="rounded-lg bg-brand-25 px-3 py-2 text-xs text-slate-700">
        <div className="flex gap-2"><Icon name="clock" className="h-4 w-4 shrink-0 text-brand-500" /> You asked to move this lesson to <b className="text-navy">{newTime}</b>. Waiting for the tutor.</div>
        <button onClick={() => act(`/parent/bookings/${b.id}/reschedule/${r.id}/withdraw`)} className="mt-1 min-h-9 font-semibold text-brand-600 hover:underline">Withdraw request</button>
      </div>
    )
  return (
    <div role="status" className="rounded-lg border border-accent/50 bg-accent-50 px-3 py-2 text-xs text-slate-700">
      <div className="flex gap-2"><Icon name="refresh" className="h-4 w-4 shrink-0 text-accent-600" /> The tutor asks to move this lesson to <b className="text-navy">{newTime}</b>.{r.reason ? ` Reason: ${r.reason}` : ''}</div>
      <div className="mt-2 flex gap-2">
        <button onClick={() => act(`/parent/bookings/${b.id}/reschedule/${r.id}/accept`)} className="btn-primary min-h-9 px-3 text-xs">Accept new time</button>
        <button onClick={() => act(`/parent/bookings/${b.id}/reschedule/${r.id}/decline`)} className="btn-outline min-h-9 px-3 text-xs">Decline</button>
      </div>
    </div>
  )
}

const canAskReschedule = (b) => !(b.reschedule?.status === 'PENDING')

function PayRow({ b, onDetail, onCancel, onReschedule, act }) {
  return (
    <>
      <div className="space-y-2">
        <StatusPill status="AWAITING_PAYMENT" />
        <div className="rounded-xl bg-brand-25 px-4 py-3">
          <div className="text-xs text-slate-500">Agreed price</div>
          <div className="text-lg font-extrabold text-navy">RM{b.agreedPrice} / hour <span className="text-sm font-semibold text-slate-500">· total {money(b.totalAmount)}</span></div>
        </div>
        <RescheduleBanner b={b} act={act} />
      </div>
      <div className="space-y-2">
        <Link to="/parent/payments" className="btn-primary w-full">Pay Now <Icon name="arrow-right" className="h-4 w-4" /></Link>
        <Btn onClick={() => onDetail(b)}>View Details <Icon name="arrow-right" className="h-4 w-4" /></Btn>
        {canAskReschedule(b) && <Btn onClick={() => onReschedule(b)}><Icon name="calendar" className="h-4 w-4" /> Reschedule</Btn>}
        <Btn kind="danger" onClick={() => onCancel(b)}>Cancel Booking</Btn>
      </div>
    </>
  )
}

function UpcomingRow({ b, onDetail, onCancel, onReschedule, act }) {
  const d = daysUntil(b.startAt)
  return (
    <>
      <div className="space-y-2">
        <StatusPill status="CONFIRMED" />
        <div className="flex items-center gap-3 rounded-xl bg-brand-25 px-4 py-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-100 text-brand-500"><Icon name="calendar" className="h-5 w-5" /></span>
          <div><div className="font-bold text-navy">{d <= 0 ? 'Lesson today' : d === 1 ? 'Lesson tomorrow' : `Lesson in ${d} days`}</div><div className="text-xs text-slate-500">{fmtDate(b.startAt)}</div></div>
        </div>
        <RescheduleBanner b={b} act={act} />
      </div>
      <div className="space-y-2">
        <Btn kind="primary" onClick={() => onDetail(b)}>View Lesson Details</Btn>
        {canAskReschedule(b) && <Btn onClick={() => onReschedule(b)}><Icon name="calendar" className="h-4 w-4" /> Reschedule</Btn>}
        <Btn kind="danger" onClick={() => onCancel(b)}>Cancel Booking</Btn>
      </div>
    </>
  )
}

function CompletedRow({ b, onDetail, onReview }) {
  return (
    <>
      <div className="space-y-2">
        <StatusPill status="COMPLETED" />
        {b.review ? (
          <div className="rounded-xl bg-brand-25 px-4 py-3"><div className="text-sm font-bold text-navy">Your review</div><Stars value={b.review.rating} size="h-5 w-5" /></div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl bg-accent-50 px-4 py-3">
            <Icon name="star" fill className="h-8 w-8 text-accent" />
            <div><div className="font-bold text-navy">Not yet reviewed</div><div className="text-xs text-slate-500">Share your experience with this tutor.</div></div>
          </div>)}
      </div>
      <div className="space-y-2">
        {!b.review && <Btn kind="primary" onClick={() => onReview(b)}>Leave a Review</Btn>}
        <Btn onClick={() => onDetail(b)}>View Details <Icon name="arrow-right" className="h-4 w-4" /></Btn>
      </div>
    </>
  )
}

function CancelledRow({ b, onDetail }) {
  return (
    <>
      <div className="space-y-2">
        <StatusPill status={b.status} />
        {(b.rejectionReason || b.cancelReason) && <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{b.rejectionReason || b.cancelReason}</div>}
        {b.payment?.status === 'REFUNDED' && <StatusPill status="REFUNDED" />}
      </div>
      <div><Btn onClick={() => onDetail(b)}>View Details <Icon name="arrow-right" className="h-4 w-4" /></Btn></div>
    </>
  )
}

function CancelModal({ booking, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (!booking) return null
  const paid = booking.status === 'CONFIRMED'
  return (
    <Modal open onClose={onClose} title={paid ? 'Cancel this booking?' : 'Cancel this request?'}
      footer={<>
        <button onClick={onClose} className="btn-outline">Keep it</button>
        <button disabled={busy} onClick={async () => { setBusy(true); await onConfirm(reason); setBusy(false); setReason('') }} className="btn bg-red-500 text-white hover:bg-red-600">{busy ? 'Cancelling…' : 'Yes, cancel'}</button>
      </>}>
      <p className="text-sm text-slate-600">{booking.subject} with {booking.tutor.name} on {fmtDateLong(booking.startAt)}, {fmtTimeRange(booking.startAt, booking.endAt)}.</p>
      {paid && <div className="mt-3 flex gap-2 rounded-lg bg-accent-50 p-3 text-sm text-amber-800"><Icon name="info" className="h-4 w-4 shrink-0" /> Because you already paid, your refund request will be reviewed by our Admin team.</div>}
      <label className="mt-3 block text-sm font-semibold text-navy">Reason (optional)
        <textarea rows={3} maxLength={200} className="input mt-1 resize-none" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Schedule changed" /></label>
    </Modal>
  )
}

function ReviewModal({ booking, onClose, onDone }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!booking) return null

  async function submit() {
    if (!rating) return setError('Please choose a star rating.')
    setBusy(true)
    try {
      await api.post(`/parent/bookings/${booking.id}/review`, { rating, comment: comment || undefined })
      setRating(0); setComment('')
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Review ${booking.tutor.name}`}
      footer={<><button onClick={onClose} className="btn-outline">Cancel</button><button disabled={busy} onClick={submit} className="btn-primary">{busy ? 'Submitting…' : 'Submit Review'}</button></>}>
      <ErrorBox className="mb-3">{error}</ErrorBox>
      <p className="text-sm text-slate-500">How was {booking.child.name}'s {booking.subject} lesson? Your review is public on the tutor's profile.</p>
      <div className="my-4 flex justify-center gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} onClick={() => setRating(i)} aria-label={`${i} star${i > 1 ? 's' : ''}`}>
            <Icon name="star" fill className={`h-10 w-10 transition ${i <= rating ? 'text-accent' : 'text-slate-200 hover:text-accent/60'}`} strokeWidth={1.5} />
          </button>))}
      </div>
      <textarea rows={4} maxLength={500} className="input resize-none" placeholder="Tell other parents about the lesson (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="text-right text-xs text-slate-400">{comment.length}/500</div>
    </Modal>
  )
}
