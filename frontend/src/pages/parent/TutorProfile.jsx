import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useMatching } from '../../assistant/MatchingContext'
import { useAuth } from '../../context/AuthContext'
import PublicBookingActions, { PublicBookLink } from '../../components/PublicBookingActions'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import { ErrorBox, Modal, ModePills, SelectBox, Spinner, Stars, VerifiedTick } from '../../components/ui/Common'
import { dateLabel, dayMonth, fmtShortDate, hhmmLabel, weekdayName } from '../../lib/format'
import { gradeLabel } from '../../lib/education'
import { bookingMode } from '../../lib/availability'
import { childSubjects } from '../../lib/subjects'
import { checkRinggit } from '../../lib/validation'
import { matchesRecordRef, recordRef } from '../../lib/recordRef'
import { ParentHeaderDecor } from '../../components/ParentPageEffects'

const TABS = [['about', 'About', 'user'], ['teaching', 'Teaching Information', 'book'], ['availability', 'Availability', 'calendar'], ['reviews', 'Reviews', 'star']]

// Merge consecutive 1-hour cells into ranges: [09:00-10:00, 10:00-11:00] -> "9:00 AM – 11:00 AM"
export function mergeSlots(slots) {
  const out = []
  for (const s of slots) {
    const last = out[out.length - 1]
    if (last && last.end === s.start) last.end = s.end
    else out.push({ start: s.start, end: s.end })
  }
  return out
}

export default function TutorProfile({ publicView = false }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const matching = useMatching()
  const { user } = useAuth() || {}
  const kids = publicView ? [] : matching?.kids || []
  const kidsLoaded = publicView || matching?.kidsLoaded
  const apiPrefix = publicView ? '/public' : '/parent'
  const browsePath = publicView ? '/tutors' : '/parent/find-tutor'
  const [tutor, setTutor] = useState(null)
  const [error, setError] = useState('')
  const [favError, setFavError] = useState('')
  const [favBusy, setFavBusy] = useState(false)
  const [tab, setTab] = useState('about')
  const refs = { about: useRef(), teaching: useRef(), availability: useRef(), reviews: useRef() }

  useEffect(() => {
    // Public browse cards can be far down the page. Start a newly opened profile
    // at its name and booking action instead of retaining the results scroll.
    if (publicView) window.scrollTo(0, 0)
  }, [publicView, id])

  useEffect(() => {
    let cancelled = false
    setError('')
    setTutor(null)
    api.get(`${apiPrefix}/tutors/${id}`).then((r) => { if (!cancelled) setTutor(r.data.tutor) }).catch((e) => { if (!cancelled) setError(errorMessage(e)) })
    return () => { cancelled = true }
  }, [id, apiPrefix])

  if (error) return <div className="card p-8 text-center text-red-600">{error} <Link to={browsePath} className="ml-2 font-semibold text-brand-500">Back to Find Tutors</Link></div>
  if (!tutor || !kidsLoaded) return <Spinner />

  async function toggleFav() {
    if (favBusy) return
    setFavBusy(true)
    setFavError('')
    try {
      const r = await api.post(`/parent/favourites/${tutor.id}`)
      setTutor((t) => ({ ...t, isFavourite: r.data.isFavourite }))
    } catch (err) {
      setFavError(errorMessage(err))
    } finally {
      setFavBusy(false)
    }
  }
  // Opened from a link or a new tab there is no previous page in the app, so "Back" goes to the search instead
  const goBack = () => {
    if (publicView) {
      const back = location.state?.fromSearch
      return navigate(typeof back === 'string' && (back === '/tutors' || back.startsWith('/tutors?')) ? back : '/tutors')
    }
    return location.key === 'default' ? navigate(browsePath) : navigate(-1)
  }
  const goTab = (key) => { setTab(key); refs[key].current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return (
    <div className={publicView ? 'py-6' : undefined}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <button onClick={goBack} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand-600 hover:underline">
          <Icon name="arrow-left" className="h-4 w-4" /> Back to Find Tutors
        </button>
        <ParentHeaderDecor compact />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="min-w-0 space-y-4">
          {/* header */}
          <section className="card flex flex-wrap gap-5 p-5">
            <Avatar src={tutor.photoUrl} name={tutor.name} className="h-[170px] w-[150px]" rounded="rounded-2xl" text="text-5xl" />
            <div className="min-w-0 basis-full sm:flex-1 sm:basis-64">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="min-w-0 break-words text-2xl font-extrabold text-navy sm:text-3xl">{tutor.name} {tutor.verified && <VerifiedTick className="inline-block h-6 w-6" />}</h1>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="whitespace-nowrap text-xl font-extrabold text-navy">RM {tutor.hourlyRate} / hour</span>
                  {!publicView && <button onClick={toggleFav} disabled={favBusy} aria-pressed={tutor.isFavourite} aria-label={tutor.isFavourite ? `Remove ${tutor.name} from saved tutors` : `Save ${tutor.name}`} className={`flex h-11 w-11 items-center justify-center rounded-lg border ${tutor.isFavourite ? 'border-red-300 bg-red-50 text-red-500' : 'border-slate-200 text-brand-500'} hover:bg-brand-50`}>
                    <Icon name="heart" fill={tutor.isFavourite} className="h-5 w-5" />
                  </button>}
                </div>
              </div>
              {favError && <p role="alert" className="mt-1 text-sm text-red-700">{favError}</p>}
              <div className="mt-1 flex items-center gap-1.5 text-sm">
                <Icon name="star" fill className="h-4 w-4 text-accent" /> <b className="text-navy">{tutor.rating.toFixed(1)}</b> <span className="text-slate-500">({tutor.reviewCount} reviews)</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600"><Icon name="book" className="h-4 w-4 shrink-0 text-brand-500" /> <span>{tutor.subjects.join(', ')}</span> <span className="text-slate-300">|</span> <span>{tutor.levels}</span></div>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-600"><Icon name="pin" className="h-4 w-4 text-brand-500" /> {tutor.location}</div>
              <div className="mt-3"><ModePills online={tutor.offersOnline} physical={tutor.offersPhysical} /></div>
              <p className="mt-4 rounded-xl bg-brand-50 p-4 text-sm leading-relaxed text-slate-600">
                {tutor.experienceText.headline} teaching {tutor.subjects.join(', ')}. Offers {[tutor.offersOnline && 'online', tutor.offersPhysical && 'physical'].filter(Boolean).join(' and ')} lessons
                {tutor.characteristics.length > 0 && <> with a {tutor.characteristics.join(', ').toLowerCase()} style</>}.
              </p>
              {publicView && (!user || user.role === 'PARENT') && <div className="mt-4"><PublicBookLink tutorId={tutor.id} className="btn-primary min-h-11 w-full sm:w-auto" /></div>}
            </div>
          </section>

          {/* tabs (scroll to the matching section) */}
          <nav className="card sticky top-[84px] z-20 flex overflow-x-auto px-2">
            {TABS.map(([key, label, icon]) => (
              <button key={key} onClick={() => goTab(key)} aria-current={tab === key ? 'true' : undefined} className={`flex shrink-0 items-center gap-2 border-b-[3px] px-5 py-3.5 text-sm font-semibold ${tab === key ? 'border-brand-500 text-brand-500' : 'border-transparent text-navy hover:text-brand-500'}`}>
                <Icon name={icon} className="h-[18px] w-[18px]" /> {label}
              </button>
            ))}
          </nav>

          <div ref={refs.about} className="grid scroll-mt-40 gap-4 md:grid-cols-[1.5fr_1fr]">
            <section className="card p-5">
              <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-navy"><Icon name="user" className="h-5 w-5 text-brand-500" /> About the Tutor</h2>
              <p className="text-sm leading-relaxed text-slate-600">{tutor.bio}</p>
            </section>
            <section className="card p-5">
              <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-navy"><Icon name="cap" className="h-5 w-5 text-brand-500" /> Teaching Approach</h2>
              <ul className="space-y-1.5">
                {tutor.teachingApproach.map((t) => (
                  <li key={t} className="flex items-start gap-2 text-sm text-slate-600"><Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" /> {t}</li>
                ))}
              </ul>
            </section>
          </div>

          <section className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-navy"><Icon name="file" className="h-5 w-5 text-brand-500" /> Qualifications &amp; Experience</h2>
            <div className="grid gap-5 md:grid-cols-3 md:divide-x md:divide-slate-100">
              <div className="flex gap-3">
                <Icon name="cap" className="h-6 w-6 shrink-0 text-brand-500" />
                <div>
                  <div className="font-bold text-navy">Education</div>
                  {tutor.qualifications.length === 0 && <div className="text-sm text-slate-500">Not provided yet</div>}
                  {tutor.qualifications.map((q) => (
                    <div key={q.id} className="mb-1 text-sm text-slate-600">
                      {q.title}{q.status === 'APPROVED' && <span className="ml-2 inline-block rounded-full bg-ok-50 px-2 py-1 text-xs font-semibold text-green-800">Verified qualification</span>}{q.status === 'PENDING' && <span className="ml-1 text-xs text-amber-700">(awaiting verification)</span>}<br />{q.institution}{q.year && <><br />Graduated: {q.year}</>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 md:pl-5">
                <Icon name="briefcase" className="h-6 w-6 shrink-0 text-brand-500" />
                <div>
                  <div className="font-bold text-navy">Teaching Experience</div>
                  <div className="text-sm text-slate-600">{tutor.experienceText.headline}<br />{tutor.experienceText.detail}<br />{tutor.experienceText.period}</div>
                </div>
              </div>
              <div className="flex gap-3 md:pl-5">
                <Icon name="trophy" className="h-6 w-6 shrink-0 text-brand-500" />
                <div>
                  <div className="font-bold text-navy">Relevant Achievements</div>
                  {tutor.achievements.length === 0 ? <div className="text-sm text-slate-500">Not provided yet</div> : (
                    <ul className="list-disc pl-4 text-sm text-slate-600">{tutor.achievements.map((a) => <li key={a}>{a}</li>)}</ul>
                  )}
                </div>
              </div>
            </div>
          </section>

          <div ref={refs.teaching} className="min-w-0 scroll-mt-40 space-y-4">
            <section className="card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-navy"><Icon name="book" className="h-5 w-5 text-brand-500" /> Subjects &amp; Levels</h2>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="min-w-0">
                  <div className="mb-2 text-sm font-bold text-navy">Subjects Taught</div>
                  <div className="flex flex-wrap gap-2">{tutor.subjects.map((s) => <span key={s} className="pill bg-brand-50 text-brand-600">{s}</span>)}</div>
                </div>
                <div className="min-w-0">
                  <div className="mb-2 text-sm font-bold text-navy">Education Levels</div>
                  <div className="flex flex-wrap gap-2">{tutor.grades.map((g) => <span key={g} className="whitespace-nowrap rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600">{g}</span>)}</div>
                </div>
                <div className="min-w-0 border-t border-slate-100 pt-4 sm:col-span-2">
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy"><Icon name="monitor" className="h-4 w-4 text-brand-500" /> Teaching Mode</div>
                  <ModePills online={tutor.offersOnline} physical={tutor.offersPhysical} />
                </div>
              </div>
            </section>
            <section ref={refs.availability} className="card scroll-mt-40 p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="flex items-center gap-2 text-lg font-bold text-navy"><Icon name="calendar" className="h-5 w-5 shrink-0 text-brand-500" /> Availability</h2><p className="mt-1 text-xs text-slate-500">Upcoming week · Malaysia time (MYT)</p></div>
                {publicView
                  ? (!user || user.role === 'PARENT') && <PublicBookLink tutorId={tutor.id} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-500 hover:underline">Choose Dates &amp; Book <Icon name="arrow-right" className="h-3.5 w-3.5 shrink-0" /></PublicBookLink>
                  : <Link to={`/parent/tutors/${tutor.id}/book`} className="inline-flex min-h-10 items-center gap-1 whitespace-nowrap text-sm font-semibold text-brand-500 hover:underline">View Full Availability <Icon name="arrow-right" className="h-3.5 w-3.5 shrink-0" /></Link>}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
                {tutor.upcomingAvailability.map((d) => {
                  const ranges = mergeSlots(d.slots.filter((s) => s.status === 'available'))
                  return (
                    <div key={d.date} className="min-w-0 rounded-lg border border-slate-100 bg-brand-25 px-2 py-3 text-center text-xs leading-relaxed">
                      <div className="font-bold text-navy">{weekdayName(d.date)}</div>
                      <div className="mb-1 text-slate-500">{dayMonth(d.date)}</div>
                      {ranges.length ? ranges.map((r) => <div key={r.start} className="mt-1 text-slate-600"><span className="whitespace-nowrap">{hhmmLabel(r.start).replace(':00', '')}</span><span className="block whitespace-nowrap">– {hhmmLabel(r.end).replace(':00', '')}</span></div>) : <div className="py-2 text-slate-400">—</div>}
                    </div>
                  )
                })}
              </div>
            </section>
          </div>

          <Reviews key={`${apiPrefix}/${tutor.id}`} tutor={tutor} reference={refs.reviews} publicView={publicView} />
        </div>

        {publicView ? <PublicBookingActions tutor={tutor} /> : <BookingPanel tutor={tutor} kids={kids} />}
      </div>
    </div>
  )
}

function Reviews({ tutor, reference, publicView = false }) {
  const [sort, setSort] = useState('recent')
  const [page, setPage] = useState(1)
  const [list, setList] = useState([])
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)
  const [report, setReport] = useState(null)
  const [reported, setReported] = useState(() => new Set())

  useEffect(() => {
    let cancelled = false
    setError('')
    setLoading(true)
    if (page === 1) setList([])
    api.get(`/${publicView ? 'public' : 'parent'}/tutors/${tutor.id}/reviews`, { params: { sort, page } }).then((r) => {
      if (cancelled) return
      setList((prev) => (page === 1 ? r.data.reviews : [...prev, ...r.data.reviews]))
      setMore(r.data.hasMore)
    }).catch((e) => { if (!cancelled) setError(errorMessage(e)) }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tutor.id, sort, page, retry, publicView])

  const total = tutor.ratingDistribution.reduce((s, d) => s + d.count, 0) || 1

  return (
    <section ref={reference} className="card scroll-mt-40 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold text-navy"><Icon name="star" className="h-5 w-5 text-brand-500" /> Reviews from Parents</h2>
        <label className="flex items-center gap-2 text-sm font-semibold text-navy">Sort by:
          <select className="input h-9 w-36 py-1 font-medium" value={sort} onChange={(e) => { setPage(1); setSort(e.target.value) }}>
            <option value="recent">Most Recent</option><option value="highest">Highest Rated</option><option value="lowest">Lowest Rated</option>
          </select>
        </label>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-8">
        <div className="text-center">
          <div className="text-5xl font-extrabold text-navy">{tutor.rating.toFixed(1)} <span className="text-xl text-slate-400">/ 5</span></div>
          <Stars value={tutor.rating} size="h-5 w-5" />
          <div className="mt-1 text-sm text-slate-500">{tutor.reviewCount} reviews</div>
        </div>
        <div className="min-w-0 basis-full flex-1 space-y-1.5 sm:basis-64">
          {tutor.ratingDistribution.map((d) => (
            <div key={d.stars} className="flex items-center gap-3 text-xs text-slate-500">
              <span className="w-12">{d.stars} star{d.stars > 1 ? 's' : ''}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-accent" style={{ width: `${(d.count / total) * 100}%` }} /></span>
              <span className="w-16 text-right">{d.count} ({Math.round((d.count / total) * 100)}%)</span>
            </div>
          ))}
        </div>
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
        {error && <li role="alert" className="p-4 text-sm text-red-700">Reviews could not be loaded: {error} <button onClick={() => setRetry((n) => n + 1)} className="min-h-10 font-semibold underline">Retry</button></li>}
        {loading && <li role="status" className="p-4 text-sm text-slate-500">Loading reviews…</li>}
        {list.length === 0 && !error && !loading && <li className="p-6 text-center text-sm text-slate-500">No reviews yet.</li>}
        {list.map((r) => (
          <li key={r.id} className="flex gap-3 p-4">
            <Avatar name={r.parentName} className="h-11 w-11" text="text-base" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3">
                <div><span className="font-bold text-navy">{r.parentName}</span>{!publicView && <span className="ml-1 text-xs text-slate-500">Parent of {r.parentOf}</span>}</div>
                <div className="flex items-center gap-2 text-xs text-slate-400"><Stars value={r.rating} size="h-3.5 w-3.5" /> {fmtShortDate(r.createdAt)}</div>
              </div>
              {r.comment && <p className="mt-1 break-words whitespace-pre-wrap text-sm text-slate-600">{r.comment}</p>}
              {!publicView && r.photoUrl && (
                <a href={r.photoUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block">
                  <img src={r.photoUrl} alt={`Photo shared by ${r.parentName}`} loading="lazy" className="h-20 w-20 rounded-lg object-cover" />
                </a>
              )}
              {!publicView && <button onClick={() => setReport(r)} disabled={reported.has(r.id)} className="mt-2 block min-h-10 text-xs font-semibold text-slate-500 underline disabled:opacity-60">{reported.has(r.id) ? 'Reported — track in My Complaints' : 'Report this review'}</button>}
            </div>
          </li>
        ))}
      </ul>
      {more && (
        <div className="mt-4 text-center">
          <button disabled={loading || !!error} onClick={() => setPage((p) => p + 1)} className="btn-outline px-6 py-1.5 text-xs">Load More Reviews <Icon name="down" className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {reported.size > 0 && <p role="status" className="mt-3 text-sm text-slate-600">Your report was sent for administrator review. Track it in <Link to="/parent/complaints" className="font-semibold text-brand-600 underline">My Complaints</Link>.</p>}
      {report && <ReportReview review={report} onClose={() => setReport(null)} onDone={() => { setReported((previous) => new Set(previous).add(report.id)); setReport(null) }} />}
    </section>
  )
}

const REPORT_REASONS = ['Abusive or discriminatory content', 'Personal information', 'Spam or advertising', 'Misleading or unrelated content', 'Other']
function ReportReview({ review, onClose, onDone }) {
  const [reason, setReason] = useState(REPORT_REASONS[0])
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    setBusy(true); setError('')
    try {
      await api.post(`/parent/reviews/${review.id}/report`, { reason, details: details || undefined })
      onDone()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <Modal open onClose={onClose} title="Report this review" footer={<><button disabled={busy} onClick={onClose} className="btn-outline">Cancel</button><button disabled={busy} onClick={submit} className="btn-primary">{busy ? 'Sending…' : 'Send report'}</button></>}>
    <p className="mb-3 text-sm text-slate-600">Reports are private. An administrator will investigate; a report does not automatically remove a review. Please do not report a review simply because you disagree with its rating.</p>
    <label className="block text-sm font-semibold text-navy">Reason<select className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)}>{REPORT_REASONS.map((item) => <option key={item}>{item}</option>)}</select></label>
    <label className="mt-3 block text-sm font-semibold text-navy">Details (optional)<textarea rows={3} maxLength={500} className="input mt-1" value={details} onChange={(e) => setDetails(e.target.value)} /></label>
    <ErrorBox className="mt-3">{error}</ErrorBox>
  </Modal>
}

// Right-hand "Book a Lesson" panel. "Continue Booking" carries the choices to the full booking page.
export function BookingPanel({ tutor, kids }) {
  const navigate = useNavigate()
  const requestedMode = new URLSearchParams(useLocation().search).get('mode')
  const availableDays = useMemo(() => tutor.upcomingAvailability.filter((d) => d.slots.some((s) => s.status === 'available')), [tutor])
  const [date, setDate] = useState(availableDays[0]?.date || '')
  const slots = availableDays.find((d) => d.date === date)?.slots.filter((s) => s.status === 'available') || []
  const [time, setTime] = useState(slots[0]?.start || '')
  const [selectedSlots, setSelectedSlots] = useState([])
  const [childId, setChildId] = useState(recordRef(kids[0]) || '')
  const [mode, setMode] = useState(['ONLINE', 'PHYSICAL'].includes(requestedMode) ? requestedMode : tutor.offersPhysical ? 'PHYSICAL' : 'ONLINE')
  const [price, setPrice] = useState(String(tutor.hourlyRate))
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const child = kids.find((k) => matchesRecordRef(k, childId))
  const teachesChild = !child || tutor.grades.includes(gradeLabel(child.educationLevel, child.grade))
  const current = { date, start: time, mode: slots.find((s) => s.start === time)?.mode }
  const lesson = bookingMode(selectedSlots.length ? selectedSlots : [current], mode) // an hour set to one mode decides the mode

  function onDate(v) {
    setDate(v)
    setTime(availableDays.find((d) => d.date === v)?.slots.find((s) => s.status === 'available')?.start || '')
  }

  function onContinue() {
    if (!childId) return setError('Add a child first so we can match the lesson to their level.')
    if (!selectedSlots.length && (!date || !time)) return setError('Please choose an available date and time.')
    const badPrice = checkRinggit(price, 'Proposed price')
    if (badPrice) return setError(badPrice)
    if (lesson.conflict) return setError('Some of these hours are online only and some physical only. Send them as separate requests.')
    const lessons = selectedSlots.length ? selectedSlots : [current]
    navigate(`/parent/tutors/${tutor.id}/book`, { state: { date: lessons[0].date, time: lessons[0].start, slots: lessons, childId: child ? recordRef(child) : childId, subject: childSubjects(child).find(s => tutor.subjects.includes(s)) || tutor.subjects[0], mode: lesson.mode, price, msg } })
  }

  return (
    <aside className="min-w-0 space-y-4">
      <section className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-100 text-accent-600"><Icon name="calendar" className="h-6 w-6" /></span>
          <div>
            <h2 className="text-xl font-extrabold text-navy">Book a Lesson</h2>
            <p className="text-xs text-slate-500">Select lessons here or choose later dates on the full calendar.</p>
          </div>
        </div>
        <div className="space-y-3.5">
          <ErrorBox>{error}</ErrorBox>
          {availableDays.length === 0 && <div className="rounded-lg bg-accent-50 p-3 text-sm text-amber-800">No open slots in the next 7 days. Check the full availability for later weeks.</div>}
          <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Selected Date <span className="text-red-500">*</span></span>
            <SelectBox icon="calendar" value={date} onChange={(e) => onDate(e.target.value)} className="[&_select]:h-10">
              {availableDays.map((d) => <option key={d.date} value={d.date}>{dateLabel(d.date)}</option>)}
            </SelectBox></label>
          <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Selected Time <span className="text-red-500">*</span></span>
            <SelectBox icon="clock" value={time} onChange={(e) => setTime(e.target.value)} className="[&_select]:h-10">
              {slots.map((s) => <option key={s.start} value={s.start}>{hhmmLabel(s.start)} - {hhmmLabel(s.end)}</option>)}
            </SelectBox></label>
          <button type="button" className="btn-outline min-h-11 w-full" disabled={!date || !time || selectedSlots.length >= 12 || selectedSlots.some(s => s.date === date && s.start === time)} onClick={() => setSelectedSlots(list => [...list, current])}>Add selected lesson</button>
          {selectedSlots.length > 0 && <div className="space-y-2" aria-label="Selected lessons">
            <p className="text-sm font-bold text-navy">Selected lessons ({selectedSlots.length}/12)</p>
            {selectedSlots.map(s => <div key={s.date + s.start} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 p-2 text-sm">
              <span>{dateLabel(s.date)} · {hhmmLabel(s.start)}</span>
              <button type="button" className="btn-outline min-h-10 px-2" aria-label={'Remove ' + s.date + ' ' + s.start} onClick={() => setSelectedSlots(current => current.filter(x => x.date !== s.date || x.start !== s.start))}>Remove</button>
            </div>)}
          </div>}
          <Link to={`/parent/tutors/${tutor.id}/book`} state={{ slots: selectedSlots, date: selectedSlots[0]?.date || date, time: selectedSlots[0]?.start || time, childId: child ? recordRef(child) : childId, subject: childSubjects(child).find(s => tutor.subjects.includes(s)) || tutor.subjects[0], mode: lesson.mode, price, msg }} className="inline-flex min-h-10 items-center text-sm font-semibold text-brand-500 hover:underline">Choose other dates on the full calendar →</Link>
          <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Child <span className="text-red-500">*</span></span>
            {kids.length === 0 ? (
              <Link to="/parent/children?add=1" className="btn-outline w-full"><Icon name="plus" className="h-4 w-4" /> Add a child first</Link>
            ) : (
              <SelectBox icon="user" value={child ? recordRef(child) : childId} onChange={(e) => setChildId(e.target.value)} className="[&_select]:h-10">
                {kids.map((k) => <option key={k.id} value={recordRef(k)}>{k.name} ({gradeLabel(k.educationLevel, k.grade)})</option>)}
              </SelectBox>
            )}
          </label>
          {!teachesChild && (
            <div className="flex gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-600"><Icon name="info" className="h-4 w-4 shrink-0" /> This tutor doesn't teach {gradeLabel(child.educationLevel, child.grade)}. Pick another child or tutor.</div>
          )}
          <div>
            <span className="mb-1 block text-sm font-bold text-navy">Teaching Mode <span className="text-red-500">*</span></span>
            <div className="grid grid-cols-2 gap-2">
              {[['ONLINE', 'Online', 'monitor', tutor.offersOnline], ['PHYSICAL', 'Physical', 'home', tutor.offersPhysical]].map(([v, l, icon, ok]) => (
                <button key={v} type="button" disabled={!ok || (lesson.fixed && lesson.fixed !== v)} onClick={() => setMode(v)} className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-semibold disabled:opacity-40 ${lesson.mode === v ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-slate-200 text-navy'}`}>
                  <Icon name={icon} className="h-4 w-4" /> {l}
                </button>
              ))}
            </div>
          </div>
          <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Proposed Price (RM per hour) <span className="text-red-500">*</span></span>
            <input type="number" min="1" className="input h-10" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Message to Tutor <span className="font-normal text-slate-500">(Optional)</span></span>
            <textarea rows={3} maxLength={200} className="input resize-none" placeholder="E.g. My child would like to focus on exam preparation. Thank you!" value={msg} onChange={(e) => setMsg(e.target.value)} />
            <span className="block text-right text-xs text-slate-400">{msg.length}/200</span></label>
          {lesson.mode === 'PHYSICAL' && <p className="rounded-lg bg-brand-50 p-3 text-sm text-navy">Next, confirm the exact lesson address and entrance pin for these lessons.</p>}
          <button onClick={onContinue} disabled={!teachesChild} className="btn-primary h-12 w-full text-base">Continue Booking <Icon name="arrow-right" className="h-4 w-4" /></button>
        </div>
      </section>
      <HowItWorks />
    </aside>
  )
}

export function HowItWorks() {
  return (
    <section className="rounded-2xl border border-accent/40 bg-accent-50 p-5">
      <div className="mb-3 flex gap-2 text-sm">
        <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
        <div><b className="text-navy">This will be a booking request</b><p className="text-slate-600">Your request will be sent to the tutor. The tutor can accept, reject or counter-offer. You will be notified once there is a response.</p></div>
      </div>
      <ol className="space-y-3">
        {[['Send Request', 'Your booking request will be sent to the tutor.'], ['Tutor Responds', 'The tutor can accept, reject or counter-offer.'], ['Booking Confirmed', 'Once both parties agree and you pay, the lesson is confirmed.']].map(([t, d], i) => (
          <li key={t} className="flex gap-3 text-sm">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">{i + 1}</span>
            <div><div className="font-bold text-navy">{t}</div><div className="text-xs text-slate-500">{d}</div></div>
          </li>
        ))}
      </ol>
    </section>
  )
}
