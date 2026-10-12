import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useMatching } from '../../assistant/MatchingContext'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import { ErrorBox, ModePills, SelectBox, Spinner, Stars, VerifiedTick } from '../../components/ui/Common'
import { dateLabel, dayMonth, fmtShortDate, hhmmLabel, weekdayName } from '../../lib/format'
import { gradeLabel } from '../../lib/education'

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

export default function TutorProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { kids, kidsLoaded } = useMatching()
  const [tutor, setTutor] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('about')
  const refs = { about: useRef(), teaching: useRef(), availability: useRef(), reviews: useRef() }

  useEffect(() => {
    setTutor(null)
    api.get(`/parent/tutors/${id}`).then((r) => setTutor(r.data.tutor)).catch((e) => setError(errorMessage(e)))
  }, [id])

  if (error) return <div className="card p-8 text-center text-red-600">{error} <Link to="/parent/find-tutor" className="ml-2 font-semibold text-brand-500">Back to Find Tutors</Link></div>
  if (!tutor || !kidsLoaded) return <Spinner />

  async function toggleFav() {
    const r = await api.post(`/parent/favourites/${tutor.id}`)
    setTutor({ ...tutor, isFavourite: r.data.isFavourite })
  }
  const goTab = (key) => { setTab(key); refs[key].current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

  return (
    <div>
      <button onClick={() => navigate(-1)} className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-500 hover:underline">
        <Icon name="arrow-left" className="h-4 w-4" /> Back to Find Tutors
      </button>

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_390px]">
        <div className="min-w-0 space-y-4">
          {/* header */}
          <section className="card flex flex-wrap gap-5 p-5">
            <Avatar src={tutor.photoUrl} name={tutor.name} className="h-[170px] w-[150px]" rounded="rounded-2xl" text="text-5xl" />
            <div className="min-w-[260px] flex-1">
              <div className="flex items-start justify-between gap-3">
                <h1 className="flex items-center gap-2 text-3xl font-extrabold text-navy">{tutor.name} {tutor.verified && <VerifiedTick className="h-6 w-6" />}</h1>
                <div className="flex items-center gap-3">
                  <span className="text-xl font-extrabold text-navy">RM {tutor.hourlyRate} / hour</span>
                  <button onClick={toggleFav} aria-label="Favourite" className={`flex h-11 w-11 items-center justify-center rounded-lg border ${tutor.isFavourite ? 'border-red-300 bg-red-50 text-red-500' : 'border-slate-200 text-brand-500'} hover:bg-brand-50`}>
                    <Icon name="heart" fill={tutor.isFavourite} className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-sm">
                <Icon name="star" fill className="h-4 w-4 text-accent" /> <b className="text-navy">{tutor.rating.toFixed(1)}</b> <span className="text-slate-500">({tutor.reviewCount} reviews)</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm text-slate-600"><Icon name="book" className="h-4 w-4 text-brand-500" /> {tutor.subjects.join(', ')} <span className="text-slate-300">|</span> {tutor.levels}</div>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-600"><Icon name="pin" className="h-4 w-4 text-brand-500" /> {tutor.location}</div>
              <div className="mt-3"><ModePills online={tutor.offersOnline} physical={tutor.offersPhysical} /></div>
              <p className="mt-4 rounded-xl bg-brand-50 p-4 text-sm leading-relaxed text-slate-600">
                {tutor.experienceText.headline} teaching {tutor.subjects.join(', ')}. Offers {[tutor.offersOnline && 'online', tutor.offersPhysical && 'physical'].filter(Boolean).join(' and ')} lessons
                {tutor.characteristics.length > 0 && <> with a {tutor.characteristics.join(', ').toLowerCase()} style</>}.
              </p>
            </div>
          </section>

          {/* tabs (scroll to the matching section) */}
          <nav className="card sticky top-[84px] z-20 flex overflow-x-auto px-2">
            {TABS.map(([key, label, icon]) => (
              <button key={key} onClick={() => goTab(key)} className={`flex shrink-0 items-center gap-2 border-b-[3px] px-5 py-3.5 text-sm font-semibold ${tab === key ? 'border-brand-500 text-brand-500' : 'border-transparent text-navy hover:text-brand-500'}`}>
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
                      {q.title}<br />{q.institution}{q.year && <><br />Graduated: {q.year}</>}
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
                  <ul className="list-disc pl-4 text-sm text-slate-600">{tutor.achievements.map((a) => <li key={a}>{a}</li>)}</ul>
                </div>
              </div>
            </div>
          </section>

          <div ref={refs.teaching} className="grid scroll-mt-40 gap-4 md:grid-cols-[1.25fr_1fr]">
            <section className="card p-5">
              <h2 className="mb-3 flex items-center gap-2 text-lg font-bold text-navy"><Icon name="book" className="h-5 w-5 text-brand-500" /> Subjects &amp; Levels</h2>
              <div className="grid gap-4 sm:grid-cols-[auto_1fr_auto] sm:divide-x sm:divide-slate-100">
                <div className="sm:pr-4">
                  <div className="mb-2 text-sm font-bold text-navy">Subjects Taught</div>
                  <div className="flex flex-wrap gap-2">{tutor.subjects.map((s) => <span key={s} className="pill bg-brand-50 text-brand-600">{s}</span>)}</div>
                </div>
                <div className="sm:px-4">
                  <div className="mb-2 text-sm font-bold text-navy">Education Levels</div>
                  <div className="flex flex-wrap gap-2">{tutor.grades.map((g) => <span key={g} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600">{g}</span>)}</div>
                </div>
                <div className="sm:pl-4">
                  <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-navy"><Icon name="monitor" className="h-4 w-4 text-brand-500" /> Teaching Mode</div>
                  <ModePills online={tutor.offersOnline} physical={tutor.offersPhysical} />
                </div>
              </div>
            </section>
            <section ref={refs.availability} className="card scroll-mt-40 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-lg font-bold text-navy"><Icon name="calendar" className="h-5 w-5 text-brand-500" /> Availability <span className="text-xs font-normal text-slate-500">(Upcoming 1 Week)</span></h2>
                <Link to={`/parent/tutors/${tutor.id}/book`} className="flex items-center gap-1 text-xs font-semibold text-brand-500 hover:underline">View Full Availability <Icon name="arrow-right" className="h-3.5 w-3.5" /></Link>
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                {tutor.upcomingAvailability.map((d) => {
                  const ranges = mergeSlots(d.slots.filter((s) => s.status === 'available'))
                  return (
                    <div key={d.date} className="rounded-lg border border-slate-100 bg-brand-25 p-1.5 text-center text-[10px] leading-tight">
                      <div className="font-bold text-navy">{weekdayName(d.date)}</div>
                      <div className="mb-1 text-slate-500">{dayMonth(d.date)}</div>
                      {ranges.length ? ranges.slice(0, 2).map((r) => <div key={r.start} className="text-slate-600">{hhmmLabel(r.start).replace(':00', '')}<br />-{hhmmLabel(r.end).replace(':00', '')}</div>) : <div className="py-2 text-slate-400">-</div>}
                    </div>
                  )
                })}
              </div>
            </section>
          </div>

          <Reviews tutor={tutor} reference={refs.reviews} />
        </div>

        <BookingPanel tutor={tutor} kids={kids} />
      </div>
    </div>
  )
}

function Reviews({ tutor, reference }) {
  const [sort, setSort] = useState('recent')
  const [page, setPage] = useState(1)
  const [list, setList] = useState([])
  const [more, setMore] = useState(false)

  useEffect(() => {
    api.get(`/parent/tutors/${tutor.id}/reviews`, { params: { sort, page } }).then((r) => {
      setList((prev) => (page === 1 ? r.data.reviews : [...prev, ...r.data.reviews]))
      setMore(r.data.hasMore)
    })
  }, [tutor.id, sort, page])

  const total = tutor.ratingDistribution.reduce((s, d) => s + d.count, 0) || 1

  return (
    <section ref={reference} className="card scroll-mt-40 p-5">
      <div className="mb-4 flex items-center justify-between">
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
        <div className="min-w-[260px] flex-1 space-y-1.5">
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
        {list.length === 0 && <li className="p-6 text-center text-sm text-slate-500">No reviews yet.</li>}
        {list.map((r) => (
          <li key={r.id} className="flex gap-3 p-4">
            <Avatar name={r.parentName} className="h-11 w-11" text="text-base" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3">
                <div><span className="font-bold text-navy">{r.parentName}</span> <span className="ml-1 text-xs text-slate-500">Parent of {r.parentOf}</span></div>
                <div className="flex items-center gap-2 text-xs text-slate-400"><Stars value={r.rating} size="h-3.5 w-3.5" /> {fmtShortDate(r.createdAt)}</div>
              </div>
              {r.comment && <p className="mt-1 text-sm text-slate-600">{r.comment}</p>}
            </div>
          </li>
        ))}
      </ul>
      {more && (
        <div className="mt-4 text-center">
          <button onClick={() => setPage((p) => p + 1)} className="btn-outline px-6 py-1.5 text-xs">Load More Reviews <Icon name="down" className="h-3.5 w-3.5" /></button>
        </div>
      )}
    </section>
  )
}

// Right-hand "Book a Lesson" panel. "Continue Booking" carries the choices to the full booking page.
function BookingPanel({ tutor, kids }) {
  const navigate = useNavigate()
  const availableDays = useMemo(() => tutor.upcomingAvailability.filter((d) => d.slots.some((s) => s.status === 'available')), [tutor])
  const [date, setDate] = useState(availableDays[0]?.date || '')
  const slots = availableDays.find((d) => d.date === date)?.slots.filter((s) => s.status === 'available') || []
  const [time, setTime] = useState(slots[0]?.start || '')
  const [childId, setChildId] = useState(kids[0]?.id || '')
  const [mode, setMode] = useState(tutor.offersPhysical ? 'PHYSICAL' : 'ONLINE')
  const [price, setPrice] = useState(String(tutor.hourlyRate))
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  const child = kids.find((k) => k.id === Number(childId))
  const teachesChild = !child || tutor.grades.includes(gradeLabel(child.educationLevel, child.grade).replace('Form', 'Form'))

  function onDate(v) {
    setDate(v)
    setTime(availableDays.find((d) => d.date === v)?.slots.find((s) => s.status === 'available')?.start || '')
  }

  function onContinue() {
    if (!childId) return setError('Add a child first so we can match the lesson to their level.')
    if (!date || !time) return setError('Please choose an available date and time.')
    if (!(Number(price) > 0)) return setError('Enter your proposed price per hour.')
    navigate(`/parent/tutors/${tutor.id}/book`, { state: { date, time, childId: Number(childId), mode, price, msg } })
  }

  return (
    <aside className="space-y-4 xl:sticky xl:top-[84px]">
      <section className="card p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-100 text-accent-600"><Icon name="calendar" className="h-6 w-6" /></span>
          <div>
            <h2 className="text-xl font-extrabold text-navy">Book a Lesson</h2>
            <p className="text-xs text-slate-500">Send a booking request to this tutor.</p>
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
          <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Child <span className="text-red-500">*</span></span>
            {kids.length === 0 ? (
              <Link to="/parent/children?add=1" className="btn-outline w-full"><Icon name="plus" className="h-4 w-4" /> Add a child first</Link>
            ) : (
              <SelectBox icon="user" value={childId} onChange={(e) => setChildId(e.target.value)} className="[&_select]:h-10">
                {kids.map((k) => <option key={k.id} value={k.id}>{k.name} ({gradeLabel(k.educationLevel, k.grade)})</option>)}
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
                <button key={v} type="button" disabled={!ok} onClick={() => setMode(v)} className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-semibold disabled:opacity-40 ${mode === v ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-slate-200 text-navy'}`}>
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
