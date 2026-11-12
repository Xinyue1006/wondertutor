import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { uploadImage, uploadError } from '../../components/PhotoPicker'
import TutorPageHeader from '../../components/TutorPageHeader'
import { ErrorBox, LoadError, SectionCard, Spinner } from '../../components/ui/Common'
import { fmtDate, fmtTime, fmtTimeRange } from '../../lib/format'

function readLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is unavailable. On a phone, open WonderTutor using HTTPS and enable location access.'))
    navigator.geolocation.getCurrentPosition(({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
      err => reject(new Error(err.code === 1 ? 'Allow location access in your browser, then try again.' : 'Could not get your location. Try again near the lesson address.')),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 })
  })
}

function distanceFrom(point, s) {
  if (!point || s.latitude == null || s.longitude == null) return null
  const rad = n => n * Math.PI / 180
  const a = Math.sin(rad(point.lat - s.latitude) / 2) ** 2 +
    Math.cos(rad(s.latitude)) * Math.cos(rad(point.lat)) * Math.sin(rad(point.lng - s.longitude) / 2) ** 2
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(a)))
}

function SessionForm({ session: s, setSession }) {
  const [point, setPoint] = useState(null)
  const [photo, setPhoto] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => Date.parse(s.serverTime))
  const [content, setContent] = useState('')
  const [progress, setProgress] = useState('')
  const [plan, setPlan] = useState('')
  useEffect(() => {
    const started = performance.now()
    const tick = () => setNow(Date.parse(s.serverTime) + performance.now() - started)
    tick()
    const timer = setInterval(tick, 1000)
    window.addEventListener('focus', tick)
    return () => { clearInterval(timer); window.removeEventListener('focus', tick) }
  }, [s.serverTime])
  const physical = s.mode === 'PHYSICAL'
  const active = s.status === 'CONFIRMED'
  const ended = now >= Date.parse(s.endAt)
  const started = now >= Date.parse(s.startAt)
  const attendance = s.attendance
  const distance = distanceFrom(point, s)
  const within = distance != null && distance <= s.radius
  const entry = active && started && !ended && !attendance?.checkInAt
  const exit = active && ended && attendance?.checkInAt && !attendance.checkOutAt
  const reportReady = active && attendance?.checkOutAt && !s.report
  const path = '/tutor/bookings/' + s.id + '/session'

  async function run(task) {
    setBusy(true)
    setError('')
    try { await task() } catch (err) { setError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  async function locate() {
    setPoint(null)
    const current = await readLocation()
    setPoint(current)
    return current
  }
  async function send(fields) {
    const { data } = await api.post(path, fields)
    setSession(data)
  }
  async function checkIn() {
    if (!physical) return send({ action: 'check-in' })
    // Reacquire GPS at submission in case the tutor moved after the distance check.
    const fresh = await locate()
    await send({ action: 'check-in', coords: { lat: fresh.lat, lng: fresh.lng }, photo })
  }
  async function takePhoto(file) {
    setPhoto(null)
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a JPG or PNG photo up to 5 MB.')
    try { setPhoto(await uploadImage(file, 'attendance', s.id)) } catch (e) { throw new Error(uploadError(e)) }
  }
  return <div className="min-w-0 space-y-4">
    <Link to={'/tutor/bookings?booking=' + s.id} className="btn-outline min-h-11">Back to my bookings</Link>
    <TutorPageHeader title={s.subject + ' · ' + s.student} subtitle={fmtDate(s.startAt) + ' · ' + fmtTimeRange(s.startAt, s.endAt) + ' (Malaysia time) · ' + (physical ? s.address || 'Physical lesson' : 'Online lesson')} />
    {error && <div role="alert"><ErrorBox>{error}</ErrorBox></div>}
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-4">
        <SectionCard title="Check in" icon="calendar">
          {attendance?.checkInAt ? <p>Checked in at {fmtTime(attendance.checkInAt)}.</p> : <div className="space-y-3">
            {physical ? <>
              <p>Check in within <b>{s.radius} metres</b> of the lesson address and add a photo for the attendance record.</p>
              {s.latitude == null || s.longitude == null ? <p role="alert">This lesson address has no saved coordinates. Contact admin.</p> :
                <button disabled={!entry || busy} className="btn-outline min-h-11" onClick={() => run(async () => {
                  const [{ data }] = await Promise.all([api.get(path), locate()])
                  setSession(data)
                })}>{point ? 'Refresh my location' : 'Check my location'}</button>}
              {point && <p role="status">{within ? 'Within range' : 'Outside the check-in area'} · {Math.round(distance)} m from the address · GPS accuracy ±{Math.round(point.accuracy)} m</p>}
              <label className="block font-semibold">Check-in photo
                <input className="input mt-1 min-h-11 w-full min-w-0 text-base" type="file" accept="image/jpeg,image/png" capture="environment" disabled={!entry || busy}
                  onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; run(() => takePhoto(file)) }} />
              </label>
              {photo && <p role="status">Photo ready for check-in.</p>}
            </> : <p>Check in when your online lesson starts.</p>}
            {!started && <p>Check-in opens at {fmtTime(s.startAt)} on {fmtDate(s.startAt)}.</p>}
            {ended && <p>The scheduled lesson has ended.</p>}
            <button className="btn-primary min-h-11 w-full sm:w-auto" disabled={!entry || busy || (physical && !(within && photo))} onClick={() => run(checkIn)}>Check in</button>
          </div>}
        </SectionCard>
        <SectionCard title="Check out" icon="clock">
          {attendance?.checkOutAt ? <p>Checked out at {fmtTime(attendance.checkOutAt)}.</p> : <>
            <p className="mb-3">After checking in, you can check out from {fmtTime(s.endAt)} on {fmtDate(s.endAt)}.</p>
            <button className="btn-outline min-h-11 w-full sm:w-auto" disabled={!exit || busy} onClick={() => run(() => send({ action: 'check-out' }))}>Check out</button>
          </>}
        </SectionCard>
        <SectionCard title="Session summary and progress report" icon="file">
          {s.report ? <dl className="space-y-3">{[['What was covered', s.report.content], ['Student progress', s.report.progressNote], ['Plan for next session', s.report.recommendations]].filter(([,v]) => v).map(([k,v]) =>
            <div key={k}><dt className="font-bold">{k}</dt><dd className="whitespace-pre-wrap break-words">{v}</dd></div>)}</dl> :
            <form onSubmit={e => { e.preventDefault(); run(() => send({ action: 'report', content, progressNote: progress, recommendations: plan })) }}>
              <fieldset disabled={!reportReady || busy} className="min-w-0 space-y-3">
                {[[ 'What was covered', content, setContent, true ], [ 'Student progress', progress, setProgress, true ], [ 'Plan for next session (optional)', plan, setPlan, false ]].map(([label, value, setter, required]) =>
                  <label key={label} className="block text-sm font-semibold">{label}<textarea className="input mt-1 min-h-20 w-full text-base" maxLength={5000} required={required} value={value} onChange={e => setter(e.target.value)} /></label>)}
                <button disabled={!content.trim() || !progress.trim()} className="btn-primary min-h-11 w-full sm:w-auto">Submit report and complete session</button>
              </fieldset>
              {!reportReady && <p className="mt-2 text-sm text-slate-600">Check out to write the report.</p>}
            </form>}
        </SectionCard>
      </div>
      <SectionCard title="Attendance record" icon="clock">
        <dl className="space-y-2 text-sm">{[['Check-in', attendance?.checkInAt && fmtTime(attendance.checkInAt)], ...(physical ? [['Distance', attendance?.distance != null && Math.round(attendance.distance) + ' m']] : []),
          ['Check-out', attendance?.checkOutAt && fmtTime(attendance.checkOutAt)], ['Report', s.report ? 'Submitted' : 'Pending']].map(([k,v]) =>
          <div className="flex justify-between gap-3" key={k}><dt>{k}</dt><dd className="font-bold">{v || 'Not yet'}</dd></div>)}</dl>
        {attendance?.photo && <img src={attendance.photo} className="mt-3 max-h-48 max-w-full rounded-lg" alt="Lesson check-in photo" />}
      </SectionCard>
    </div>
  </div>
}

export default function LessonSession() {
  const { id } = useParams()
  const [session, setSession] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api.get('/tutor/bookings/' + id + '/session', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setSession(data) })
      .catch(e => { if (!controller.signal.aborted) setError(errorMessage(e)) })
    return () => controller.abort()
  }, [id, attempt])
  if (error) return <LoadError message={error} onRetry={() => { setError(''); setAttempt(n => n + 1) }} />
  return session && String(session.id) === id ? <SessionForm key={id} session={session} setSession={setSession} /> : <Spinner />
}
