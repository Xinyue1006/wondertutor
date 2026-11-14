import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useMatching } from '../../assistant/MatchingContext'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import Robot from '../../components/ui/Robot'
import { ErrorBox, LoadError, Modal, PageTitle, SelectBox, Spinner, VerifiedTick } from '../../components/ui/Common'
import { addDaysYmd, dateLabel, dayMonth, hhmmLabel, mondayOfYmd, todayYmd, weekdayName } from '../../lib/format'
import { gradeLabel } from '../../lib/education'
import { bookingMode } from '../../lib/availability'
import { childSubjects } from '../../lib/subjects'
import { checkRinggit, checkText } from '../../lib/validation'
import { matchesRecordRef, recordRef } from '../../lib/recordRef'
import LessonLocationPicker from '../../components/LessonLocationPicker'
import { lessonLocationError, lessonLocationPayload } from '../../lib/lessonLocationInput'

// Parents select dated one-hour lessons; the server rechecks every selection.
export default function BookLesson() {
  const { id } = useParams()
  const navigate = useNavigate()
  const bookingLocation = useLocation()
  const prefill = bookingLocation.state || {}
  const requestedMode = prefill.mode || new URLSearchParams(bookingLocation.search).get('mode')
  const { kids, kidsLoaded, loadError, reloadShared } = useMatching()

  const [tutor, setTutor] = useState(null)
  const [calendarVersion, setCalendarVersion] = useState(0)
  const [week, setWeek] = useState(mondayOfYmd(prefill.date || todayYmd()))
  const [grid, setGrid] = useState(null)
  const [calendarError, setCalendarError] = useState('')
  const [selectedSlots, setSelectedSlots] = useState(prefill.slots?.length ? prefill.slots : prefill.date && prefill.time ? [{ date: prefill.date, start: prefill.time }] : [])
  const [childId, setChildId] = useState(prefill.childId || '')
  const [mode, setMode] = useState(['ONLINE', 'PHYSICAL'].includes(requestedMode) ? requestedMode : '')
  const [subject, setSubject] = useState(prefill.subject || '')
  const [price, setPrice] = useState(prefill.price || '')
  const [msg, setMsg] = useState(prefill.msg || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  // Exact venue data stays in this signed-in form, never in browser history state.
  const [lessonLocation, setLessonLocation] = useState({ address: '', latitude: null, longitude: null, confirmed: false })

  useEffect(() => {
    api.get(`/parent/tutors/${id}`).then((r) => {
      const t = r.data.tutor
      setTutor(t)
      setPrice((p) => p || String(t.hourlyRate))
      setMode((m) => m || (t.offersPhysical ? 'PHYSICAL' : 'ONLINE'))
      setSubject(current => t.subjects.includes(current) ? current : t.subjects[0])
    }).catch((e) => setError(errorMessage(e)))
  }, [id])

  useEffect(() => { if (kidsLoaded && !childId && kids[0]) setChildId(recordRef(kids[0])) }, [kidsLoaded, kids, childId])

  useEffect(() => {
    const controller = new AbortController()
    setGrid(null)
    setCalendarError('')
    api.get(`/parent/tutors/${id}/slots`, { params: { from: week }, signal: controller.signal })
      .then(r => { if (!controller.signal.aborted) setGrid(r.data.days) })
      .catch(e => { if (!controller.signal.aborted) setCalendarError(errorMessage(e)) })
    return () => controller.abort()
  }, [id, week, calendarVersion])

  const child = kids.find((k) => matchesRecordRef(k, childId))

  // Prefer the child's own subject when this tutor teaches it
  useEffect(() => {
    // The first of the child's subjects that this tutor teaches
    const match = childSubjects(child).find((s) => tutor?.subjects.includes(s))
    if (tutor && match && !prefill.subject) setSubject(match)
  }, [tutor, child, prefill.subject])

  if (error && !tutor) return <div className="card p-8 text-center text-red-600">{error}</div>
  if (!kidsLoaded && loadError) return <LoadError message={loadError} onRetry={reloadShared} />
  if (!tutor || !kidsLoaded) return <Spinner />

  const toggleSlot = slot => {
    setSelectedSlots(current => current.some(s => s.date === slot.date && s.start === slot.start)
      ? current.filter(s => s.date !== slot.date || s.start !== slot.start)
      : current.length < 12 ? [...current, slot] : current)
  }
  const teachesChild = !child || tutor.grades.includes(gradeLabel(child.educationLevel, child.grade))
  const lesson = bookingMode(selectedSlots, mode) // an hour set to one mode decides the mode

  async function send() {
    setError('')
    if (!child) return setError('Please choose a child (add one under My Children first).')
    if (!selectedSlots.length) return setError('Please select an available time on the calendar.')
    if (lesson.conflict) return setError('Some of these hours are online only and some physical only. Send them as separate requests.')
    const problem = checkRinggit(price, 'Proposed price') || checkText(msg, { label: 'Message', max: 200 })
      || (lesson.mode === 'PHYSICAL' ? lessonLocationError(lessonLocation) : '')
    if (problem) return setError(problem)
    setBusy(true)
    try {
      await api.post('/parent/bookings', {
        tutorId: tutor.id, childId: recordRef(child), slots: selectedSlots.map(s => ({ date: s.date, startTime: s.start })), teachingMode: lesson.mode,
        proposedPrice: Number(price), subject, messageToTutor: msg || undefined,
        ...(lesson.mode === 'PHYSICAL' ? { lessonLocation: lessonLocationPayload(lessonLocation) } : {}),
      })
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
      // The slot may have just been taken: refresh the calendar
      setCalendarVersion(v => v + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageTitle icon="calendar" title="Book a Lesson" subtitle="Select up to 12 dated one-hour lessons and send them together to the tutor." />

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-4">
          <section className="card grid grid-cols-[64px_minmax(0,1fr)] items-start gap-3 p-4 sm:flex sm:flex-wrap sm:items-center sm:gap-4">
            <Avatar src={tutor.photoUrl} name={tutor.name} className="h-16 w-16 sm:h-20 sm:w-20" rounded="rounded-xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-lg font-extrabold text-navy sm:text-xl"><span className="min-w-0 break-words">{tutor.name}</span> {tutor.verified && <VerifiedTick />}</div>
              <div className="break-words text-sm text-slate-500">{tutor.subjects.join(', ')} <span className="text-slate-300">|</span> {tutor.levels}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span className="flex flex-wrap items-center gap-1"><Icon name="star" fill className="h-4 w-4 shrink-0 text-accent" /><b className="text-navy">{tutor.rating.toFixed(1)}</b> <span className="text-slate-500">({tutor.reviewCount} reviews)</span></span><b className="text-navy">RM {tutor.hourlyRate} / hour</b></div>
            </div>
            <Link to={`/parent/tutors/${tutor.id}`} className="btn-outline col-span-2 min-h-11 w-full px-6 sm:w-auto">View Profile</Link>
          </section>

          <section className="card p-3 sm:p-4">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button type="button" disabled={week <= mondayOfYmd(todayYmd())} onClick={() => setWeek(addDaysYmd(week, -7))} className="btn-outline min-h-11 px-3"><Icon name="left" className="h-4 w-4" /> Previous Week</button>
              <span className="font-semibold text-navy">{dayMonth(week)} – {dayMonth(addDaysYmd(week, 6))}</span>
              <button type="button" onClick={() => setWeek(addDaysYmd(week, 7))} className="btn-outline min-h-11 px-3">Next Week <Icon name="right" className="h-4 w-4" /></button>
              <button type="button" onClick={() => setWeek(mondayOfYmd(todayYmd()))} className="btn-outline min-h-11 px-3">This Week</button>
              <label className="flex flex-wrap items-center gap-2 text-sm font-semibold">Jump to date
                <input type="date" aria-label="Jump to week" min={todayYmd()} value={week} onChange={e => { if (e.target.value) setWeek(mondayOfYmd(e.target.value)) }} className="input min-h-11 w-auto max-w-full" />
              </label>
            </div>
            <p className="mb-3 text-xs text-slate-500">Malaysia time (MYT) · Blue: available · Dark: selected · Grey: unavailable</p>
            {calendarError ? <LoadError message={calendarError} onRetry={() => setCalendarVersion(v => v + 1)} /> : !grid ? <Spinner /> : (
              <div className="overflow-x-auto" role="region" aria-label="Weekly lesson calendar" tabIndex={0}>
                <table className="w-full min-w-[720px] table-fixed border-separate border-spacing-1 text-center text-xs">
                  <thead><tr><th className="w-20 text-left text-slate-500">Time</th>{grid.map(d => <th key={d.date} className="rounded-lg py-2"><div className="font-bold text-navy">{weekdayName(d.date)}</div><div className="font-normal text-slate-500">{dayMonth(d.date)}</div></th>)}</tr></thead>
                  <tbody>{Array.from({ length: 15 }, (_, i) => i + 7).map(hour => {
                    const start = String(hour).padStart(2, '0') + ':00'
                    const end = String(hour + 1).padStart(2, '0') + ':00'
                    return <tr key={hour}>
                      <td className="whitespace-nowrap pr-2 text-left text-slate-500">{hhmmLabel(start)}</td>
                      {grid.map(d => {
                        const slot = d.slots.find(s => s.start === start)
                        const selected = selectedSlots.some(s => s.date === d.date && s.start === start)
                        return <td key={d.date} className="rounded bg-slate-50 p-0">
                          {slot && <button type="button" aria-label={d.date + ' ' + start} aria-pressed={selected} disabled={slot.status !== 'available' || (!selected && selectedSlots.length >= 12)}
                            onClick={() => toggleSlot({ date: d.date, start, mode: slot.mode })}
                            className={'h-8 w-full rounded px-1 font-semibold transition disabled:cursor-not-allowed ' + (selected ? 'bg-navy text-white' : slot.status === 'available' ? 'bg-brand-500 text-white hover:bg-brand-600' : 'bg-slate-300 text-white')}>
                            {hhmmLabel(start).replace(' AM', '').replace(' PM', '')} - {hhmmLabel(end).replace(' AM', '').replace(' PM', '')}
                          </button>}
                        </td>
                      })}
                    </tr>
                  })}</tbody>
                </table>
              </div>
            )}
          </section>
          {lesson.mode === 'PHYSICAL' && !lesson.conflict && <section className="card min-w-0 p-4 sm:p-5" aria-labelledby="lesson-venue-title">
            <h2 id="lesson-venue-title" className="mb-2 text-xl font-extrabold text-navy">Physical lesson venue</h2>
            <p className="mb-4 text-sm text-slate-600">All {selectedSlots.length || 'selected'} lessons in this request will use this address. Send separate requests for different venues.</p>
            <LessonLocationPicker value={lessonLocation} onChange={setLessonLocation} disabled={busy} />
          </section>}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-[84px]">
          <section className="card p-5">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-100 text-accent-600"><Icon name="calendar" className="h-6 w-6" /></span>
              <h2 className="text-xl font-extrabold text-navy">Booking Request</h2>
            </div>
            <div className="space-y-3.5">
              <ErrorBox>{error}</ErrorBox>
              <div className="space-y-2">
                <p className="font-bold">Selected lessons ({selectedSlots.length}/12)</p>
                {selectedSlots.length === 0 && <p>Select available hours. You can move between weeks.</p>}
                {selectedSlots.map(slot => <div key={slot.date + slot.start} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-brand-50 p-2">
                  <span>{dateLabel(slot.date)} · {hhmmLabel(slot.start)} (1 hour)</span>
                  <button type="button" className="btn-outline" onClick={() => toggleSlot(slot)} aria-label={'Remove ' + slot.date + ' ' + slot.start}>Remove</button>
                </div>)}
                <p className="text-sm">Proposed total: RM{(Number(price || 0) * selectedSlots.length).toFixed(2)}. Each lesson is confirmed and paid separately.</p>
              </div>
              <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Child <span className="text-red-500">*</span></span>
                {kids.length === 0 ? <Link to="/parent/children?add=1" className="btn-outline w-full"><Icon name="plus" className="h-4 w-4" /> Add a child first</Link> : (
                  <SelectBox icon="user" value={child ? recordRef(child) : childId} onChange={(e) => setChildId(e.target.value)} className="[&_select]:h-10">
                    {kids.map((k) => <option key={k.id} value={recordRef(k)}>{k.name} ({gradeLabel(k.educationLevel, k.grade)})</option>)}
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
                    <button key={v} type="button" disabled={!ok || (lesson.fixed && lesson.fixed !== v)} onClick={() => setMode(v)} className={`flex h-10 items-center justify-center gap-2 rounded-lg border text-sm font-semibold disabled:opacity-40 ${lesson.mode === v ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-slate-200 text-navy'}`}>
                      <Icon name={icon} className="h-4 w-4" /> {l}
                    </button>))}
                </div>
              </div>
              {lesson.mode === 'PHYSICAL' && <p className="rounded-lg bg-brand-50 p-3 text-sm text-navy">Confirm the physical lesson address and entrance pin in the venue section before sending.</p>}
              <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Proposed Price (RM per hour) <span className="text-red-500">*</span></span>
                <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">RM</span>
                  <input type="number" min="1" className="input h-10 pl-11" value={price} onChange={(e) => setPrice(e.target.value)} /></div></label>
              <label className="block"><span className="mb-1 block text-sm font-bold text-navy">Message to Tutor <span className="font-normal text-slate-500">(Optional)</span></span>
                <textarea rows={3} maxLength={200} className="input resize-none" placeholder="E.g. My child would like to focus on exam preparation. Thank you!" value={msg} onChange={(e) => setMsg(e.target.value)} />
                <span className="block text-right text-xs text-slate-400">{msg.length}/200</span></label>
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

      <Modal open={done} onClose={() => navigate('/parent/bookings?tab=pending')} title="Booking request sent!">
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <Robot className="h-24 w-24" />
          <p className="text-sm text-slate-600">{tutor.name} will review your request. They can accept, reject or send a counter offer, and we'll notify you as soon as they respond.</p>
          <button onClick={() => navigate('/parent/bookings?tab=pending')} className="btn-primary mt-2 px-8">View My Bookings</button>
        </div>
      </Modal>
    </div>
  )
}
