import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import TutorPageHeader from '../../components/TutorPageHeader'
import Icon from '../../components/ui/Icon'
import { LoadError, SectionCard, Spinner } from '../../components/ui/Common'
import { greeting } from '../../lib/format'

const ACTIONS = [
  { to: '/tutor/availability', icon: 'calendar', title: 'Plan your teaching hours', text: 'Set your usual hours, choose online or physical lessons, and adjust individual weeks.', action: 'Manage availability' },
  { to: '/tutor/setup', icon: 'user', title: 'Keep your profile up to date', text: 'Manage your subjects, hourly rate, teaching approach and verification documents.', action: 'Edit my profile' },
  { to: '/tutor/preview', icon: 'eye', title: 'See your profile as parents do', text: 'Check your introduction and teaching details before parents get in touch.', action: 'Preview my profile' },
]

export default function TutorDashboard() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = () => {
    setError('')
    return api.get('/tutor/dashboard').then((r) => setData(r.data)).catch((e) => setError(errorMessage(e)))
  }
  useEffect(() => { load() }, [])

  if (!data) return error ? <LoadError message={error} onRetry={load} /> : <Spinner />
  const stats = [
    ['New requests', data.newRequests, 'clock', 'Requests waiting for your response'],
    ['Upcoming lessons', data.upcomingSessions, 'calendar', 'Confirmed lessons ahead'],
    ['Parent rating', data.ratingCount ? `${Number(data.ratingAvg).toFixed(1)} / 5` : 'No reviews yet', 'star', data.ratingCount ? `${data.ratingCount} parent review${data.ratingCount === 1 ? '' : 's'}` : 'Ratings appear after parents review lessons'],
  ]

  return (
    <div className="space-y-6">
      <TutorPageHeader title={`${greeting()}, ${user.fullName}!`} subtitle="Your teaching day, organised. Keep your hours and profile ready for your next lesson." />
      <dl className="grid gap-4 sm:grid-cols-3" aria-label="Teaching overview">
        {stats.map(([label, value, icon, hint]) => (
          <div key={label} className="card p-5">
            <dt className="flex items-center gap-2 text-sm font-semibold text-slate-600"><Icon name={icon} className="h-5 w-5 text-brand-500" />{label}</dt>
            <dd className="mt-3 text-2xl font-bold text-navy">{value}</dd>
            <dd className="mt-1 text-xs text-slate-500">{hint}</dd>
          </div>
        ))}
      </dl>
      <section className="card border-brand-200 bg-gradient-to-r from-brand-50 to-white p-5 sm:p-6" aria-labelledby="plan-title">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600"><Icon name="calendar" className="h-6 w-6" /></span>
            <div><h2 id="plan-title" className="text-xl font-bold text-navy">Make room for your next lesson</h2><p className="mt-1 max-w-xl text-sm text-slate-600">Keep a regular weekly schedule, then adjust the weeks when your plans change.</p></div>
          </div>
          <Link to="/tutor/availability" className="btn-primary min-h-11 shrink-0">Set teaching hours <Icon name="arrow-right" className="h-4 w-4" /></Link>
        </div>
      </section>
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
