import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api/client'
import Icon from '../../components/ui/Icon'
import { PageTitle, Spinner } from '../../components/ui/Common'

// Admin home: the counts that need attention (user management + complaints). Yan Hsi adds finance/booking tiles.
export default function AdminDashboard() {
  const [d, setD] = useState(null)
  useEffect(() => { api.get('/admin/dashboard').then((r) => setD(r.data)) }, [])
  if (!d) return <Spinner />

  const tiles = [
    ['user', d.parents, 'Parents', '/admin/users?role=PARENT', 'bg-brand-50', 'bg-brand-100 text-brand-500'],
    ['cap', d.tutors, 'Tutors', '/admin/users?role=TUTOR', 'bg-brand-50', 'bg-brand-100 text-brand-500'],
    ['shield', d.openComplaints, 'Open complaints', '/admin/complaints', 'bg-accent-50', 'bg-accent-100 text-accent-600'],
    ['award', d.pendingQuals, 'Qualifications to approve', '/admin/users?role=TUTOR&pending=1', 'bg-accent-50', 'bg-accent-100 text-accent-600'],
    ['info', d.flagged, 'Tutors below rating threshold', '/admin/users?role=TUTOR&flagged=1', 'bg-red-50', 'bg-red-100 text-red-500'],
    ['lock', d.deactivated, 'Deactivated accounts', '/admin/users?status=DEACTIVATED', 'bg-slate-50', 'bg-slate-200 text-slate-600'],
  ]
  return (
    <div>
      <PageTitle title="Admin Dashboard" subtitle="Things that need your attention." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map(([icon, n, label, to, bg, tone]) => (
          <Link key={label} to={to} className={`flex items-center gap-4 rounded-2xl p-5 shadow-card transition hover:shadow-lg ${bg}`}>
            <span className={`flex h-14 w-14 items-center justify-center rounded-full ${tone}`}><Icon name={icon} className="h-7 w-7" /></span>
            <span className="flex-1"><span className="block text-3xl font-extrabold text-navy">{n}</span><span className="text-sm text-slate-600">{label}</span></span>
            <Icon name="right" className="h-5 w-5 text-slate-400" />
          </Link>
        ))}
      </div>
    </div>
  )
}
