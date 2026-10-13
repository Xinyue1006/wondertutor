import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/ui/Icon'
import Robot from '../components/ui/Robot'
import Avatar from '../components/ui/Avatar'

const LEVELS = ['Kindergarten', 'Primary', 'Secondary']

const PERKS = [
  ['cap', 'AI-Powered Matching', "Find tutors that fit your child's needs and learning style."],
  ['shield', 'Verified Tutor Profiles', 'View qualifications, experience and real reviews.'],
  ['calendar', 'Flexible Booking', 'Choose available times and negotiate with tutors.'],
  ['card', 'Secure Payments', 'Pay easily via FPX with transparent records.'],
]

const STEPS = [
  ['search', 'Tell Us Your Needs', 'Subject, level, location, schedule and preferences.'],
  ['sparkle', 'Get Matched', 'Our assistant recommends suitable tutors for you.'],
  ['calendar', 'Choose & Book', 'Compare profiles, negotiate and confirm a session.'],
  ['star', 'Learn & Review', 'Attend the lesson and leave a review to support other learners.'],
]

const SAFETY = [
  ['pin', 'GPS Attendance', 'Verified in-person lessons'],
  ['shield', 'Transparent Reviews', 'Real feedback from parents'],
  ['card', 'Secure Payments', 'Powered by FPX'],
  ['user', 'Admin Support', 'Assistance when needed'],
]

const labelCls = 'block text-[11px] font-bold text-navy'
const selectCls = 'mt-0.5 w-full bg-transparent text-xs text-slate-500 outline-none'

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [home, setHome] = useState({ tutors: [], subjects: [], locations: [] })
  const [search, setSearch] = useState({ subject: '', level: '', location: '' })

  // Public endpoint: the landing page works before anyone logs in. If it fails the page still renders.
  useEffect(() => {
    api.get('/public/home').then((r) => setHome(r.data)).catch(() => {})
  }, [])

  // Finding a tutor needs an account (the matching and booking data is private), so guests go to Log In first
  const findTutor = (e) => {
    e?.preventDefault()
    navigate(user?.role === 'PARENT' ? '/parent/find-tutor' : '/login')
  }
  const tryAssistant = () => navigate(user?.role === 'PARENT' ? '/parent/find-tutor/match' : '/signup')

  return (
    <div className="space-y-10 pt-4">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-white via-brand-50 to-brand-100 shadow-card">
        <img
          src="/img/art/hero-girl.jpg"
          alt=""
          className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-auto lg:block"
          style={{ maskImage: 'linear-gradient(to right, transparent 0%, #000 30%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0%, #000 30%)' }}
        />
        <div className="relative px-6 py-10 md:px-12 md:py-14 lg:w-[62%]">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-navy">Personalised tutor matching</div>
          <h1 className="mt-3 text-5xl font-extrabold leading-[1.05] tracking-tight text-navy md:text-6xl">
            Find the right tutor for your{' '}
            <span className="relative inline-block">
              child.
              <span className="absolute -bottom-1 left-0 h-1 w-full rounded-full bg-accent" />
            </span>
          </h1>
          <p className="mt-4 max-w-md text-base text-slate-600">
            Trusted tutors. Flexible booking. A safer and more supportive learning journey, all in one place.
          </p>

          <form onSubmit={findTutor} className="mt-7 flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-card md:flex-row md:items-center">
            <label className="flex flex-1 items-center gap-2 px-2">
              <Icon name="book" className="h-5 w-5 shrink-0 text-brand-500" />
              <span className="flex-1">
                <span className={labelCls}>Subject</span>
                <input className={selectCls} list="home-subjects" placeholder="e.g. Mathematics" value={search.subject} onChange={(e) => setSearch({ ...search, subject: e.target.value })} />
              </span>
            </label>
            <label className="flex flex-1 items-center gap-2 border-slate-100 px-2 md:border-l">
              <Icon name="cap" className="h-5 w-5 shrink-0 text-brand-500" />
              <span className="flex-1">
                <span className={labelCls}>Education Level</span>
                <input className={selectCls} list="home-levels" placeholder="e.g. Primary" value={search.level} onChange={(e) => setSearch({ ...search, level: e.target.value })} />
              </span>
            </label>
            <label className="flex flex-1 items-center gap-2 border-slate-100 px-2 md:border-l">
              <Icon name="pin" className="h-5 w-5 shrink-0 text-brand-500" />
              <span className="flex-1">
                <span className={labelCls}>Location</span>
                <input className={selectCls} list="home-locations" placeholder="e.g. Kepong, KL" value={search.location} onChange={(e) => setSearch({ ...search, location: e.target.value })} />
              </span>
            </label>
            {/* Typing is allowed; the datalists suggest matching keywords as the parent types */}
            <datalist id="home-subjects">{home.subjects.map((x) => <option key={x} value={x} />)}</datalist>
            <datalist id="home-levels">{LEVELS.map((x) => <option key={x} value={x} />)}</datalist>
            <datalist id="home-locations">{home.locations.map((x) => <option key={x} value={x} />)}</datalist>
            <button className="btn-accent h-11 px-5">Search Tutors <Icon name="arrow-right" className="h-4 w-4" /></button>
          </form>

          <button
            onClick={tryAssistant}
            className="mt-4 flex w-full max-w-xl items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-card transition hover:shadow-lg"
          >
            <Icon name="sparkle" fill className="h-7 w-7 shrink-0 text-accent" />
            <span className="flex-1">
              <span className="block text-sm font-bold text-navy">Not sure which tutor to choose?</span>
              <span className="block text-xs text-slate-500">Chat with our AI assistant and get personalised recommendations.</span>
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-white"><Icon name="arrow-right" className="h-4 w-4" /></span>
          </button>
        </div>
      </section>

      {/* ── Perks ── */}
      <section id="for-parents" className="grid scroll-mt-24 gap-6 px-2 sm:grid-cols-2 lg:grid-cols-4">
        {PERKS.map(([icon, title, text]) => (
          <div key={title} className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-navy text-white"><Icon name={icon} className="h-6 w-6" /></span>
            <div>
              <div className="text-sm font-bold text-navy">{title}</div>
              <p className="mt-0.5 text-xs text-slate-500">{text}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── Assistant + How it works ── */}
      <section id="how-it-works" className="grid scroll-mt-24 gap-5 lg:grid-cols-2">
        <div className="grid gap-6 overflow-hidden rounded-3xl bg-gradient-to-br from-accent-50 via-white to-brand-50 p-7 shadow-card sm:grid-cols-[1fr_13rem]">
          <div>
            <h2 className="text-2xl font-extrabold text-navy">Meet Your<br />AI Matching Assistant</h2>
            <p className="mt-3 max-w-[16rem] text-sm text-slate-600">
              Just tell us what your child needs, and we'll recommend suitable tutors with clear reasons.
            </p>
            <button onClick={tryAssistant} className="btn-primary mt-5 h-11 px-6">Try AI Matching <Icon name="arrow-right" className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-col items-center">
            <div className="w-full rounded-2xl bg-white/90 p-3 text-xs shadow-card">
              <div className="rounded-xl bg-brand-50 px-3 py-2 font-medium text-navy">Hi! Tell me what you're looking for?</div>
              <div className="mt-2 space-y-1.5">
                {['What subject?', 'What education level?', 'Preferred location?', 'Any other preferences?'].map((q) => (
                  <div key={q} className="rounded-full border border-brand-100 bg-white px-3 py-1 text-slate-600">{q}</div>
                ))}
              </div>
            </div>
            <Robot className="float-y mt-3 h-28 w-28" />
          </div>
        </div>

        <div className="rounded-3xl bg-brand-50/70 p-7 shadow-card">
          <h2 className="text-2xl font-extrabold text-navy">How It Works</h2>
          <p className="mt-1 text-sm text-slate-500">Finding a tutor is simple and hassle-free.</p>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {STEPS.map(([icon, title, text]) => (
              <div key={title} className="flex items-start gap-3">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-500"><Icon name={icon} className="h-6 w-6" /></span>
                <div>
                  <div className="text-sm font-bold text-navy">{title}</div>
                  <p className="mt-0.5 text-xs text-slate-500">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Featured tutors ── */}
      <section>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-navy">Featured tutors</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-3xl font-extrabold text-navy">Learn from Trusted Tutors</h2>
            <p className="mt-1 text-sm text-slate-500">Explore some of our qualified and experienced tutors.</p>
          </div>
          <button onClick={findTutor} className="flex items-center gap-1 text-xs font-bold text-navy hover:text-brand-500">
            View More Tutors <Icon name="arrow-right" className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {home.tutors.map((t) => (
            <div key={t.id} className="card p-4">
              <div className="flex items-start gap-3">
                <Avatar src={t.photoUrl} name={t.name} className="h-16 w-14" rounded="rounded-lg" text="text-lg" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-navy">{t.name}</div>
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-600">
                    <Icon name="star" fill className="h-3.5 w-3.5 text-accent" />
                    <b>{t.rating}</b> <span className="text-slate-400">({t.reviewCount} reviews)</span>
                  </div>
                </div>
                <Icon name="heart" className="h-4 w-4 text-slate-300" />
              </div>
              <ul className="mt-3 space-y-1.5 text-xs text-slate-500">
                <li className="flex items-center gap-2"><Icon name="book" className="h-3.5 w-3.5" />{t.mainSubject}</li>
                <li className="flex items-center gap-2"><Icon name="cap" className="h-3.5 w-3.5" />{t.levels}</li>
                <li className="flex items-center gap-2"><Icon name="pin" className="h-3.5 w-3.5" />{t.location}</li>
              </ul>
              <div className="mt-3 text-sm font-bold text-navy">RM {t.hourlyRate} / hour</div>
              <button onClick={findTutor} className="btn-outline mt-3 w-full py-1.5 text-xs">View Profile</button>
            </div>
          ))}
        </div>
      </section>

      {/* ── Safer experience ── */}
      <section id="for-tutors" className="grid scroll-mt-24 items-center gap-5 rounded-3xl bg-brand-50/80 p-7 shadow-card lg:grid-cols-[1fr_1.4fr]">
        <div>
          <h2 className="text-xl font-extrabold text-navy">A Safer and More Reliable Learning Experience</h2>
          <p className="mt-2 text-xs text-slate-500">We provide the tools and systems to ensure a safe, transparent and trustworthy platform for both parents and tutors.</p>
        </div>
        <div className="grid grid-cols-2 gap-4 rounded-2xl bg-white p-5 shadow-card sm:grid-cols-4">
          {SAFETY.map(([icon, title, sub]) => (
            <div key={title} className="text-center">
              <Icon name={icon} className="mx-auto h-8 w-8 text-brand-500" strokeWidth={1.5} />
              <div className="mt-2 text-xs font-bold text-navy">{title}</div>
              <div className="text-[10px] text-slate-500">{sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Call to action ── */}
      <section className="flex flex-wrap items-center justify-between gap-5 rounded-3xl bg-gradient-to-r from-brand-700 via-brand-500 to-brand-600 px-8 py-8 text-white shadow-card">
        <div>
          <h2 className="text-2xl font-extrabold">Ready to Start Your Child's Learning Journey?</h2>
          <p className="mt-1 text-sm text-white/85">Join learners and tutors in building a brighter future together.</p>
        </div>
        <Link to="/signup" className="btn-accent h-12 px-8 text-base">Get Started <Icon name="arrow-right" className="h-4 w-4" /></Link>
      </section>
    </div>
  )
}
