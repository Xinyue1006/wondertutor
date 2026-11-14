import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import TutorPageHeader from '../../components/TutorPageHeader'
import Icon from '../../components/ui/Icon'
import { LoadError, SectionCard, Spinner } from '../../components/ui/Common'
import { fmtDate, fmtTimeRange, greeting } from '../../lib/format'

const ACTIONS = [
  { to: '/tutor/availability', icon: 'calendar', title: 'Plan your teaching hours', text: 'Set your usual hours, choose online or physical lessons, and adjust individual weeks.', action: 'Set teaching hours' },
  { to: '/tutor/setup', icon: 'user', title: 'Keep your profile up to date', text: 'Manage your subjects, hourly rate, teaching approach and verification documents.', action: 'Edit my profile' },
  { to: '/tutor/preview', icon: 'eye', title: 'See your profile as parents do', text: 'Check your introduction and teaching details before parents get in touch.', action: 'Preview my profile' },
]

function LessonRow({ lesson, showDate = false }) {
  return <div className="flex min-w-0 flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0 break-words"><strong>{lesson.subject} · {lesson.student}</strong>
      <p className="text-sm text-slate-600">{showDate && fmtDate(lesson.startAt) + ' · '}{fmtTimeRange(lesson.startAt, lesson.endAt)} (MYT)</p>
    </div>
    <Link to={lesson.to} className="btn-outline min-h-11 sm:shrink-0">{lesson.action}</Link>
  </div>
}

export default function TutorDashboard() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    let sequence = 0
    async function refresh() {
      const request = ++sequence
      try {
        const { data } = await api.get('/tutor/dashboard')
        if (active && request === sequence) { setData(data); setError('') }
      } catch (e) {
        if (active && request === sequence) setError(errorMessage(e))
      }
    }
    refresh()
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [attempt])

  if (error) return <LoadError message={error} onRetry={() => { setError(''); setAttempt(n => n + 1) }} />
  if (!data) return <Spinner />
  const stats = [
    ['New requests', data.newRequests, 'clock', 'Requests waiting for your response'],
    ['Upcoming lessons', data.upcomingSessions, 'calendar', 'Confirmed lessons ahead'],
    ['Parent rating', data.ratingCount ? `${Number(data.ratingAvg).toFixed(1)} / 5` : 'No reviews yet', 'star', data.ratingCount ? `${data.ratingCount} parent review${data.ratingCount === 1 ? '' : 's'}` : 'Ratings appear after parents review lessons'],
  ]

  return (
    <div className="space-y-6">
      <TutorPageHeader title={`${greeting()}, ${user.fullName}!`} subtitle="Your lessons and booking requests in Malaysia time." />
      <SectionCard title="Next lesson" icon="calendar">
        {data.nextLesson ? <LessonRow lesson={data.nextLesson} showDate /> : <p>No upcoming confirmed lessons.</p>}
      </SectionCard>
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <SectionCard title="Action needed" icon="clock">
          {data.actions?.length ? data.actions.map(lesson => <LessonRow key={lesson.ref} lesson={lesson} showDate />) : <p>No outstanding requests or session follow-ups.</p>}
          <Link to="/tutor/bookings" className="btn-outline min-h-11">View all bookings</Link>
        </SectionCard>
        <SectionCard title="Today's sessions" icon="calendar">
          {data.todaySessions?.length ? data.todaySessions.map(lesson => <LessonRow key={lesson.ref} lesson={lesson} />) : <p>No sessions scheduled today.</p>}
        </SectionCard>
      </div>
      <dl className="grid gap-4 sm:grid-cols-3" aria-label="Teaching overview">
        {stats.map(([label, value, icon, hint]) => (
          <div key={label} className="card p-5">
            <dt className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Icon name={icon} className="h-5 w-5 text-brand-500" />{label}</dt>
            <dd className="mt-3 text-2xl font-bold text-navy">{value}</dd>
            <dd className="mt-1 text-xs text-slate-500">{hint}</dd>
          </div>
        ))}
      </dl>
      <SectionCard title="Manage your teaching" icon="briefcase">
        <div className="grid gap-4 lg:grid-cols-3">
          {ACTIONS.map((item) => (
            <div key={item.to} className="flex min-w-0 flex-col rounded-xl border border-slate-200 p-4">
              <Icon name={item.icon} className="mb-3 h-6 w-6 text-brand-500" />
              <h3 className="font-bold text-navy">{item.title}</h3>
              <p className="mb-4 mt-1 flex-1 text-sm text-slate-600">{item.text}</p>
              <Link to={item.to} className="btn-outline min-h-11">{item.action}<Icon name="arrow-right" className="h-4 w-4" /></Link>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}
