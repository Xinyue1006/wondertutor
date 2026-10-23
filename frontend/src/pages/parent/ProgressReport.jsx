import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import LessonNotes from '../../components/LessonNotes'
import { EmptyState, ErrorBox, LoadError, SelectBox, Spinner } from '../../components/ui/Common'
import { gradeLabel } from '../../lib/education'
import { addDaysYmd, fmtDate, fmtDateLong, fmtTimeRange, todayYmd } from '../../lib/format'
import { saveCsv } from '../../lib/csv'

// A learning progress report for one child over a chosen period. It is the "historical progress report": every completed
// lesson with what the tutor wrote, grouped into totals and subjects, to read on screen, print or save as PDF
// (the browser's Print), or download as a spreadsheet (CSV).
const PRESETS = [
  ['all', 'All time'],
  ['year', 'This year'],
  ['3m', 'Last 3 months'],
  ['custom', 'Choose dates'],
]

function presetRange(preset) {
  const today = todayYmd()
  if (preset === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  if (preset === '3m') return { from: addDaysYmd(today, -90), to: today }
  return { from: '', to: '' }
}

export default function ProgressReport() {
  const { id } = useParams()
  const [preset, setPreset] = useState('all')
  const [range, setRange] = useState({ from: '', to: '' })
  const [subject, setSubject] = useState('')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filterError, setFilterError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    if (range.from && range.to && range.from > range.to) return setFilterError('The start date must be on or before the end date.')
    setFilterError('')
    setError('')
    setLoading(true)
    api.get(`/parent/children/${id}/report`, { params: { from: range.from, to: range.to, subject } })
      .then((r) => setData(r.data))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false))
  }, [id, range, subject])
  useEffect(() => { load() }, [load])

  const pick = (p) => { setPreset(p); if (p !== 'custom') setRange(presetRange(p)) }

  if (error && !data) return <div><BackLink id={id} /><LoadError message={error} onRetry={load} /></div>
  if (!data) return <Spinner />
  const { child, totals, subjects, lessons, period } = data

  function download() {
    const rows = [['Date', 'Time', 'Subject', 'Tutor', 'Mode', 'Attendance', 'Topics covered', 'Summary', 'Observations', 'Homework / follow-up', 'Recommendation']]
    for (const l of lessons) {
      const s = l.summary
      rows.push([
        fmtDate(l.startAt), fmtTimeRange(l.startAt, l.endAt), l.subject, l.tutor, l.teachingMode === 'ONLINE' ? 'Online' : 'Physical',
        l.attended === null ? 'Not tracked (online)' : l.attended ? 'Checked in' : 'No check-in',
        s?.topics, s?.content, s?.progressNote, s?.homework, s?.recommendations,
      ])
    }
    saveCsv(rows, `progress-report-${child.name.replace(/[^\p{L}\p{N}]+/gu, '-')}.csv`)
  }

  const periodText = period.from || period.to
    ? `${period.from ? fmtDate(`${period.from}T12:00:00+08:00`) : 'the beginning'} to ${period.to ? fmtDate(`${period.to}T12:00:00+08:00`) : 'today'}`
    : 'All lessons'
  const stat = (label, value) => (
    <div className="rounded-xl bg-brand-25 p-3 text-center"><div className="text-xl font-extrabold text-navy">{value}</div><div className="text-xs text-slate-600">{label}</div></div>
  )

  return (
    <div className="mx-auto max-w-4xl">
      <div className="print:hidden">
        <BackLink id={id} />
        <div className="card mb-4 space-y-3 p-4" role="group" aria-label="Report options">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Period">
              {PRESETS.map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={preset === v} onClick={() => pick(v)} className={`chip px-3 py-1.5 text-[13px] ${preset === v ? 'chip-on' : ''}`}>{l}</button>
              ))}
            </div>
            {preset === 'custom' && (
              <>
                <label className="text-sm font-semibold text-navy">From<input type="date" className="input mt-1 h-10" value={range.from} max={range.to || undefined} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
                <label className="text-sm font-semibold text-navy">To<input type="date" className="input mt-1 h-10" value={range.to} min={range.from || undefined} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
              </>
            )}
            <label className="min-w-[180px] text-sm font-semibold text-navy">Subject
              <SelectBox icon="book" className="mt-1" value={subject} onChange={(e) => setSubject(e.target.value)}>
                <option value="">All subjects</option>
                {data.subjectsAvailable.map((s) => <option key={s}>{s}</option>)}
              </SelectBox>
            </label>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={download} disabled={!lessons.length} className="btn-outline px-4 disabled:opacity-50">Download CSV</button>
              <button type="button" onClick={() => window.print()} className="btn-primary px-4">Print / Save as PDF</button>
            </div>
          </div>
          <ErrorBox>{filterError || error}</ErrorBox>
        </div>
      </div>

      <article className={`card p-8 ${loading ? 'opacity-60' : ''}`} aria-label={`Learning progress report for ${child.name}`}>
        <header className="border-b border-slate-200 pb-4">
          <h1 className="text-2xl font-extrabold text-navy">Learning Progress Report</h1>
          <p className="text-sm text-slate-500">WonderTutor · Wonderland Learning Materials &amp; Tuition Centre</p>
          <dl className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="inline text-slate-500">Child: </dt><dd className="inline font-semibold text-navy">{child.name}, {gradeLabel(child.educationLevel, child.grade)}</dd></div>
            <div><dt className="inline text-slate-500">Parent: </dt><dd className="inline font-semibold text-navy">{data.parentName}</dd></div>
            <div><dt className="inline text-slate-500">Period: </dt><dd className="inline font-semibold text-navy">{periodText}{period.subject ? ` · ${period.subject}` : ''}</dd></div>
            <div><dt className="inline text-slate-500">Created: </dt><dd className="inline font-semibold text-navy">{fmtDateLong(data.generatedAt)}</dd></div>
          </dl>
        </header>

        {lessons.length === 0 ? (
          <EmptyState icon="calendar" title="No completed lessons in this period">Try a longer period or another subject. <Link to="/parent/find-tutor" className="font-semibold text-brand-600 hover:underline">Find a tutor</Link></EmptyState>
        ) : (
          <>
            <section className="mt-5" aria-labelledby="rep-summary">
              <h2 id="rep-summary" className="mb-2 text-lg font-bold text-navy">Summary</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {stat('Lessons', totals.lessons)}
                {stat('Hours of tuition', totals.hours)}
                {stat('Tutors', totals.tutors)}
                {stat('Tutor summaries', `${totals.summaries} of ${totals.lessons}`)}
                {stat('With homework', totals.homeworkSet)}
                {stat('Check-ins (physical)', totals.physicalLessons ? `${totals.checkedIn} of ${totals.physicalLessons}` : '—')}
                {stat('Your average rating', totals.averageRating ?? '—')}
              </div>
            </section>

            <section className="mt-6" aria-labelledby="rep-subjects">
              <h2 id="rep-subjects" className="mb-2 text-lg font-bold text-navy">By subject</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead><tr className="bg-brand-50 text-slate-600"><th className="rounded-l-lg px-3 py-2 font-semibold">Subject</th><th className="px-3 py-2 font-semibold">Lessons</th><th className="px-3 py-2 font-semibold">Hours</th><th className="rounded-r-lg px-3 py-2 font-semibold">Tutors</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {subjects.map((s) => <tr key={s.subject}><td className="px-3 py-2 font-semibold text-navy">{s.subject}</td><td className="px-3 py-2">{s.lessons}</td><td className="px-3 py-2">{s.hours}</td><td className="px-3 py-2">{s.tutors.join(', ')}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mt-6" aria-labelledby="rep-lessons">
              <h2 id="rep-lessons" className="mb-2 text-lg font-bold text-navy">Lesson by lesson</h2>
              <ol className="space-y-4">
                {lessons.map((l) => (
                  <li key={l.bookingId} className="break-inside-avoid border-b border-slate-100 pb-4 last:border-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <b className="text-navy">{l.subject}</b>
                      <span className="text-sm text-slate-600">{fmtDateLong(l.startAt)}, {fmtTimeRange(l.startAt, l.endAt)}</span>
                      <span className="text-sm text-slate-600">with {l.tutor} · {l.teachingMode === 'ONLINE' ? 'Online' : l.attended ? 'Physical, checked in' : 'Physical, no check-in recorded'}</span>
                    </div>
                    <LessonNotes summary={l.summary} />
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
        <p className="mt-6 text-xs text-slate-500">This report is made from the lessons completed on WonderTutor and the notes written by each tutor. It is for your own records.</p>
      </article>
    </div>
  )
}

function BackLink({ id }) {
  return (
    <Link to={`/parent/children/${id}/progress`} className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy hover:text-brand-600">
      <Icon name="arrow-left" className="h-4 w-4" /> Learning progress
    </Link>
  )
}
