import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useMatching } from '../../assistant/MatchingContext'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import Robot from '../../components/ui/Robot'
import { ErrorBox, Modal, PageTitle, SelectBox, Spinner, VerifiedTick } from '../../components/ui/Common'
import { addDaysYmd, dateLabel, dayMonth, hhmmLabel, mondayOfYmd, todayYmd, weekdayName } from '../../lib/format'
import { gradeLabel } from '../../lib/education'
import { checkRinggit, checkText } from '../../lib/validation'

const hourOf = (hhmm) => Number(hhmm.split(':')[0])
const shortLabel = (s, e) => `${hhmmLabel(s).replace(' AM', '').replace(' PM', '')} - ${hhmmLabel(e).replace(' AM', '').replace(' PM', '')}`

// "Book a Lesson": pick a free hour on the tutor's weekly calendar, then send a booking REQUEST.
// Nothing is confirmed until the tutor agrees a price and the parent pays.
export default function BookLesson() {
  const { id } = useParams()
  const navigate = useNavigate()
  const prefill = useLocation().state || {}
  const { kids, kidsLoaded } = useMatching()

  const [tutor, setTutor] = useState(null)
  const [week, setWeek] = useState(mondayOfYmd(prefill.date || todayYmd()))
  const [grid, setGrid] = useState(null)
  const [sel, setSel] = useState(prefill.date ? { date: prefill.date, start: prefill.time } : null)
  const [childId, setChildId] = useState(prefill.childId || '')
  const [mode, setMode] = useState(prefill.mode || '')
  const [subject, setSubject] = useState('')
  const [price, setPrice] = useState(prefill.price || '')
  const [msg, setMsg] = useState(prefill.msg || '')
  const [trial, setTrial] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    api.get(`/parent/tutors/${id}`).then((r) => {
      const t = r.data.tutor
      setTutor(t)
      setPrice((p) => p || String(t.hourlyRate))
      setMode((m) => m || (t.offersPhysical ? 'PHYSICAL' : 'ONLINE'))
      setSubject(t.subjects[0])
    }).catch((e) => setError(errorMessage(e)))
  }, [id])

  useEffect(() => { if (kidsLoaded && !childId && kids[0]) setChildId(kids[0].id) }, [kidsLoaded, kids, childId])

  useEffect(() => {
    setGrid(null)
    api.get(`/parent/tutors/${id}/slots`, { params: { from: week } }).then((r) => setGrid(r.data.days)).catch((e) => setError(errorMessage(e)))
  }, [id, week])

  const child = kids.find((k) => k.id === Number(childId))

  // Prefer the child's own subject when this tutor teaches it
  useEffect(() => {
    if (tutor && child?.subject && tutor.subjects.includes(child.subject)) setSubject(child.subject)
  }, [tutor, child])

  const hours = useMemo(() => {
    const all = (grid || []).flatMap((d) => d.slots)
    const lo = Math.min(8, ...all.map((s) => hourOf(s.start)))
    const hi = Math.max(20, ...all.map((s) => hourOf(s.end)))
    return Array.from({ length: hi - lo }, (_, i) => lo + i)
  }, [grid])

  if (error && !tutor) return <div className="card p-8 text-center text-red-600">{error}</div>
  if (!tutor || !kidsLoaded) return <Spinner />

  const isThisWeek = week <= mondayOfYmd(todayYmd())
  const selSlot = sel && grid?.find((d) => d.date === sel.date)?.slots.find((s) => s.start === sel.start)
  const teachesChild = !child || tutor.grades.includes(gradeLabel(child.educationLevel, child.grade))

  async function send() {
    setError('')
    if (!child) return setError('Please choose a child (add one under My Children first).')
    if (!sel) return setError('Please select an available time on the calendar.')
    const problem = checkRinggit(price, 'Proposed price') || checkText(msg, { label: 'Message', max: 200 })
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await api.post('/parent/bookings', {
        tutorId: tutor.id, childId: child.id, date: sel.date, startTime: sel.start, teachingMode: mode,
        proposedPrice: Number(price), subject, messageToTutor: msg || undefined, isTrial: trial,
      })
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
      // The slot may have just been taken: refresh the calendar
      api.get(`/parent/tutors/${id}/slots`, { params: { from: week } }).then((r) => setGrid(r.data.days))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageTitle icon="calendar" title="Book a Lesson" subtitle="Select an available time and send a booking request to the tutor." />

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-4">
          <section className="card flex flex-wrap items-center gap-4 p-4">
            <Avatar src={tutor.photoUrl} name={tutor.name} className="h-20 w-20" rounded="rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xl font-extrabold text-navy">{tutor.name} {tutor.verified && <VerifiedTick />}</div>
              <div className="text-sm text-slate-500">{tutor.subjects.join(', ')} <span className="text-slate-300">|</span> {tutor.levels}</div>
              <div className="flex items-center gap-3 text-sm"><span className="flex items-center gap-1"><Icon name="star" fill className="h-4 w-4 text-accent" /><b className="text-navy">{tutor.rating.toFixed(1)}</b> <span className="text-slate-500">({tutor.reviewCount} reviews)</span></span><b className="text-navy">RM {tutor.hourlyRate} / hour</b></div>
            </div>
            <Link to={`/parent/tutors/${tutor.id}`} className="btn-outline px-6">View Profile</Link>
          </section>

          <section className="card p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <button disabled={isThisWeek} onClick={() => setWeek(addDaysYmd(week, -7))} className="btn-outline px-4 py-2"><Icon name="left" className="h-4 w-4" /> Previous Week</button>
              <label className="relative flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-brand-200 bg-white px-3 text-sm font-semibold text-navy">
                <Icon name="calendar" className="h-4 w-4 text-brand-500" />
                {dayMonth(week)} – {dayMonth(addDaysYmd(week, 6))} {addDaysYmd(week, 6).slice(0, 4)}
                <Icon name="down" className="h-4 w-4" />
                <input type="date" min={todayYmd()} value={sel?.date || week} onChange={(e) => e.target.value && setWeek(mondayOfYmd(e.target.value))} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Jump to week" />
              </label>
              <button onClick={() => setWeek(addDaysYmd(week, 7))} className="btn-outline px-4 py-2">Next Week <Icon name="right" className="h-4 w-4" /></button>
              <button onClick={() => setWeek(mondayOfYmd(todayYmd()))} className="btn-outline bg-brand-50 px-4 py-2">This Week</button>
              <div className="ml-auto flex items-center gap-4 text-xs text-slate-600">
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-brand-500" /> Available</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-navy" /> Selected</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-slate-300" /> Unavailable</span>
              </div>
            </div>

            {!grid ? <Spinner /> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] table-fixed border-separate border-spacing-1 text-center text-xs">
                  <thead>
                    <tr>
                      <th className="w-20 text-left text-slate-500">Time</th>
                      {grid.map((d) => (
                        <th key={d.date} className={`rounded-lg py-1.5 ${d.date === todayYmd() ? 'bg-brand-50' : ''}`}>
                          <div className="font-bold text-navy">{weekdayName(d.date)}</div>
                          <div className="font-normal text-slate-500">{dayMonth(d.date)}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hours.map((h) => (
                      <tr key={h}>
                        <td className="whitespace-nowrap pr-2 text-left text-slate-500">{hhmmLabel(`${h}:00`)}</td>
                        {grid.map((d) => {
                          const slot = d.slots.find((s) => hourOf(s.start) === h)
                          const selected = sel?.date === d.date && sel?.start === slot?.start
                          return (
                            <td key={d.date} className="h-8 rounded bg-slate-50/80 p-0">
                              {slot && (
                                <button
                                  type="button"
                                  disabled={slot.status !== 'available'}
                                  onClick={() => setSel({ date: d.date, start: slot.start })}
                                  className={`h-8 w-full rounded font-semibold transition ${
                                    selected ? 'bg-navy text-white ring-2 ring-navy/30'
                                      : slot.status === 'available' ? 'bg-brand-500 text-white hover:bg-brand-600'
                                        : 'cursor-not-allowed bg-slate-300 text-white'
                                  }`}
                                >
                                  {shortLabel(slot.start, slot.end)}
                                </button>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-[84px]">
          <section className="card p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-100 text-accent-600"><Icon name="calendar" className="h-6 w-6" /></span>
              <h2 className="text-xl font-extrabold text-navy">Booking Request</h2>
            </div>
            <div className="space-y-3.5">
              <ErrorBox>{error}</ErrorBox>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Selected Date</span>
                  <div className="input flex h-10 items-center gap-2 text-navy"><Icon name="calendar" className="h-4 w-4 text-brand-500" /> {sel ? dateLabel(sel.date) : <span className="text-slate-400">Pick a slot</span>}</div></label>
                <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Selected Time</span>
                  <div className="input flex h-10 items-center gap-2 text-navy"><Icon name="clock" className="h-4 w-4 text-brand-500" /> {selSlot ? `${hhmmLabel(selSlot.start)} - ${hhmmLabel(selSlot.end)}` : <span className="text-slate-400">Pick a slot</span>}</div></label>
              </div>
              <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Child <span className="text-red-500">*</span></span>
                {kids.length === 0 ? <Link to="/parent/children?add=1" className="btn-outline w-full"><Icon name="plus" className="h-4 w-4" /> Add a child first</Link> : (
                  <SelectBox icon="user" value={childId} onChange={(e) => setChildId(e.target.value)} className="[&_select]:h-10">
                    {kids.map((k) => <option key={k.id} value={k.id}>{k.name} ({gradeLabel(k.educationLevel, k.grade)})</option>)}
                  </SelectBox>)}
              </label>
              {!teachesChild && <div className="flex gap-2 rounded-lg bg-red-50 p-2.5 text-xs text-red-600"><Icon name="info" className="h-4 w-4 shrink-0" /> This tutor doesn't teach {gradeLabel(child.educationLevel, child.grade)}.</div>}
              {tutor.subjects.length > 1 && (
                <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Subject</span>
                  <SelectBox icon="book" value={subject} onChange={(e) => setSubject(e.target.value)} className="[&_select]:h-10">{tutor.subjects.map((s) => <option key={s}>{s}</option>)}</SelectBox></label>
              )}
              <div>
                <span className="mb-1 block text-sm font-bold text-navy">Teaching Mode</span>
                <div className="grid grid-cols-2 gap-2">
                  {[['ONLINE', 'Online', 'monitor', tutor.offersOnline], ['PHYSICAL', 'Physical', 'home', tutor.offersPhysical]].map(([v, l, icon, ok]) => (
                    <button key={v} type="button" disabled={!ok} onClick={() => setMode(v)} className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-semibold disabled:opacity-40 ${mode === v ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-slate-200 text-navy'}`}>
                      <Icon name={icon} className="h-4 w-4" /> {l}
                    </button>))}
                </div>
              </div>
              <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Proposed Price (RM per hour) <span className="text-red-500">*</span></span>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">RM</span>
                  <input type="number" min="1" className="input h-10 pl-11" value={price} onChange={(e) => setPrice(e.target.value)} /></div></label>
              <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Message to Tutor <span className="font-normal text-slate-500">(Optional)</span></span>
                <textarea rows={3} maxLength={200} className="input resize-none" placeholder="E.g. My child would like to focus on exam preparation. Thank you!" value={msg} onChange={(e) => setMsg(e.target.value)} />
                <span className="block text-right text-xs text-slate-400">{msg.length}/200</span></label>
              {/* Trial lessons are paid like any lesson; the flag only tells the tutor it is the child's first lesson with them */}
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-3 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={trial} onChange={(e) => setTrial(e.target.checked)} />
                <span><b className="text-navy">This is a trial lesson</b><span className="block text-xs text-slate-600">A first lesson to see if the tutor is a good fit. It is paid like a normal lesson.</span></span>
              </label>
              <button onClick={send} disabled={busy || !teachesChild} className="btn-primary h-12 w-full text-base">{busy ? 'Sending…' : 'Send Booking Request'} {!busy && <Icon name="arrow-right" className="h-4 w-4" />}</button>
            </div>
          </section>

          <section className="rounded-2xl border border-accent/40 bg-accent-50 p-5">
            <div className="mb-3 flex items-center gap-2 font-bold text-navy"><Icon name="info" className="h-5 w-5 text-brand-500" /> What happens after I send a request?</div>
            <ol className="space-y-3 text-sm">
              {[['Send Request', 'Your booking request will be sent to the tutor.', 'send'], ['Tutor Responds', 'The tutor can accept, reject or counter-offer.', 'clock'], ['Booking Confirmed', 'Once both parties agree and you pay, the lesson is confirmed.', 'calendar']].map(([t, d, icon], i) => (
                <li key={t} className="flex gap-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-600"><Icon name={icon} className="h-4 w-4" /></span>
                  <div><div className="font-bold text-navy">{i + 1}. {t}</div><div className="text-xs text-slate-500">{d}</div></div></li>))}
            </ol>
          </section>
        </aside>
      </div>

      <Modal open={done} onClose={() => navigate('/parent/bookings')} title="Booking request sent!">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <Robot className="h-24 w-24" />
          <p className="text-sm text-slate-600">{tutor.name} will review your request. They can accept, reject or send a counter offer, and we'll notify you as soon as they respond.</p>
          <button onClick={() => navigate('/parent/bookings')} className="btn-primary mt-2 px-8">View My Bookings</button>
        </div>
      </Modal>
    </div>
  )
}
