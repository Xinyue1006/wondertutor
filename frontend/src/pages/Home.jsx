import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import Icon from '../components/ui/Icon'
import Robot from '../components/ui/Robot'
import Avatar from '../components/ui/Avatar'
import ComboField from '../components/ComboField'

const LEVELS = ['Kindergarten', 'Primary', 'Secondary']
const SEARCH_KEY = 'wt-last-search' // remembered for the visit, so coming back from a profile does not empty the form
const HANDOFF_KEY = 'wt-home-search' // read (once) by the matching wizard

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

// Each claim here exists in the system (or is part of the approved scope); "Secure Payments" is not repeated from the benefits row
const SAFETY = [
  ['pin', 'GPS Attendance', 'Check-in at the lesson location'],
  ['star', 'Transparent Reviews', 'Real feedback from parents'],
  ['shield', 'Refund Review', 'Refund requests checked by admins'],
  ['user', 'Admin Support', 'Complaints handled by admins'],
]

// Small decorative shapes for the assistant / How It Works cards. All are aria-hidden and sit in the card corners, away from text.
const Moon = ({ className }) => (
  <svg viewBox="0 0 48 48" className={className} aria-hidden="true"><path d="M30 4a20 20 0 1 0 14 34A17 17 0 0 1 30 4z" fill="#ffc83d" /></svg>
)
const PaperPlane = ({ className }) => (
  <svg viewBox="0 0 64 56" className={className} aria-hidden="true">
    <path d="M2 24L62 2 44 54 31 36z" fill="#ffc83d" />
    <path d="M31 36L62 2 24 31z" fill="#f5b70f" />
    <path d="M31 36l-2 14 9-10z" fill="#e0a400" />
  </svg>
)
const Sparkle = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true"><path d="M12 1l2.6 8.4L23 12l-8.4 2.6L12 23l-2.6-8.4L1 12l8.4-2.6z" fill="#ffc83d" /></svg>
)

const readSaved = () => {
  try { return { subject: '', level: '', location: '', ...JSON.parse(sessionStorage.getItem(SEARCH_KEY) || '{}') } } catch { return { subject: '', level: '', location: '' } }
}

export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [home, setHome] = useState({ tutors: [], subjects: [], locations: [], loaded: false })
  const [search, setSearch] = useState(readSaved)
  const [errors, setErrors] = useState({})

  // Public endpoint: the landing page works before anyone logs in. If it fails the page still renders.
  useEffect(() => {
    api.get('/public/home')
      .then((r) => setHome({ ...r.data, loaded: true }))
      .catch(() => setHome((h) => ({ ...h, loaded: true })))
  }, [])

  const isParent = user?.role === 'PARENT'
  // Finding a tutor needs an account (the matching and booking data is private), so guests go to Log In first
  const findTutor = () => navigate(isParent ? '/parent/find-tutor' : '/login')
  const openProfile = (id) => navigate(isParent ? `/parent/tutors/${id}` : '/login')
  const tryAssistant = () => navigate(isParent ? '/parent/find-tutor/match' : '/signup')

  const update = (field) => (value) => {
    setSearch((s) => ({ ...s, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  // Error prevention: subject and level are mandatory for matching, so check them before leaving the page
  function validate() {
    const found = {}
    const has = (list, v) => list.some((o) => o.toLowerCase() === v.trim().toLowerCase())
    if (!search.subject.trim()) found.subject = 'Choose a subject.'
    else if (home.subjects.length && !has(home.subjects, search.subject)) found.subject = 'Pick a subject from the list.'
    if (!search.level.trim()) found.level = 'Choose an education level.'
    else if (!has(LEVELS, search.level)) found.level = 'Pick a level from the list.'
    if (search.location.trim() && home.locations.length && !has(home.locations, search.location)) found.location = 'Pick a location from the list.'
    return found
  }

  // The hero search only asks for the three basics. Availability, budget, teaching mode and preferences are
  // collected in the next step (the matching wizard), which picks these values up.
  const startSearch = (e) => {
    e.preventDefault()
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    try {
      sessionStorage.setItem(SEARCH_KEY, JSON.stringify(search))
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(search))
    } catch { /* storage blocked: the wizard just starts empty */ }
    navigate(isParent ? '/parent/find-tutor/match' : '/login')
  }

  const errorList = Object.values(errors).filter(Boolean)
  // One short sentence, whatever combination is wrong
  const errorText = errors.subject && errors.level && !search.subject.trim() && !search.level.trim() ? 'Choose a subject and an education level.' : errorList.join(' ')
  const selection = [search.subject, search.level, search.location].filter((v) => v.trim()).join(' · ')
  const ready = search.subject.trim() && search.level.trim() && errorList.length === 0

  return (
    <div className="space-y-10 pt-4">
      {/* ── Hero: full width, no card border (breaks out of the page container) ── */}
      <section aria-labelledby="hero-title" className="relative left-1/2 z-10 -mt-4 w-screen -translate-x-1/2 overflow-x-clip bg-gradient-to-r from-brand-50 via-brand-50 to-brand-25">
        <img src="/img/art/hero-blob.png" alt="" aria-hidden="true" className="pointer-events-none absolute left-0 top-0 hidden h-full w-auto max-w-[110px] object-cover object-left md:block" style={{ maskImage: 'linear-gradient(to right, #000 60%, transparent)', WebkitMaskImage: 'linear-gradient(to right, #000 60%, transparent)' }} />
        <img
          src="/img/art/hero-girl.jpg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-auto max-w-[62%] object-cover object-right lg:block"
          style={{ maskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.35) 18%, rgba(0,0,0,0.8) 36%, #000 55%)', WebkitMaskImage: 'linear-gradient(to right, transparent 0%, rgba(0,0,0,0.35) 18%, rgba(0,0,0,0.8) 36%, #000 55%)' }}
        />
        <div className="relative mx-auto max-w-[1300px] px-4 py-8 md:px-8 md:py-10">
          <div className="lg:w-[50%] lg:pl-14">
            <div className="eyebrow">Personalised tutor matching</div>
            <h1 id="hero-title" className="mt-2 font-display text-4xl font-bold leading-[1.12] text-navy md:text-[2.5rem]">
              Find the right tutor for your{' '}
              <span className="relative inline-block">
                child.
                <span className="absolute -bottom-1 left-0 h-1 w-full rounded-full bg-accent" aria-hidden="true" />
              </span>
            </h1>
            <p className="mt-3 max-w-md text-base text-slate-700">
              Trusted tutors. Flexible booking. A safer and more supportive learning journey, all in one place.
            </p>

            {/* One search component: the three basics + one clear action. Extra criteria come in the next step. */}
            <form onSubmit={startSearch} noValidate aria-label="Search for a tutor" className="relative mt-5 grid gap-1 rounded-2xl bg-white p-2.5 shadow-card md:grid-cols-3 lg:flex lg:w-[138%] lg:items-center">
              <ComboField icon="book" label="Subject" required placeholder="e.g. Mathematics" value={search.subject} options={home.subjects} error={errors.subject} onChange={update('subject')} />
              <ComboField icon="cap" label="Education Level" required placeholder="e.g. Primary" value={search.level} options={LEVELS} error={errors.level} onChange={update('level')} />
              <ComboField icon="pin" label="Location" placeholder="e.g. Kepong, KL" value={search.location} options={home.locations} error={errors.location} onChange={update('location')} />
              <button className="btn-accent mt-1 h-12 shrink-0 px-6 md:col-span-3 lg:col-span-1 lg:mt-0">
                Search Tutors <Icon name="arrow-right" className="h-4 w-4" />
              </button>
            </form>

            {/* Feedback line. Its height is fixed (and long text is cut with an ellipsis) so choosing options
                never makes the hero grow or jump. Icon + words, so it never relies on colour alone. */}
            <div className="mt-2 h-11 overflow-hidden text-sm lg:h-6" aria-live="polite">
              {errorList.length > 0 ? (
                <p role="alert" className="flex items-start gap-1.5 font-medium text-red-700 lg:items-center">
                  <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 lg:mt-0" />
                  <span className="line-clamp-2 lg:truncate">{errorText}</span>
                </p>
              ) : ready ? (
                <p className="flex items-start gap-1.5 text-slate-700 lg:items-center">
                  <Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0 text-ok lg:mt-0" />
                  <span className="line-clamp-2 lg:truncate" title={selection}>Selected: {selection}</span>
                </p>
              ) : (
                <p className="line-clamp-2 text-slate-600 lg:truncate">Subject and education level are required. Location is optional.</p>
              )}
            </div>

            {/* The AI path is an alternative, so it is quieter than the main search button */}
            <button
              type="button"
              onClick={tryAssistant}
              className="mt-2 flex min-h-14 w-full max-w-md items-center gap-3 rounded-2xl border border-brand-100 bg-white/80 px-4 py-2 text-left transition hover:bg-white hover:shadow-card"
            >
              <Robot className="h-10 w-10 shrink-0" />
              <span className="flex-1">
                <span className="block text-sm font-bold text-navy">Not sure which tutor to choose?</span>
                <span className="block text-sm text-slate-600">Chat with our AI assistant for personalised recommendations.</span>
              </span>
              <Icon name="arrow-right" className="h-5 w-5 shrink-0 text-brand-500" />
            </button>

            {/* On phones and tablets the photo sits below the content instead of behind it */}
            <img src="/img/art/hero-girl.jpg" alt="" aria-hidden="true" className="mt-6 h-48 w-full rounded-2xl object-cover object-right lg:hidden" />
          </div>
        </div>
      </section>

      {/* ── Platform benefits ── */}
      <section id="for-parents" aria-label="Platform benefits" className="grid scroll-mt-24 gap-6 px-2 sm:grid-cols-2 lg:grid-cols-4">
        {PERKS.map(([icon, title, text]) => (
          <div key={title} className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-navy text-white"><Icon name={icon} className="h-6 w-6" /></span>
            <div>
              <h2 className="card-title">{title}</h2>
              <p className="caption mt-0.5">{text}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── Assistant + How it works: same height, padding and weight ── */}
      <section id="how-it-works" className="grid scroll-mt-24 gap-6 lg:grid-cols-2">
        <div className="relative grid gap-6 overflow-hidden rounded-3xl border border-brand-100 bg-gradient-to-br from-accent-50 via-white to-brand-50 p-7 shadow-card sm:grid-cols-[1fr_13rem]">
          <Moon className="absolute left-1 top-1 h-8 w-8 -rotate-12" />
          <Sparkle className="absolute bottom-5 left-[46%] hidden h-4 w-4 sm:block" />
          <PaperPlane className="absolute bottom-3 right-4 h-9 w-9" />
          <svg viewBox="0 0 120 60" className="absolute -right-3 bottom-8 hidden h-14 w-28 text-brand-200 sm:block" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 5" strokeLinecap="round" aria-hidden="true"><path d="M2 54C30 54 40 10 70 22s30 20 48 4" /></svg>
          <div className="flex flex-col">
            <h2 className="section-title mt-3">Meet Your<br />AI Matching Assistant</h2>
            <p className="mt-4 max-w-[17rem] text-base text-slate-700">
              Just tell us what your child needs, and we'll recommend suitable tutors with clear reasons.
            </p>
            <button onClick={tryAssistant} className="btn-primary mt-auto h-12 w-fit whitespace-nowrap px-6 max-sm:mt-6 max-sm:w-full">Try AI Matching <Icon name="arrow-right" className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-col items-center">
            {/* Illustration of the guided questions, not a live chat */}
            <div className="w-full rounded-2xl bg-white/90 p-3 text-sm shadow-card" aria-label="Example of the assistant's questions" role="group">
              <div className="relative rounded-2xl rounded-bl-sm bg-brand-50 px-3 py-2 font-medium text-navy">Hi! Tell me what you're looking for?</div>
              <div className="mt-2 space-y-1.5" aria-hidden="true">
                {['What subject?', 'What education level?', 'Preferred location?', 'Any other preferences?'].map((q) => (
                  <div key={q} className="ml-auto w-fit rounded-2xl rounded-br-sm border border-brand-100 bg-white px-3 py-1 text-slate-600">{q}</div>
                ))}
              </div>
              <p className="mt-2 text-center text-xs text-slate-500">Example questions</p>
            </div>
            <Robot className="float-y mt-3 h-20 w-20 self-start" />
          </div>
        </div>

        <div className="relative overflow-hidden rounded-3xl border border-brand-100 bg-white p-7 shadow-card">
          <p className="absolute right-6 top-4 hidden w-28 -rotate-6 text-center font-hand text-xl font-bold leading-5 text-navy sm:block" aria-hidden="true">
            Same<br />Goals<br />Brighter<br />Futures <span className="text-brand-500">♡</span>
          </p>
          <svg viewBox="0 0 90 70" className="absolute -right-2 top-24 hidden h-16 w-20 text-accent sm:block" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" aria-hidden="true"><path d="M86 4C60 2 70 40 40 38S10 56 4 66" /></svg>
          <Sparkle className="absolute bottom-4 right-5 hidden h-4 w-4 sm:block" />
          <h2 className="section-title">How It Works</h2>
          <p className="caption mt-1">Finding a tutor is simple and hassle-free.</p>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {STEPS.map(([icon, title, text], i) => (
              <li key={title} className="flex items-start gap-3 rounded-2xl bg-brand-50 p-3">
                <span className="relative mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600">
                  <Icon name={icon} className="h-6 w-6" />
                  <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-navy" aria-hidden="true">{i + 1}</span>
                </span>
                <div>
                  <h3 className="card-title"><span className="sr-only">Step {i + 1}: </span>{title}</h3>
                  <p className="caption mt-0.5">{text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Featured tutors ── */}
      <section aria-labelledby="featured-title">
        <div className="eyebrow">Featured tutors</div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="featured-title" className="section-title">Learn from Trusted Tutors</h2>
            <p className="caption mt-1">Explore some of our qualified and experienced tutors.</p>
            <p className="mt-1 text-sm font-medium text-brand-700">Sample tutor profiles for demonstration.</p>
          </div>
          <button onClick={findTutor} className="flex min-h-11 items-center gap-1 text-sm font-bold text-navy hover:text-brand-500">
            View More Tutors <Icon name="arrow-right" className="h-4 w-4" />
          </button>
        </div>

        {!home.loaded && (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-label="Loading tutors">
            {[0, 1, 2, 3].map((i) => <div key={i} className="card h-72 animate-pulse bg-brand-50" />)}
          </div>
        )}
        {home.loaded && home.tutors.length === 0 && (
          <p className="card mt-5 p-6 text-center text-slate-700">Tutor profiles will appear here soon. You can still <button onClick={findTutor} className="font-semibold text-brand-600 underline">search for a tutor</button>.</p>
        )}
        {home.tutors.length > 0 && (
          <ul className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {home.tutors.map((t) => (
              <li key={t.id} className="card flex flex-col p-4">
                <div className="flex items-start gap-3">
                  <Avatar src={t.photoUrl} name={t.name} className="h-24 w-20" rounded="rounded-xl" text="text-2xl" />
                  <div className="min-w-0 flex-1">
                    <h3 className="card-title">{t.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1 text-sm text-slate-700" aria-label={`Rated ${t.rating} out of 5 from ${t.reviewCount} reviews`}>
                      <Icon name="star" fill className="h-4 w-4 text-accent-600" />
                      <b>{t.rating}</b> <span className="text-slate-600">({t.reviewCount} reviews)</span>
                    </div>
                  </div>
                </div>
                <ul className="mt-4 space-y-2 text-[15px] leading-snug text-slate-700">
                  <li className="flex items-start gap-2"><Icon name="book" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /><span>{t.mainSubject}</span></li>
                  <li className="flex items-start gap-2"><Icon name="cap" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /><span>{t.levels}</span></li>
                  <li className="flex items-start gap-2"><Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /><span>{t.location}</span></li>
                </ul>
                <div className="mt-auto pt-4 text-lg font-bold text-navy">RM {t.hourlyRate} / hour</div>
                <button onClick={() => openProfile(t.id)} aria-label={`View profile of ${t.name}`} className="btn-outline mt-3 min-h-11 w-full">View Profile</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Trust and safety ── */}
      <section id="for-tutors" aria-labelledby="trust-title" className="grid scroll-mt-24 items-center gap-5 rounded-3xl bg-brand-50/80 p-7 shadow-card lg:grid-cols-[1fr_1.4fr]">
        <div>
          <h2 id="trust-title" className="font-display text-xl font-bold text-navy">A Safer and More Reliable Learning Experience</h2>
          <p className="caption mt-2">We provide the tools and systems to ensure a safe, transparent and trustworthy platform for both parents and tutors.</p>
        </div>
        <ul className="grid grid-cols-2 gap-4 rounded-2xl bg-white p-5 shadow-card sm:grid-cols-4">
          {SAFETY.map(([icon, title, sub]) => (
            <li key={title} className="text-center">
              <Icon name={icon} className="mx-auto h-8 w-8 text-brand-500" strokeWidth={1.5} />
              <h3 className="mt-2 text-sm font-bold text-navy">{title}</h3>
              <p className="text-sm text-slate-600">{sub}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Final call to action: one dominant button ── */}
      <section aria-labelledby="cta-title" className="flex flex-wrap items-center justify-between gap-5 rounded-3xl bg-gradient-to-r from-brand-700 via-brand-600 to-brand-700 px-8 py-8 text-white shadow-card">
        <div>
          <h2 id="cta-title" className="font-display text-2xl font-bold">Ready to Start Your Child's Learning Journey?</h2>
          <p className="mt-1 text-base text-white/90">Join learners and tutors in building a brighter future together.</p>
        </div>
        <Link to="/signup" className="btn-accent h-12 px-8 text-base max-sm:w-full">Get Started <Icon name="arrow-right" className="h-4 w-4" /></Link>
      </section>
    </div>
  )
}
