import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import TutorPageHeader from '../../components/TutorPageHeader'
import { ErrorBox, LoadError, Spinner, StatusPill } from '../../components/ui/Common'
import { fmtDate, fmtTime, fmtTimeRange, money } from '../../lib/format'
import { gradeLabel } from '../../lib/education'
import { matchesRecordRef, recordRef } from '../../lib/recordRef'

const groups = {
  Requests: ['PENDING', 'COUNTER_OFFERED'], Lessons: ['AWAITING_PAYMENT', 'CONFIRMED'],
  History: ['CANCELLED', 'REJECTED', 'DISPUTED', 'COMPLETED'],
}
const labels = { accept: 'Accept request', decline: 'Decline request', counter: 'Offer a different rate', cancel: 'Cancel lesson',
  escalate: 'Ask admin to review', reschedule: 'Request a time change', link: 'Save class link',
  'approve-time': 'Accept new time', 'decline-time': 'Decline and escalate', 'withdraw-time': 'Withdraw time change' }

const groupFor = b => Object.keys(groups).find(g => groups[g].includes(b.status)) || 'History'

function BookingDetails({ b, onUpdate, onReload }) {
  const [form, setForm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const future = Date.parse(b.startAt) > now
  const active = groups.Lessons.includes(b.status)
  const request = b.reschedule
  function choose(action) { setForm(action); setMessage(''); setError('') }
  async function submit(action, fields = {}) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { data } = await api.post('/tutor/bookings/' + recordRef(b), { action, version: b.updatedAt, ...fields })
      onUpdate(data.booking)
      setForm('')
      setMessage(action === 'link' ? 'Class link saved.' : action === 'escalate' ? 'Sent to admin for review.' : 'Booking updated.')
    } catch (e) {
      setError(errorMessage(e))
      setNeedsRefresh(e.response?.status === 409)
    }
    finally { setBusy(false) }
  }
  async function refresh() {
    setBusy(true)
    try {
      await onReload()
      setForm('')
      setNeedsRefresh(false)
      setError('')
      setMessage('Booking refreshed. Check the latest details before responding.')
    } finally { setBusy(false) }
  }
  const button = (action, primary = false) => <button type="button" disabled={busy || needsRefresh} className={(primary ? 'btn-primary' : 'btn-outline') + ' min-h-11'} onClick={() => choose(action)}>{labels[action]}</button>
  return <section className="card min-w-0 space-y-4 break-words p-4 sm:p-6" aria-label="Booking details">
    <StatusPill status={b.status} />
    {['CONFIRMED', 'COMPLETED', 'DISPUTED'].includes(b.status) && <div><Link className="btn-primary min-h-11" to={'/tutor/bookings/' + recordRef(b) + '/session'}>{b.status === 'CONFIRMED' ? 'Open session' : 'View session record'}</Link></div>}
    <h2 className="text-xl font-bold text-navy">{b.subject} with {b.child.name}</h2>
    <p>{fmtDate(b.startAt)} · {fmtTimeRange(b.startAt, b.endAt)} (Malaysia time)</p>
    <dl className="grid gap-3 rounded-xl bg-brand-25 p-4 text-sm sm:grid-cols-2">
      {[['Parent', b.parentName], ['Student', b.child.name + ' · ' + gradeLabel(b.child.educationLevel, b.child.grade)],
        ['Lesson', b.teachingMode === 'ONLINE' ? 'Online' : 'Physical · ' + (b.location || 'Location to be agreed')],
        ['Parent’s offer', money(b.proposedPrice) + ' / hour'], ...(b.counterPrice ? [['Tutor’s offer', money(b.counterPrice) + ' / hour']] : []),
        ...(b.agreedPrice ? [['Agreed rate', money(b.agreedPrice) + ' / hour']] : [])].map(([name, value]) =>
        <div key={name}><dt className="text-slate-600">{name}</dt><dd className="font-semibold text-navy">{value}</dd></div>)}
    </dl>
    {b.parentSince && <p className="text-sm text-slate-600">Parent member since {fmtDate(b.parentSince)} · {b.completedLessons} completed lessons</p>}
    {b.messageToTutor && <p><b>Parent’s note</b> · {b.messageToTutor}</p>}
    {(b.cancelReason || b.rejectionReason) && <p><b>Reason</b> · {b.cancelReason || b.rejectionReason}</p>}
    {b.status === 'AWAITING_PAYMENT' && b.payBy && <p>Held until {fmtDate(b.payBy)}, {fmtTime(b.payBy)} while the parent pays.</p>}
    {b.status === 'COUNTER_OFFERED' && <p>Waiting for the parent to respond to your offer.</p>}
    {b.teachingMode === 'ONLINE' && active && <div className="space-y-2 border-y border-brand-100 py-4">
      <h3 className="font-bold text-navy">Online classroom</h3>
      <p className="text-sm text-slate-600">The parent can join from their confirmed lesson details.</p>
      {b.meetingLink && /^https:\/\//i.test(b.meetingLink) && <a href={b.meetingLink} target="_blank" rel="noreferrer" className="btn-outline min-h-11">Open class link</a>}
      {Date.parse(b.endAt) > now && <button disabled={busy || needsRefresh} className="btn-outline min-h-11" onClick={() => choose('link')}>{b.meetingLink ? 'Edit class link' : 'Add class link'}</button>}
    </div>}
    {request && ['PENDING','ESCALATED'].includes(request.status) && <div className="space-y-2 rounded-lg bg-brand-50 p-3">
      <b>{request.status === 'ESCALATED' ? 'Admin reviewing time change' : 'Proposed time change'}</b>
      <p>{fmtDate(request.startAt)}, {fmtTime(request.startAt)} · {request.reason}</p>
      {request.status === 'PENDING' && active && <div className="flex flex-wrap gap-2">{request.mine ? button('withdraw-time') : <>{button('approve-time')}{button('decline-time')}</>}</div>}
    </div>}
    <div className="flex flex-wrap gap-2">
      {b.status === 'PENDING' && <>{button('accept', true)}{button('counter')}{button('decline')}</>}
      {active && future && <>{!['PENDING','ESCALATED'].includes(request?.status) && button('reschedule')}{button('cancel')}</>}
      {(active || groups.Requests.includes(b.status) || b.status === 'CANCELLED') && button('escalate')}
    </div>
    {form && <form key={form} className="space-y-3 rounded-xl border border-brand-200 p-3" onSubmit={e => {
      e.preventDefault()
      const fields = Object.fromEntries(new FormData(e.currentTarget))
      if (form === 'counter') fields.price = Number(fields.price)
      if (form.endsWith('-time')) fields.requestId = request.id
      submit(form, fields)
    }}>
      <h3 className="font-bold text-navy">{labels[form]}</h3>
      {form === 'link' && <label className="block">Class link (HTTPS)<input className="input min-h-11 w-full text-base" type="url" name="url" required pattern="https://.+" maxLength={191} defaultValue={b.meetingLink || ''} placeholder="https://meet.google.com/…" /></label>}
      {form === 'counter' && <label className="block">Hourly rate (RM)<input className="input min-h-11 text-base" type="number" name="price" required min="0.01" max="1000" step="0.01" /></label>}
      {form === 'reschedule' && <div className="grid gap-2 sm:grid-cols-2"><label>Date<input className="input min-w-0 text-base" type="date" required name="date" /></label><label>Start time<select className="input text-base" name="startTime">{Array.from({length:15}, (_, i) => String(7+i).padStart(2,'0') + ':00').map(t => <option key={t}>{t}</option>)}</select></label></div>}
      {['cancel','decline','escalate','reschedule'].includes(form) && <label className="block">Reason<textarea className="input text-base" name="reason" required maxLength={200} /></label>}
      {form === 'cancel' && b.status === 'CONFIRMED' && <p className="text-sm">Cancelling a paid lesson requests a full refund for the parent.</p>}
      <div className="flex flex-wrap gap-2"><button disabled={busy || needsRefresh} className="btn-primary min-h-11">{busy ? 'Saving…' : 'Confirm'}</button><button type="button" className="btn-outline min-h-11" disabled={busy} onClick={() => choose('')}>Go back</button></div>
    </form>}
    {error && <ErrorBox>{error}</ErrorBox>}
    {needsRefresh && <button type="button" className="btn-outline min-h-11" disabled={busy} onClick={refresh}>Refresh booking</button>}
    {message && <p role="status" className="font-semibold text-green-700">{message}</p>}
  </section>
}

export default function BookingRequests() {
  const [params] = useSearchParams()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('Requests')
  const [id, setId] = useState(null)
  const [mobileDetail, setMobileDetail] = useState(false)
  const load = useCallback(async (focus) => {
    try {
      const { data } = await api.get('/tutor/bookings')
      setRows(data.bookings)
      const reference = typeof focus === 'string' || typeof focus === 'number' ? focus : params.get('booking')
      const match = data.bookings.find(b => matchesRecordRef(b, reference))
      if (match) { setTab(groupFor(match)); setId(match.id); setMobileDetail(true) }
      setError('')
    } catch (e) { setError(errorMessage(e)) }
  }, [params])
  useEffect(() => { load() }, [load])
  const visible = rows?.filter(b => groupFor(b) === tab) || []
  const selected = visible.find(b => b.id === id) || visible[0]
  function updated(b) {
    setRows(prev => prev.map(row => row.id === b.id ? b : row))
    setTab(groupFor(b))
    setId(b.id)
  }
  return <div className="min-w-0 space-y-4">
    <TutorPageHeader title="Booking requests" subtitle="Review parents’ offers and manage your lessons." />
    {error ? <LoadError message={error} onRetry={load} /> : !rows ? <Spinner /> : <>
      <div className="flex flex-wrap gap-2" aria-label="Booking filters">{Object.keys(groups).map(g => <button key={g} aria-pressed={g === tab} className={(g === tab ? 'btn-primary' : 'btn-outline') + ' min-h-11'} onClick={() => { setTab(g); setId(null); setMobileDetail(false) }}>{g} ({rows.filter(b => groupFor(b) === g).length})</button>)}</div>
      {!selected ? <div className="card p-6">No bookings in this section yet.</div> : <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(15rem,1fr)_minmax(0,2fr)]">
        <div className={(mobileDetail ? 'hidden lg:block ' : '') + 'card min-w-0 space-y-2 p-3'}>{visible.map(b => <button key={b.id} aria-pressed={selected.id === b.id} className="block min-h-11 w-full break-words rounded-lg border border-brand-100 p-3 text-left aria-pressed:bg-brand-50" onClick={() => { setId(b.id); setMobileDetail(true) }}>
          <strong className="block text-navy">{b.subject} · {b.child.name}</strong><span className="text-sm">{fmtDate(b.startAt)}, {fmtTime(b.startAt)} · {b.parentName}</span>
        </button>)}</div>
        <div className={(mobileDetail ? '' : 'hidden lg:block ') + 'min-w-0 space-y-2'}>
          <button className="btn-outline min-h-11 lg:hidden" onClick={() => setMobileDetail(false)}>Back to list</button>
          <BookingDetails key={selected.id} b={selected} onUpdate={updated} onReload={() => load(recordRef(selected))} />
        </div>
      </div>}
    </>}
  </div>
}
