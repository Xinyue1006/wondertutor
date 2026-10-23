import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import { EmptyState, LoadError, PageTitle, Spinner, Stars } from '../../components/ui/Common'
import { gradeLabel } from '../../lib/education'
import LessonNotes from '../../components/LessonNotes'
import { fmtDate, fmtDateLong, fmtTime, fmtTimeRange } from '../../lib/format'

// A child's learning journey: totals, subjects, the next lesson, and every completed lesson with the
// tutor's session summary, progress note and check-in record (written by the tutor, read-only here).
export default function ChildProgress() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    api.get(`/parent/children/${id}/progress`).then((r) => setData(r.data)).catch((e) => setError(errorMessage(e)))
  }
  useEffect(load, [id])

  if (error && !data) return (
    <div>
      <Link to="/parent/children" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy hover:text-brand-600"><Icon name="arrow-left" className="h-4 w-4" /> My Children</Link>
      <LoadError message={error} onRetry={load} />
    </div>
  )
  if (!data) return <Spinner />
  const { child, stats, subjects, nextLesson, timeline } = data

  const tile = (icon, label, value, hint) => (
    <div className="card flex items-center gap-3 p-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500"><Icon name={icon} className="h-5 w-5" /></span>
      <div>
        <div className="text-2xl font-bold text-navy">{value}</div>
        <div className="text-sm text-slate-600">{label}</div>
        {hint && <div className="text-xs text-slate-500">{hint}</div>}
      </div>
    </div>
  )

  return (
    <div>
      <Link to="/parent/children" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy hover:text-brand-600">
        <Icon name="arrow-left" className="h-4 w-4" /> My Children
      </Link>
      <PageTitle
        title={`${child.name}'s Learning Progress`}
        subtitle={`${gradeLabel(child.educationLevel, child.grade)}${stats.firstLessonAt ? ` · learning with WonderTutor since ${fmtDate(stats.firstLessonAt)}` : ''}`}
        sparkle={false}
        right={<Link to={`/parent/children/${id}/report`} className="btn-primary px-5"><Icon name="file" className="h-4 w-4" /> Progress report</Link>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile('check-circle', 'Lessons completed', stats.completedLessons)}
        {tile('clock', 'Hours of tuition', stats.totalHours)}
        {tile('file', 'Session summaries', stats.summariesReceived, 'Written by the tutor after each lesson')}
        {tile('pin', 'Lessons checked in', stats.physicalLessons ? `${stats.checkedInLessons} of ${stats.physicalLessons}` : '—', 'Physical lessons (GPS + photo)')}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <section className="card p-5" aria-labelledby="timeline-title">
          <h2 id="timeline-title" className="text-lg font-bold text-navy">Lesson history</h2>
          {timeline.length === 0 ? (
            <EmptyState icon="calendar" title="No completed lessons yet">
              Progress appears here after each lesson. <Link to="/parent/find-tutor" className="font-semibold text-brand-600 hover:underline">Find a tutor</Link>
            </EmptyState>
          ) : (
            <ol className="mt-3 space-y-4 border-l-2 border-brand-100 pl-5">
              {timeline.map((l) => (
                <li key={l.bookingId} className="relative">
                  <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500" aria-hidden="true" />
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <b className="text-navy">{l.subject}</b>
                    <span className="text-sm text-slate-600">{fmtDateLong(l.startAt)}, {fmtTimeRange(l.startAt, l.endAt)}</span>
                    <span className="flex items-center gap-1.5 text-sm text-slate-600"><Avatar src={l.tutor.photoUrl} name={l.tutor.name} className="h-6 w-6" text="text-[10px]" /> {l.tutor.name}</span>
                    {l.rating && <span className="flex items-center gap-1 text-sm text-slate-600"><Stars value={l.rating} size="h-3.5 w-3.5" /> your rating</span>}
                  </div>
                  <LessonNotes summary={l.summary} />
                  {l.teachingMode === 'PHYSICAL' && (
                    l.attendance?.checkInAt ? (
                      <div className="mt-2 flex items-center gap-3 text-xs text-slate-600">
                        {l.attendance.checkInPhotoUrl && <a href={l.attendance.checkInPhotoUrl} target="_blank" rel="noreferrer"><img src={l.attendance.checkInPhotoUrl} alt={`Check-in photo, ${fmtDate(l.startAt)}`} className="h-12 w-12 rounded-lg object-cover" /></a>}
                        <span><Icon name="pin" className="mr-1 inline h-3.5 w-3.5 text-ok" />Checked in {fmtTime(l.attendance.checkInAt)}{l.attendance.checkOutAt && `, out ${fmtTime(l.attendance.checkOutAt)}`}</span>
                      </div>
                    ) : <p className="mt-1 text-xs text-slate-500">No check-in recorded.</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className="space-y-4">
          {/* The newest homework, so the parent sees what to do before the next lesson without scrolling the history */}
          {(() => {
            const latest = timeline.find((l) => l.summary?.homework)
            return (
              <section className="card border-accent/30 bg-accent-50/60 p-5" aria-labelledby="homework-title">
                <h2 id="homework-title" className="text-lg font-bold text-navy">Latest homework</h2>
                {latest ? (
                  <div className="mt-2 text-sm text-slate-700">
                    <p>{latest.summary.homework}</p>
                    <p className="mt-1 text-xs text-slate-500">From the {latest.subject} lesson on {fmtDate(latest.startAt)} with {latest.tutor.name}</p>
                  </div>
                ) : <p className="mt-2 text-sm text-slate-600">No homework has been set yet. When a tutor sets some, it appears here.</p>}
              </section>
            )
          })()}
          <section className="card p-5" aria-labelledby="next-title">
            <h2 id="next-title" className="text-lg font-bold text-navy">Next lesson</h2>
            {nextLesson ? (
              <div className="mt-2 text-sm text-slate-700">
                <b className="text-navy">{nextLesson.subject}</b> with {nextLesson.tutorName}
                <div>{fmtDateLong(nextLesson.startAt)}, {fmtTimeRange(nextLesson.startAt, nextLesson.endAt)}</div>
                <Link to="/parent/bookings?tab=upcoming" className="btn-outline mt-3 min-h-10 w-full">View in My Bookings</Link>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-600">No lesson booked. <Link to="/parent/find-tutor" className="font-semibold text-brand-600 hover:underline">Book one</Link></p>
            )}
          </section>
          <section className="card p-5" aria-labelledby="subjects-title">
            <h2 id="subjects-title" className="text-lg font-bold text-navy">Subjects</h2>
            {subjects.length === 0 ? <p className="mt-2 text-sm text-slate-600">Nothing yet.</p> : (
              <ul className="mt-2 divide-y divide-slate-100">
                {subjects.map((s) => (
                  <li key={s.subject} className="py-2 text-sm">
                    <div className="flex justify-between"><b className="text-navy">{s.subject}</b><span className="text-slate-600">{s.lessons} lesson{s.lessons === 1 ? '' : 's'} · {s.hours} h</span></div>
                    <div className="text-xs text-slate-500">With {s.tutors.join(', ')} · last on {fmtDate(s.lastLessonAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}
