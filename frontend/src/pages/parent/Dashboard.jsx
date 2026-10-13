import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useMatching } from '../../assistant/MatchingContext'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import Robot from '../../components/ui/Robot'
import { SectionCard, Spinner, StatusPill } from '../../components/ui/Common'
import LessonDetails from '../../components/LessonDetails'
import { fmtDate, fmtTimeRange, greeting, timeAgo } from '../../lib/format'
import { gradeLabel } from '../../lib/education'
import { DAY_SHORT, hhmmLabel } from '../../lib/format'

const ACTIVITY_ICON = {
  BOOKING_CONFIRMED: ['calendar', 'bg-emerald-100 text-emerald-600'],
  BOOKING_SENT: ['clock', 'bg-accent-100 text-accent-600'],
  REVIEW_POSTED: ['star', 'bg-accent-100 text-accent-600'],
  PAYMENT_SUCCESS: ['wallet', 'bg-emerald-100 text-emerald-600'],
}

export default function ParentDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { setChatOpen, setResult } = useMatching()
  const [data, setData] = useState(null)
  const [matching, setMatching] = useState(null)
  const [detail, setDetail] = useState(null)

  useEffect(() => {
    api.get('/parent/dashboard').then((r) => setData(r.data))
    api.get('/parent/matching/latest').then((r) => setMatching(r.data.matching)).catch(() => {})
  }, [])

  if (!data) return <Spinner />
  const { children, counts, upcoming, activity } = data

  return (
    <div>
      <div className="relative mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-navy">
            {greeting()}, {user.fullName}! <span className="inline-block origin-[70%_70%] animate-[wave_2s_ease-in-out_1]">👋</span>
          </h1>
          <p className="mt-1 text-lg text-slate-500">Let's find the right learning support for your child.</p>
        </div>
        <div className="pointer-events-none hidden items-center gap-4 pr-4 lg:flex">
          <Icon name="book" className="h-14 w-14 text-brand-200" strokeWidth={1.25} />
          <div className="font-hand text-2xl leading-6 text-brand-200 [transform:rotate(-8deg)]">
            Small<br />Steps<br />Brighter<br />Futures
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.12fr_1fr]">
        {/* ───── left column ───── */}
        <div className="space-y-6">
          <section className="card relative overflow-hidden border-accent/30 bg-gradient-to-r from-accent-50 to-white p-6">
            <Icon name="sparkle" fill className="absolute left-5 top-5 h-7 w-7 text-accent" />
            <div className="pl-12 sm:pr-44">
              <h2 className="text-2xl font-extrabold text-navy">Find the Right Tutor for Your Child</h2>
              <p className="mt-1 text-sm text-slate-600">Tell us what your child needs and we'll recommend suitable tutors.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link to="/parent/find-tutor" className="btn-primary h-12 px-7 text-base">Find a Tutor <Icon name="arrow-right" className="h-4 w-4" /></Link>
                <button onClick={() => setChatOpen(true)} className="btn h-12 border border-accent bg-white/70 px-7 text-base text-navy hover:bg-accent-50">
                  <Icon name="sparkle" fill className="h-4 w-4 text-accent" /> Chat with AI
                </button>
              </div>
            </div>
            <div className="absolute bottom-3 right-6 hidden sm:block">
              <span className="absolute -top-2 right-0 flex h-20 w-20 rotate-[8deg] items-center justify-center rounded-full bg-accent-100 p-2 text-center font-hand text-sm font-bold leading-4 text-navy">
                Your AI<br />Learning<br />Assistant
              </span>
              <Robot className="float-y relative -left-8 top-3 h-32 w-32" />
            </div>
          </section>

          <SectionCard title="Your Children" action={<Link to="/parent/children" className="flex items-center gap-1 text-sm font-semibold text-brand-500 hover:underline">Manage Children <Icon name="arrow-right" className="h-4 w-4" /></Link>}>
            <div className="grid gap-3 sm:grid-cols-3">
              {children.slice(0, 2).map((c) => (
                <div key={c.id} className="rounded-xl border border-slate-100 bg-white p-4">
                  <div className="flex items-center gap-3">
                    <Avatar src={c.photoUrl} name={c.name} className="h-16 w-16" />
                    <div className="min-w-0">
                      <div className="truncate text-lg font-bold text-navy">{c.name}</div>
                      <div className="flex items-center gap-1.5 text-sm text-slate-500"><Icon name="calendar" className="h-3.5 w-3.5 text-brand-500" /> {gradeLabel(c.educationLevel, c.grade)}</div>
                      {c.subject && <div className="flex items-center gap-1.5 text-sm text-slate-500"><Icon name="book" className="h-3.5 w-3.5 text-brand-500" /> {c.subject}</div>}
                    </div>
                  </div>
                  <Link to={`/parent/children?edit=${c.id}`} className="btn-outline mt-3 w-full">View Profile <Icon name="arrow-right" className="h-4 w-4" /></Link>
                </div>
              ))}
              <Link to="/parent/children?add=1" className="flex flex-col items-center justify-center rounded-xl border border-dashed border-brand-200 bg-brand-50/60 p-4 text-center transition hover:bg-brand-50">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-500"><Icon name="plus" className="h-6 w-6" /></span>
                <span className="mt-1 font-bold text-navy">Add Child</span>
                <span className="text-xs text-slate-500">Add another child to find suitable tutors for their learning needs.</span>
              </Link>
            </div>
          </SectionCard>

          <SectionCard title="Recent Activity" action={<Link to="/parent/bookings" className="flex items-center gap-1 text-sm font-semibold text-brand-500 hover:underline">View All Activity <Icon name="arrow-right" className="h-4 w-4" /></Link>}>
            {activity.length === 0 && <p className="py-4 text-sm text-slate-500">Nothing yet. Your bookings and payments will show up here.</p>}
            <ul className="divide-y divide-slate-100">
              {activity.map((a) => {
                const [icon, tone] = ACTIVITY_ICON[a.type] || ['bell', 'bg-brand-50 text-brand-500']
                return (
                  <li key={a.id} className="flex items-center gap-3 py-3">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon name={icon} className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold text-navy">{a.title}</div>
                      <div className="truncate text-sm text-slate-500">{a.message}</div>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{timeAgo(a.createdAt)}</span>
                  </li>
                )
              })}
            </ul>
          </SectionCard>
        </div>

        {/* ───── right column ───── */}
        <div className="space-y-6">
          <SectionCard title="Booking Summary" action={<Link to="/parent/bookings" className="flex items-center gap-1 text-sm font-semibold text-brand-500 hover:underline">View All Bookings <Icon name="arrow-right" className="h-4 w-4" /></Link>}>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['calendar', counts.upcoming, 'Upcoming', 'bg-brand-50', 'bg-brand-100 text-brand-500', 'upcoming'],
                ['clock', counts.pending, 'Pending', 'bg-accent-50', 'bg-accent-100 text-accent-600', 'pending'],
                ['check', counts.completed, 'Completed', 'bg-ok-50', 'bg-ok text-white', 'completed'],
              ].map(([icon, n, label, bg, tone, tab]) => (
                <button key={label} onClick={() => navigate(`/parent/bookings?tab=${tab}`)} className={`flex items-center gap-3 rounded-xl p-3 text-left ${bg} transition hover:shadow-md`}>
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon name={icon} className="h-6 w-6" /></span>
                  <span className="flex-1"><span className="block text-3xl font-extrabold leading-8 text-navy">{n}</span><span className="text-sm text-slate-600">{label}</span></span>
                  <Icon name="right" className="h-4 w-4 text-slate-400" />
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Upcoming Lessons" action={<Link to="/parent/bookings" className="flex items-center gap-1 text-sm font-semibold text-brand-500 hover:underline">View All Bookings <Icon name="arrow-right" className="h-4 w-4" /></Link>}>
            {upcoming.length === 0 && <p className="py-4 text-sm text-slate-500">No upcoming lessons yet. Find a tutor and send a booking request.</p>}
            <div className="space-y-3">
              {upcoming.map((b) => (
                <div key={b.id} className="flex gap-4 rounded-xl border border-slate-100 p-3">
                  <Avatar src={b.tutor.photoUrl} name={b.tutor.name} className="h-[88px] w-[76px]" rounded="rounded-xl" text="text-xl" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-bold text-navy">{b.subject}</div>
                      <StatusPill status="CONFIRMED" />
                    </div>
                    <div className="text-sm text-slate-500">{b.tutor.name} <span className="mx-1 text-slate-300">|</span> {gradeLabel(b.child.educationLevel, b.child.grade)}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-sm text-navy"><Icon name="calendar" className="h-4 w-4 text-brand-500" /> {fmtDate(b.startAt)} · {fmtTimeRange(b.startAt, b.endAt)}</div>
                    <div className="mt-0.5 flex items-end justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-sm text-slate-500">
                        <Icon name={b.teachingMode === 'ONLINE' ? 'monitor' : 'pin'} className="h-4 w-4 text-brand-500" />
                        {b.teachingMode === 'ONLINE' ? 'Online' : `Physical · ${b.location || ''}`}
                      </div>
                      <button onClick={() => setDetail(b)} className="btn-outline px-3 py-1.5 text-xs">View Lesson Details <Icon name="arrow-right" className="h-3.5 w-3.5" /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Continue Where You Left Off">
            {matching ? (
              <div className="flex items-start gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white"><Icon name="search" className="h-6 w-6" /></span>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-bold text-navy">Tutor search in progress</div>
                  <p className="text-sm text-slate-500">You have {matching.total} tutor{matching.total === 1 ? '' : 's'} matching your latest preferences.</p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Icon name="book" className="h-3.5 w-3.5 text-brand-500" />{matching.criteria.subject}</span>
                    {matching.criteria.grade && <span className="flex items-center gap-1"><Icon name="calendar" className="h-3.5 w-3.5 text-brand-500" />{gradeLabel(matching.criteria.level, matching.criteria.grade)}</span>}
                    <span className="flex items-center gap-1"><Icon name="pin" className="h-3.5 w-3.5 text-brand-500" />{matching.criteria.mode === 'ONLINE' ? 'Online' : matching.criteria.mode === 'PHYSICAL' ? 'Physical' : 'Online / Physical'}</span>
                    {matching.criteria.location && <span className="flex items-center gap-1"><Icon name="pin" className="h-3.5 w-3.5 text-brand-500" />{matching.criteria.location}</span>}
                    {matching.criteria.days?.length > 0 && <span className="flex items-center gap-1"><Icon name="clock" className="h-3.5 w-3.5 text-brand-500" />{matching.criteria.days.map((d) => DAY_SHORT[d]).join(', ')}{matching.criteria.timeStart && ` · ${hhmmLabel(matching.criteria.timeStart)}`}</span>}
                  </div>
                  <button onClick={() => { setResult(matching); navigate('/parent/find-tutor/results') }} className="btn-primary mt-4 h-11 px-6">
                    View Recommendations <Icon name="arrow-right" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500"><Icon name="search" className="h-6 w-6" /></span>
                <div>
                  <div className="font-bold text-navy">No tutor search yet</div>
                  <p className="text-sm text-slate-500">Start with the matching wizard or chat with our AI Tutor Assistant.</p>
                  <Link to="/parent/find-tutor/match" className="btn-primary mt-3 px-5">Start Matching</Link>
                </div>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <LessonDetails booking={detail} onClose={() => setDetail(null)} onChanged={() => api.get('/parent/dashboard').then((r) => setData(r.data))} />
    </div>
  )
}
