import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import { EmptyState, ErrorBox, LoadError, Modal, PageTitle, Spinner, StatusPill, VerifiedTick } from '../../components/ui/Common'
import LessonDetails from '../../components/LessonDetails'
import LessonLocationPicker from '../../components/LessonLocationPicker'
import RescheduleModal from '../../components/RescheduleModal'
import { pickImage } from '../../components/PhotoPicker'
import { downloadFile } from '../../lib/download'
import { fmtDate, fmtDateLong, fmtTime, fmtTimeRange, money, toYmd } from '../../lib/format'
import { matchesRecordRef, recordRef } from '../../lib/recordRef'
import { canEditLessonLocation, hasConfirmedLessonLocation } from '../../lib/lessonLocation'
import { lessonLocationError, lessonLocationPayload } from '../../lib/lessonLocationInput'

const GROUPS = {
  pending: ['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT'],
  upcoming: ['CONFIRMED'],
  completed: ['COMPLETED', 'DISPUTED'],
  cancelled: ['CANCELLED', 'REJECTED'],
}
const TABS = [['upcoming', 'Upcoming'], ['pending', 'Pending'], ['attention', 'Needs attention'], ['completed', 'Completed'], ['cancelled', 'Cancelled & declined'], ['all', 'All']]
const validTab = value => TABS.some(([key]) => key === value)
const PAGE_SIZE = 5
const GROUP_LABELS = { upcoming: 'upcoming lessons', pending: 'pending requests', attention: 'lessons needing attention', completed: 'completed lessons', cancelled: 'cancelled and declined bookings' }
const needsAttention = (b, now) => b.status === 'CONFIRMED' && Date.parse(b.endAt) <= now
function groupFor(b, now) {
  if (needsAttention(b, now)) return 'attention'
  return Object.keys(GROUPS).find(group => GROUPS[group].includes(b.status)) || 'all'
}
const joinable = (b, now) => b.status === 'CONFIRMED' && Date.parse(b.endAt) > now && b.teachingMode === 'ONLINE' && /^https:\/\//i.test(b.meetingLink || '')
const payable = (b, now) => b.status === 'AWAITING_PAYMENT' && Date.parse(b.startAt) > now && (!b.payBy || Date.parse(b.payBy) > now)
function orderBookings(rows, group, order) {
  const latestFirst = order === 'new' || (order === 'auto' && ['attention', 'completed', 'cancelled'].includes(group))
  return [...rows].sort((a, b) => latestFirst ? new Date(b.startAt) - new Date(a.startAt) : new Date(a.startAt) - new Date(b.startAt))
}

export default function MyBookings() {
  const [params, setParams] = useSearchParams()
  const tab = validTab(params.get('tab')) ? params.get('tab') : 'upcoming'
  const [bookings, setBookings] = useState(null)
  const [now, setNow] = useState(Date.now)
  const clock = useRef({ time: null, receivedAt: null })
  const [sortOrder, setSortOrder] = useState('auto')
  const [expanded, setExpanded] = useState({ tab, sortOrder: 'auto', limits: {} })
  const [detail, setDetail] = useState(null)
  const [cancelFor, setCancelFor] = useState(null)
  const [reviewFor, setReviewFor] = useState(null)
  const [rescheduleFor, setRescheduleFor] = useState(null)
  const [locationFor, setLocationFor] = useState(null)
  const [success, setSuccess] = useState('')
  const [notice, setNotice] = useState('')
  const [calendarBusy, setCalendarBusy] = useState(false)
  const inFlight = useRef(false)
  const [acting, setActing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const refreshRequired = useRef(false)
  const applyBookings = useCallback(data => {
    const serverTime = Date.parse(data.serverTime)
    const time = Number.isFinite(serverTime) ? serverTime : Date.now()
    clock.current = { time, receivedAt: performance.now() }
    setNow(time)
    setBookings(data.bookings)
    refreshRequired.current = false
    setNeedsRefresh(false)
  }, [])
  const load = useCallback(() => {
    setLoadError('')
    setRefreshing(true)
    return api.get('/parent/bookings').then(r => {
      applyBookings(r.data)
      return true
    }).catch(e => {
      setLoadError(errorMessage(e))
      refreshRequired.current = true
      setNeedsRefresh(true)
      return false
    }).finally(() => setRefreshing(false))
  }, [applyBookings])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const tick = () => {
      if (clock.current.time != null) setNow(clock.current.time + performance.now() - clock.current.receivedAt)
    }
    const timer = setInterval(tick, 1000)
    window.addEventListener('focus', tick)
    return () => { clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [])

  // A notification opens its booking and selects the matching group, unless an
  // explicit group was supplied. Closing details leaves that booking reachable.
  const focusId = params.get('booking')
  useEffect(() => {
    if (!focusId || !bookings) return
    const b = bookings.find(x => matchesRecordRef(x, focusId))
    if (b) {
      setDetail(b)
      const group = groupFor(b, now)
      const destinationTab = validTab(params.get('tab')) ? params.get('tab') : group
      const position = orderBookings(bookings.filter(row => groupFor(row, now) === group), group, sortOrder).findIndex(row => matchesRecordRef(row, focusId))
      // An older notification can target a row beyond the first five. Keep it
      // visible after its details close without expanding every history group.
      setExpanded({ tab: destinationTab, sortOrder, limits: { [group]: Math.max(PAGE_SIZE, Math.ceil((position + 1) / PAGE_SIZE) * PAGE_SIZE) } })
    }
    setParams(p => {
      p.delete('booking')
      if (b && !validTab(p.get('tab'))) {
        const group = groupFor(b, now)
        if (group !== 'upcoming') p.set('tab', group)
      }
      return p
    }, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, bookings])

  const counts = useMemo(() => {
    const list = bookings || []
    const n = group => list.filter(b => GROUPS[group].includes(b.status)).length
    const attention = list.filter(b => needsAttention(b, now)).length
    return { all: list.length, pending: n('pending'), upcoming: n('upcoming') - attention, attention, completed: n('completed'), cancelled: n('cancelled') }
  }, [bookings, now])
  if (!bookings) return loadError ? <LoadError message={loadError} onRetry={load} /> : <Spinner />
  const currentDetail = detail && (bookings.find(b => matchesRecordRef(b, recordRef(detail))) || detail)
  const show = group => tab === 'all' || tab === group
  const sections = [
    ['upcoming', 'Upcoming Lessons', 'Confirmed future lessons and lessons in progress.'],
    ['pending', 'Pending Requests', 'Requests, counter-offers and lessons awaiting payment.'],
    ['attention', 'Needs attention', 'Past lessons awaiting completion or administrator review.'],
    ['completed', 'Completed Lessons', 'Finished lessons and disputed attendance records.'],
    ['cancelled', 'Cancelled & Declined', 'Requests and lessons that did not go ahead.'],
  ].filter(([group]) => show(group)).map(([group, title, description]) => [group, title, description, orderBookings(bookings.filter(b => groupFor(b, now) === group), group, sortOrder)])

  function changeTab(next) {
    setExpanded({ tab: next, sortOrder, limits: {} })
    setParams(next === 'upcoming' ? {} : { tab: next })
  }
  function changeSort(next) {
    setSortOrder(next)
    setExpanded({ tab, sortOrder: next, limits: {} })
  }
  function visibleLimit(group) {
    return expanded.tab === tab && expanded.sortOrder === sortOrder ? expanded.limits[group] || PAGE_SIZE : PAGE_SIZE
  }
  function showRows(group, limit) {
    setExpanded(current => ({ tab, sortOrder, limits: { ...(current.tab === tab && current.sortOrder === sortOrder ? current.limits : {}), [group]: limit } }))
  }

  async function act(path, body) {
    if (inFlight.current || refreshRequired.current) return false
    inFlight.current = true
    setActing(true)
    setNotice('')
    try {
      await api.post(path, body)
      await load()
      return true
    } catch (err) {
      setNotice(errorMessage(err))
      load()
      return false
    } finally { inFlight.current = false; setActing(false) }
  }
  const handlers = {
    onCancel: b => { setNotice(''); setDetail(null); setCancelFor(b) },
    onReview: b => { setDetail(null); setReviewFor(b) },
    onReschedule: b => { setDetail(null); setRescheduleFor(b) },
    act,
  }
  function updatedLocation(booking) {
    setBookings(rows => rows.map(row => matchesRecordRef(row, recordRef(booking)) ? booking : row))
    setDetail(current => current && matchesRecordRef(current, recordRef(booking)) ? booking : current)
    setSuccess(locationFor?.status === 'COUNTER_OFFERED' && booking.status === 'PENDING'
      ? 'Lesson address saved. The counter-offer was cleared so the tutor can review the new venue and rate.'
      : 'Lesson address saved. Your tutor has been notified.')
    setLocationFor(null)
  }

  return <div>
    <PageTitle icon="calendar" title="My Bookings" subtitle="View your lessons at a glance. Open the details to manage a booking."
      right={<Link to="/parent/find-tutor" className="btn-outline min-h-11 px-4 text-sm">Find a Tutor</Link>} />
    <div className="card mb-4 space-y-3 p-3 sm:p-4">
      <div className="sm:hidden">
        <label htmlFor="booking-group-filter" className="mb-1.5 block text-sm font-semibold text-navy">Booking group</label>
        <select id="booking-group-filter" value={tab} onChange={e => changeTab(e.target.value)} className="input min-h-11 w-full">
          {TABS.map(([key, label]) => <option key={key} value={key}>{label} ({counts[key]})</option>)}
        </select>
      </div>
      <nav aria-label="Booking groups" className="hidden flex-wrap gap-2 sm:flex">
        {TABS.map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key}
          onClick={() => changeTab(key)}
          className={'min-h-11 rounded-lg border px-3 py-2 text-sm font-semibold ' + (tab === key ? 'border-brand-500 bg-brand-500 text-white' : 'border-brand-200 bg-white text-navy hover:border-brand-500')}>
          {label} ({counts[key]})
        </button>)}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <label className="flex max-w-full items-center gap-2 text-sm text-slate-600">Sort by:
          <select className="input min-h-11 w-44 max-w-full font-medium text-navy" value={sortOrder} onChange={e => changeSort(e.target.value)}>
            <option value="auto">Recommended order</option><option value="old">Date (earliest first)</option><option value="new">Date (latest first)</option>
          </select>
        </label>
        {bookings.some(b => b.status === 'CONFIRMED' && Date.parse(b.startAt) > now) && <button type="button" disabled={calendarBusy}
          onClick={async () => { setCalendarBusy(true); setNotice(await downloadFile('/parent/bookings/calendar.ics', 'wondertutor-upcoming-lessons.ics')); setCalendarBusy(false) }}
          className="btn-outline min-h-11 max-w-full px-3 text-left text-sm">
          <Icon name="calendar" className="h-4 w-4 shrink-0" /> {calendarBusy ? 'Preparing…' : 'Add all upcoming lessons to my calendar'}
        </button>}
      </div>
    </div>
    {!currentDetail && !cancelFor && !needsRefresh && <ErrorBox className="mb-4">{notice}</ErrorBox>}
    {!currentDetail && !cancelFor && needsRefresh && <div className="mb-4 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
      <ErrorBox>{loadError}</ErrorBox>
      <p className="text-sm text-amber-900">Refresh your bookings to check the latest status before taking another action.</p>
      <button type="button" disabled={refreshing} onClick={load} className="btn-outline min-h-11 px-3 text-sm">{refreshing ? 'Refreshing…' : 'Refresh bookings'}</button>
    </div>}
    {success && <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{success}</p>}
    {tab === 'upcoming' && counts.attention > 0 && <p className="mb-4 rounded-xl bg-amber-50 px-4 py-2 text-sm text-amber-900">
      {counts.attention} {counts.attention === 1 ? 'past lesson needs' : 'past lessons need'} attention. <Link to="?tab=attention" className="inline-flex min-h-9 items-center font-semibold underline">Review past lessons</Link>
    </p>}
    {counts[tab] === 0 && <div className="card"><EmptyState icon="calendar" title={tab === 'upcoming' ? 'No upcoming lessons' : 'No bookings in this group'}
      action={tab === 'upcoming' && counts.pending > 0 ? <Link to="?tab=pending" className="btn-primary mt-2">View pending requests</Link> : <Link to="/parent/find-tutor" className="btn-primary mt-2">Find a Tutor</Link>}>
      {tab === 'upcoming' ? 'Confirmed future lessons appear here. Check Pending for requests and lessons awaiting payment.' : 'Choose another group to view your other bookings.'}
    </EmptyState></div>}
    <div className="space-y-4" aria-busy={acting}>
      {sections.map(([group, title, description, rows]) => {
        if (!rows.length) return null
        const limit = visibleLimit(group)
        const visible = rows.slice(0, limit)
        const remaining = rows.length - visible.length
        const more = Math.min(PAGE_SIZE, remaining)
        return <section key={group} className="card overflow-hidden">
        <div className="border-b border-slate-100 bg-brand-25 px-4 py-3">
          <div className="flex items-center gap-2"><h2 className="text-base font-bold text-navy">{title}</h2><span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600">{rows.length}</span></div>
          <p className="mt-0.5 text-xs text-slate-500">{description}</p>
        </div>
        <div className="divide-y divide-slate-100">{visible.map(b => <CompactBookingRow key={recordRef(b)} b={b} now={now} actionsBlocked={needsRefresh} onDetail={booking => { setNotice(''); setDetail(booking) }} />)}</div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2">
          <p className="text-xs text-slate-500">Showing {visible.length} of {rows.length}</p>
          {(remaining > 0 || visible.length > PAGE_SIZE) && <div className="flex flex-wrap gap-2">
            {visible.length > PAGE_SIZE && <button type="button" aria-label={'Show fewer ' + GROUP_LABELS[group]} onClick={() => showRows(group, PAGE_SIZE)} className="btn-outline min-h-11 px-3 text-sm">Show fewer</button>}
            {remaining > 0 && <button type="button" aria-label={'View ' + more + ' more ' + GROUP_LABELS[group]} onClick={() => showRows(group, limit + PAGE_SIZE)} className="btn-outline min-h-11 px-3 text-sm">View {more} more</button>}
          </div>}
        </div>
      </section>})}
    </div>

    <LessonDetails key={currentDetail ? recordRef(currentDetail) : 'closed'} booking={currentDetail} now={now} actionsDisabled={needsRefresh || acting} onClose={() => setDetail(null)} onChanged={load}
      onLocation={b => { if (!refreshRequired.current) { setDetail(null); setLocationFor(b) } }}
      actions={currentDetail && <div className="min-w-0 space-y-3">
        <ErrorBox>{needsRefresh ? loadError : notice}</ErrorBox>
        {needsRefresh ? <>
          <p className="text-sm text-amber-900">Refresh this booking to check its latest status before taking another action. Your previous action will not be resent.</p>
          <button type="button" disabled={refreshing} onClick={load} className="btn-outline min-h-11 w-full px-3 text-sm">{refreshing ? 'Refreshing…' : 'Refresh bookings'}</button>
        </> : <fieldset disabled={acting} aria-label="Booking actions" className="min-w-0 space-y-3 disabled:opacity-60">
          <BookingDetailActions key={recordRef(currentDetail)} b={currentDetail} now={now} {...handlers} />
        </fieldset>}
      </div>} />
    {locationFor && <LocationModal key={recordRef(locationFor)} booking={locationFor} now={now} onClose={() => setLocationFor(null)} onUpdate={updatedLocation} onRefresh={async () => {
      const { data } = await api.get('/parent/bookings')
      applyBookings(data)
      const fresh = data.bookings.find(b => matchesRecordRef(b, recordRef(locationFor)))
      if (!fresh) throw new Error('This booking is no longer available. Close this form and review your bookings.')
      return fresh
    }} />}
    <RescheduleModal booking={rescheduleFor} onClose={() => setRescheduleFor(null)} onSubmit={async body => {
      try { await api.post('/parent/bookings/' + recordRef(rescheduleFor) + '/reschedule', body); setRescheduleFor(null); await load(); return null }
      catch (err) { return errorMessage(err) }
    }} />
    <CancelModal key={cancelFor ? recordRef(cancelFor) : 'closed'} booking={cancelFor} error={notice} onClose={() => setCancelFor(null)} onConfirm={async reason => {
      const cancelled = await act('/parent/bookings/' + recordRef(cancelFor) + '/cancel', { reason })
      if (cancelled) setCancelFor(null)
      return cancelled
    }} />
    <ReviewModal key={reviewFor ? recordRef(reviewFor) : 'closed'} booking={reviewFor} onClose={() => setReviewFor(null)} onDone={() => { setReviewFor(null); load() }} />
  </div>
}

function bookingHint(b, now) {
  if (needsAttention(b, now)) return 'Attendance or completion needs review.'
  if (b.reschedule?.status === 'ESCALATED') return 'Time change under administrator review.'
  if (b.reschedule?.status === 'PENDING') return b.reschedule.requestedBy === 'PARENT' ? 'Reschedule requested; waiting for tutor.' : 'New time proposed — review the details.'
  if (b.status === 'AWAITING_PAYMENT') return b.payBy ? 'Pay by ' + fmtDate(b.payBy) + ', ' + fmtTime(b.payBy) : 'Payment needed to confirm this lesson.'
  if (b.status === 'COUNTER_OFFERED') return 'Tutor proposed a different rate.'
  if (b.status === 'PENDING') return 'Waiting for the tutor’s response.'
  if (b.status === 'DISPUTED') return 'Attendance is under administrator review.'
  if (b.status === 'COMPLETED') return b.review ? 'Review submitted.' : 'You can leave a review.'
  if (b.status === 'REJECTED') return 'The tutor declined this request.'
  if (b.status === 'CANCELLED') return b.payment?.status === 'REFUNDED' ? 'Payment refunded.' : 'This booking was cancelled.'
  if (Date.parse(b.startAt) <= now) return 'Lesson in progress'
  if (b.teachingMode === 'PHYSICAL' && !hasConfirmedLessonLocation(b)) return 'Confirm the lesson address in View Details.'
  const days = Math.round((Date.parse(toYmd(b.startAt) + 'T00:00:00+08:00') - Date.parse(toYmd(now) + 'T00:00:00+08:00')) / 86400000)
  return days === 0 ? 'Lesson today' : days === 1 ? 'Lesson tomorrow' : 'Lesson in ' + days + ' days'
}

function CompactBookingRow({ b, now, onDetail, actionsBlocked = false }) {
  const join = !actionsBlocked && joinable(b, now)
  const pay = !actionsBlocked && payable(b, now)
  const price = b.status === 'COUNTER_OFFERED' ? b.counterPrice : b.hourlyPrice ?? b.agreedPrice ?? b.proposedPrice
  return <article aria-label={b.subject + ' with ' + b.tutor.name + ' for ' + b.child.name}
    className="grid min-w-0 gap-3 p-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center">
    <div className="flex min-w-0 items-center gap-3">
      <Avatar src={b.tutor.photoUrl} name={b.tutor.name} className="h-11 w-11 shrink-0" rounded="rounded-xl" />
      <div className="min-w-0">
        <Link to={'/parent/tutors/' + b.tutor.id} className="flex min-w-0 items-center gap-1 font-bold text-navy hover:text-brand-600"><span className="break-words">{b.tutor.name}</span>{b.tutor.verified && <VerifiedTick />}</Link>
        <p className="break-words text-sm text-slate-600">{b.subject} · {b.child.name}</p>
      </div>
    </div>
    <div className="min-w-0 text-sm">
      <p className="font-semibold text-navy">{fmtDate(b.startAt)}</p>
      <p className="text-slate-600">{fmtTimeRange(b.startAt, b.endAt)} <span className="whitespace-nowrap">· {b.teachingMode === 'ONLINE' ? 'Online' : 'Physical'}</span></p>
    </div>
    <div className="min-w-0 space-y-1">
      <div className="flex flex-wrap items-center gap-2"><StatusPill status={b.status} /><span className="whitespace-nowrap text-sm font-semibold text-navy">{price == null ? 'Rate pending' : money(price) + ' / hour'}</span></div>
      <p className={'break-words text-xs ' + (needsAttention(b, now) || b.status === 'AWAITING_PAYMENT' || b.status === 'COUNTER_OFFERED' ? 'text-amber-800' : 'text-slate-500')}>{bookingHint(b, now)}</p>
    </div>
    <div className={'grid gap-2 lg:min-w-32 lg:grid-cols-1 ' + (join || pay ? 'grid-cols-2' : 'grid-cols-1')}>
      {join && <a href={b.meetingLink} target="_blank" rel="noreferrer" className="btn-primary min-h-11 px-3 text-sm">Join online class</a>}
      {pay && <Link to="/parent/payments" className="btn-primary min-h-11 px-3 text-sm">Pay Now</Link>}
      <button type="button" onClick={() => onDetail(b)} className="btn-outline min-h-11 px-3 text-sm">View Details</button>
    </div>
  </article>
}

function LocationModal({ booking, now, onClose, onUpdate, onRefresh }) {
  const [current, setCurrent] = useState(booking)
  const [value, setValue] = useState(() => hasConfirmedLessonLocation(booking)
    ? { address: booking.location, latitude: booking.latitude, longitude: booking.longitude, confirmed: false }
    : { address: '', latitude: null, longitude: null, confirmed: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [message, setMessage] = useState('')
  const allowed = canEditLessonLocation(current, now)
  const locked = !allowed || needsRefresh
  async function save(event) {
    event.preventDefault()
    if (busy || locked) return
    const validation = lessonLocationError(value)
    if (validation) return setError(validation)
    setError(''); setBusy(true)
    try {
      const { data } = await api.put(`/parent/bookings/${recordRef(current)}/location`, { ...lessonLocationPayload(value), version: current.updatedAt })
      onUpdate(data.booking)
    } catch (err) {
      setError(errorMessage(err))
      setNeedsRefresh(err.response?.status === 409)
    } finally { setBusy(false) }
  }
  async function refresh() {
    setBusy(true); setError('')
    try {
      const fresh = await onRefresh()
      setCurrent(fresh)
      setValue(draft => ({ ...draft, confirmed: false }))
      setNeedsRefresh(false)
      setMessage('Booking refreshed. Your draft has been kept. Review the latest booking and confirm the address again before saving.')
    } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  return <Modal open onClose={() => { if (!busy) onClose() }} title={booking.locationConfirmedAt ? 'Edit lesson address' : 'Confirm lesson address'} width="max-w-2xl">
    <form onSubmit={save} className="min-w-0 space-y-4">
      <p className="text-sm text-slate-600">{current.subject} with {current.tutor.name} · {fmtDateLong(current.startAt)}, {fmtTimeRange(current.startAt, current.endAt)}</p>
      <p className="text-sm text-slate-600">Enter the full lesson address and place the pin at its entrance. Your tutor uses this point for GPS attendance. This address applies to this lesson only.</p>
      {!booking.locationConfirmedAt && booking.location && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Previous area: {booking.location}. This is not a confirmed lesson address or entrance pin.</p>}
      {current.locationConfirmedAt && <p className="break-words rounded-lg bg-brand-25 p-3 text-sm"><b>Current saved address:</b> {current.location}</p>}
      {['PENDING', 'COUNTER_OFFERED'].includes(current.status) && <p className="text-sm text-slate-600">The venue is fixed once the tutor accepts. Changing a counter-offer’s venue sends it back to the tutor for review.</p>}
      {!allowed && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This lesson address can no longer be changed. A confirmed venue is fixed after acceptance, and attendance locks the address. If you need a different venue, cancel and book again.</p>}
      <ErrorBox>{error}</ErrorBox>
      {message && <p role="status" className="text-sm text-slate-700">{message}</p>}
      <LessonLocationPicker value={value} onChange={setValue} disabled={busy || locked} />
      {needsRefresh && <button type="button" onClick={refresh} disabled={busy} className="btn-outline min-h-11 w-full sm:w-auto">Refresh booking and review</button>}
      <div className="flex flex-wrap gap-2">
        <button disabled={busy || locked} className="btn-primary min-h-11 flex-1 sm:flex-none">{busy ? 'Saving…' : 'Save lesson address'}</button>
        <button type="button" className="btn-outline min-h-11" disabled={busy} onClick={onClose}>Go back</button>
      </div>
    </form>
  </Modal>
}

const Btn = ({ kind = 'outline', children, ...rest }) => <button type="button" className={(kind === 'primary' ? 'btn-primary' : kind === 'danger' ? 'btn-danger' : 'btn-outline') + ' min-h-11 w-full'} {...rest}>{children}</button>

function BookingDetailActions({ b, now, onCancel, onReview, onReschedule, act }) {
  const future = Date.parse(b.startAt) > now
  const ended = Date.parse(b.endAt) <= now
  const canMove = !['PENDING', 'ESCALATED'].includes(b.reschedule?.status)
  if (b.status === 'PENDING') return <div className="space-y-3">
    <p className="text-sm text-slate-600">Waiting for the tutor's response.</p>
    <Btn kind="danger" onClick={() => onCancel(b)}>Cancel Request</Btn>
    <NegotiationForm b={b} act={act} />
  </div>
  if (b.status === 'COUNTER_OFFERED') return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-3 rounded-xl bg-brand-25 p-3 text-sm">
      <div><p className="text-slate-600">Your proposed price</p><b>{money(b.proposedPrice)} / hour</b></div>
      <div><p className="text-slate-600">Tutor's counter-offer</p><b>{money(b.counterPrice)} / hour</b></div>
    </div>
    <div className="grid gap-2 sm:grid-cols-2"><Btn kind="primary" onClick={() => act('/parent/bookings/' + recordRef(b) + '/accept-counter')}>Accept Counter Offer</Btn><Btn onClick={() => act('/parent/bookings/' + recordRef(b) + '/decline-counter')}>Decline</Btn></div>
    <NegotiationForm b={b} act={act} counter />
  </div>
  if (b.status === 'AWAITING_PAYMENT') return <div className="space-y-3">
    {b.payBy && <p className="text-sm">Pay by {fmtDate(b.payBy)}, {fmtTime(b.payBy)} (Malaysia time).</p>}
    <RescheduleBanner b={b} act={act} />
    {payable(b, now) ? <Link to="/parent/payments" className="btn-primary min-h-11 w-full">Pay Now</Link> : <p className="text-sm text-amber-800">The payment window has ended. Refresh your bookings to check the latest status.</p>}
    {future && <div className="grid gap-2 sm:grid-cols-2">{canMove && <Btn onClick={() => onReschedule(b)}>Reschedule</Btn>}<Btn kind="danger" onClick={() => onCancel(b)}>Cancel Booking</Btn></div>}
  </div>
  if (b.status === 'CONFIRMED' && ended) return <div className="space-y-3 rounded-xl bg-orange-50 p-3 text-sm text-slate-700">
    <p className="font-bold text-navy">{b.summary ? 'A report is recorded, but the lesson status still needs review.' : b.attendance?.checkInAt ? 'Waiting for the tutor to finish the attendance and report.' : 'No tutor check-in or completed report has been recorded.'}</p>
    <p>{b.attendance?.checkInAt ? 'Ask your tutor to finish the attendance and report. If the lesson did not take place as recorded, report the problem for administrator review.' : 'Contact your tutor about the missing record. Report a problem for administrator review if attendance is missing or the lesson did not take place.'}</p>
    {b.payment?.status === 'PAID' && <p>Your payment is still recorded as paid. Open the details to review refund options; refunds require administrator review.</p>}
    <RescheduleBanner b={b} act={act} />
  </div>
  if (b.status === 'CONFIRMED') return <div className="space-y-3">
    <p className="text-sm font-semibold text-navy">{bookingHint(b, now)}</p>
    <RescheduleBanner b={b} act={act} />
    {joinable(b, now) && <a className="btn-primary min-h-11 w-full" href={b.meetingLink} target="_blank" rel="noreferrer">Join online class</a>}
    {future && <div className="grid gap-2 sm:grid-cols-2">{canMove && <Btn onClick={() => onReschedule(b)}>Reschedule</Btn>}<Btn kind="danger" onClick={() => onCancel(b)}>Cancel Booking</Btn></div>}
  </div>
  if (b.status === 'COMPLETED') return b.review
    ? b.review.isHidden && <p className="text-sm text-slate-600">Your review is hidden from the public profile by an administrator. {b.review.moderationReason}</p>
    : <Btn kind="primary" onClick={() => onReview(b)}>Leave a Review</Btn>
  if (b.status === 'DISPUTED') return <p className="rounded-xl bg-orange-50 p-3 text-sm text-slate-700">Your refund request is with our admin team. They will check the lesson record and decide on the refund.</p>
  if (b.status === 'CANCELLED') return <div className="space-y-3">{b.payment?.status === 'REFUNDED' && <StatusPill status="REFUNDED" />}<NegotiationForm b={b} act={act} /></div>
  return null
}

function NegotiationForm({ b, act, counter = false }) {
  const [action, setAction] = useState('')
  if (!action) return <div className="flex flex-wrap gap-2">
    {counter && <Btn onClick={() => setAction('counter')}>Offer another rate</Btn>}
    <Btn onClick={() => setAction('escalate')}>Ask admin to review</Btn>
  </div>
  return <form className="space-y-2" onSubmit={async e => {
    e.preventDefault()
    const value = new FormData(e.currentTarget).get('value')
    if (await act('/parent/bookings/' + recordRef(b) + '/negotiate', action === 'counter' ? { action, price: Number(value) } : { action, reason: value })) setAction('')
  }}>
    {action === 'counter' ? <label>Hourly rate (RM)<input className="input text-base" name="value" type="number" min="0.01" max="1000" step="0.01" required /></label> :
      <label>What should admin review?<textarea className="input text-base" name="value" maxLength={200} required /></label>}
    <div className="flex flex-wrap gap-2"><button className="btn-primary min-h-11">Send</button><button type="button" className="btn-outline min-h-11" onClick={() => setAction('')}>Go back</button></div>
  </form>
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
        <button onClick={() => act(`/parent/bookings/${recordRef(b)}/reschedule/${r.id}/withdraw`)} className="mt-1 min-h-9 font-semibold text-brand-600 hover:underline">Withdraw request</button>
      </div>
    )
  return (
    <div role="status" className="rounded-lg border border-accent/50 bg-accent-50 px-3 py-2 text-xs text-slate-700">
      <div className="flex gap-2"><Icon name="refresh" className="h-4 w-4 shrink-0 text-accent-600" /> The tutor asks to move this lesson to <b className="text-navy">{newTime}</b>.{r.reason ? ` Reason: ${r.reason}` : ''}</div>
      <div className="mt-2 flex gap-2">
        <button onClick={() => act(`/parent/bookings/${recordRef(b)}/reschedule/${r.id}/accept`)} className="btn-primary min-h-9 px-3 text-xs">Accept new time</button>
        <button onClick={() => act(`/parent/bookings/${recordRef(b)}/reschedule/${r.id}/decline`)} className="btn-outline min-h-9 px-3 text-xs">Decline</button>
      </div>
    </div>
  )
}

function CancelModal({ booking, error, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (!booking) return null
  const paid = booking.status === 'CONFIRMED'
  return (
    <Modal open onClose={onClose} title={paid ? 'Cancel this booking?' : 'Cancel this request?'}
      footer={<>
        <button onClick={onClose} className="btn-outline">Keep it</button>
        <button disabled={busy} onClick={async () => { setBusy(true); const cancelled = await onConfirm(reason); setBusy(false); if (cancelled) setReason('') }} className="btn bg-red-500 text-white hover:bg-red-600">{busy ? 'Cancelling…' : 'Yes, cancel'}</button>
      </>}>
      <p className="text-sm text-slate-600">{booking.subject} with {booking.tutor.name} on {fmtDateLong(booking.startAt)}, {fmtTimeRange(booking.startAt, booking.endAt)}.</p>
      <ErrorBox className="mt-3">{error}</ErrorBox>
      {paid && <div className="mt-3 flex gap-2 rounded-lg bg-accent-50 p-3 text-sm text-amber-800"><Icon name="info" className="h-4 w-4 shrink-0" /> Because you already paid, your refund request will be reviewed by our Admin team.</div>}
      <label className="mt-3 block text-sm font-semibold text-navy">Reason (optional)
        <textarea rows={3} maxLength={200} className="input mt-1 resize-none" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Schedule changed" /></label>
    </Modal>
  )
}

function ReviewModal({ booking, onClose, onDone }) {
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [photo, setPhoto] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!booking) return null

  async function submit() {
    if (!rating) return setError('Please choose a star rating.')
    setBusy(true)
    try {
      await api.post(`/parent/bookings/${recordRef(booking)}/review`, { rating, comment: comment || undefined, photoUrl: photo || undefined })
      setRating(0); setComment(''); setPhoto(null)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Review ${booking.tutor.name}`}
      footer={<><button onClick={onClose} className="btn-outline">Cancel</button><button disabled={busy || uploading} onClick={submit} className="btn-primary">{busy ? 'Submitting…' : 'Submit Review'}</button></>}>
      <ErrorBox className="mb-3">{error}</ErrorBox>
      <p className="text-sm text-slate-500">How was {booking.child.name}'s {booking.subject} lesson? Your review is public on the tutor's profile.</p>
      <p className="mt-2 text-xs text-slate-600">Honest criticism and low ratings are welcome. Avoid abusive language, advertising and personal contact details. Report safety concerns or quote abusive messages in a private complaint.</p>
      <div className="my-4 flex justify-center gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} onClick={() => setRating(i)} aria-label={`${i} star${i > 1 ? 's' : ''}`}>
            <Icon name="star" fill className={`h-10 w-10 transition ${i <= rating ? 'text-accent' : 'text-slate-200 hover:text-accent/60'}`} strokeWidth={1.5} />
          </button>))}
      </div>
      <label className="block text-sm font-semibold text-navy">Your comments (optional)
        <textarea rows={4} maxLength={500} className="input mt-1 resize-none" placeholder="Tell other parents about the lesson (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      </label>
      <div className="text-right text-xs text-slate-400">{comment.length}/500</div>
      {/* Optional photo, e.g. of the child's work after the lesson */}
      <div className="mt-2 flex items-center gap-3">
        {photo && <img src={photo} alt="Your review photo" className="h-16 w-16 rounded-lg object-cover" />}
        <label className={`btn-outline cursor-pointer px-4 py-1.5 text-xs ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
          <Icon name="camera" className="h-4 w-4" /> {uploading ? 'Uploading…' : photo ? 'Change photo' : 'Add a photo (optional)'}
          <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => pickImage(e, { setBusy: setUploading, setError, onChange: setPhoto })} />
        </label>
        {photo && !uploading && <button type="button" onClick={() => setPhoto(null)} className="text-xs font-semibold text-red-600 hover:underline">Remove</button>}
      </div>
    </Modal>
  )
}
