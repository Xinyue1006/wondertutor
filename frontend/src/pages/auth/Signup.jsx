import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { homeFor } from '../../components/ProtectedRoute'
import Icon from '../../components/ui/Icon'
import GoogleButton from '../../components/GoogleButton'
import Recaptcha, { RECAPTCHA_SITE_KEY } from '../../components/Recaptcha'
import { ErrorBox } from '../../components/ui/Common'
import { GRADE_GROUPS, parseGrade } from '../../lib/education'
import PreferencesFields from '../../components/PreferencesFields'
import { emptyPreferences, isEmptyPreferences, toApiPreferences } from '../../lib/preferences'

// 3-step signup (UI_v1): Choose Role -> Account Details (side menu of sections) -> Complete (email OTP)
const STEPS = ['Choose Role', 'Account Details', 'Complete']

// Side-menu sections. Only what is needed to create the account is mandatory; the rest can be completed later.
// The Tutor Portal sections after "Contact Details" (teaching information, availability, qualifications, review) belong to
// the Tutor Portal and are completed after the email is verified, so they are shown locked, as in the mockup menu.
const SECTIONS = {
  PARENT: [
    { id: 'basic', label: 'Basic Information', icon: 'user' },
    { id: 'contact', label: 'Contact Details', icon: 'phone' },
    { id: 'children', label: 'My Children', icon: 'user', optional: true },
    { id: 'preferences', label: 'Preferences', icon: 'sliders', optional: true },
  ],
  TUTOR: [
    { id: 'basic', label: 'Basic Information', icon: 'user' },
    { id: 'contact', label: 'Contact Details', icon: 'phone' },
    { id: 'teaching', label: 'Teaching Information', icon: 'book', locked: true },
    { id: 'availability', label: 'Availability', icon: 'calendar', locked: true },
    { id: 'quals', label: 'Qualifications', icon: 'award', locked: true },
    { id: 'review', label: 'Review & Submit', icon: 'check-circle', locked: true },
  ],
}

// Progress is kept for this browser session (never the passwords), so a refresh or a trip back to the role step does not lose it
const DRAFT_KEY = 'wt-signup-draft'
function loadDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null') } catch { return null }
}

const emptyForm = {
  fullName: '', email: '', phone: '', address: '', password: '', confirmPassword: '',
  gender: '', emergencyContactName: '', emergencyContactPhone: '',
}

export default function Signup() {
  const navigate = useNavigate()
  const { saveSession } = useAuth()
  const draft = useRef(loadDraft()).current
  const [step, setStep] = useState(0)
  const [role, setRole] = useState(draft?.role || 'PARENT')
  const [section, setSection] = useState('basic')
  const [form, setForm] = useState({ ...emptyForm, ...(draft?.form || {}) })
  const [kids, setKids] = useState(draft?.kids || [])
  const [prefs, setPrefs] = useState({ ...emptyPreferences(), ...(draft?.prefs || {}) })
  const [subjects, setSubjects] = useState([])
  const [photo, setPhoto] = useState(null)
  const [captcha, setCaptcha] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const sections = SECTIONS[role]
  const active = sections.filter((s) => !s.locked)
  const idx = active.findIndex((s) => s.id === section)

  // The subject list comes from the public endpoint (the same list the tutors teach), so children are never saved with a subject nobody teaches
  useEffect(() => {
    api.get('/public/home').then((r) => setSubjects(r.data.subjects || [])).catch(() => {})
  }, [])

  useEffect(() => {
    try {
      const { password, confirmPassword, ...safe } = form
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ role, form: safe, kids, prefs }))
    } catch { /* storage blocked: progress just isn't remembered */ }
  }, [role, form, kids, prefs])

  function validate(id) {
    if (id === 'basic') {
      if (!form.fullName.trim()) return 'Full name is required'
      if (!/^\S+@\S+\.\S+$/.test(form.email)) return 'Enter a valid email address'
      if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password))
        return 'Password must be at least 8 characters and contain a letter and a number'
      if (form.password !== form.confirmPassword) return 'Passwords do not match'
      if (role === 'TUTOR') {
        if (!form.emergencyContactName.trim() || form.emergencyContactPhone.replace(/\D/g, '').length < 8) return 'Emergency contact name and number are required'
        if (!form.gender) return 'Please select your gender'
      }
    }
    if (id === 'contact') {
      if (form.phone.replace(/\D/g, '').length < 8) return 'Enter a valid phone number'
    }
    if (id === 'children') {
      // A child is only useful for matching with a level and a subject, so both are required for every row that is added
      if (kids.some((k) => !k.name.trim() || !k.grade)) return 'Please complete each child (name and level) or remove the row'
      if (kids.some((k) => !k.subject)) return 'Choose the subject each child needs help with, or remove the row'
    }
    return ''
  }

  // Ticks in the side menu: a section counts as done once its content is valid and actually filled in
  const isDone = (id) => {
    if (id === 'basic') return Boolean(form.fullName.trim() && form.email && form.password) && !validate('basic')
    if (id === 'contact') return Boolean(form.phone) && !validate('contact')
    if (id === 'children') return kids.length > 0 && !validate('children')
    if (id === 'preferences') return !isEmptyPreferences(prefs)
    return false
  }

  async function next(e) {
    e.preventDefault()
    const problem = validate(section)
    if (problem) return setError(problem)
    setError('')
    if (idx < active.length - 1) return setSection(active[idx + 1].id)
    await submit()
  }

  async function submit() {
    // Re-check earlier sections in case the user jumped around via the side menu
    for (const s of active) {
      const problem = validate(s.id)
      if (problem) { setSection(s.id); return setError(problem) }
    }
    if (RECAPTCHA_SITE_KEY && !captcha) return setError('Please tick “I’m not a robot” to continue.')
    setBusy(true)
    try {
      await api.post('/auth/register', {
        role,
        recaptchaToken: captcha || undefined,
        fullName: form.fullName,
        email: form.email,
        phone: `+60${form.phone.replace(/\D/g, '').replace(/^0|^60/, '')}`,
        password: form.password,
        ...(role === 'PARENT' && {
          address: form.address || undefined,
          children: kids.map((k) => ({ name: k.name, educationLevel: k.level, grade: k.grade, subject: k.subject, ...(k.notes?.trim() && { notes: k.notes.trim() }) })),
          preferences: toApiPreferences(prefs) ?? undefined,
        }),
        ...(role === 'TUTOR' && {
          gender: form.gender,
          emergencyContactName: form.emergencyContactName,
          emergencyContactPhone: `+60${form.emergencyContactPhone.replace(/\D/g, '').replace(/^0|^60/, '')}`,
        }),
      })
      setStep(2)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function submitOtp(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const res = await api.post('/auth/verify-otp', { email: form.email, code: otp })
      try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      saveSession(res.data.token, res.data.user, true)
      navigate(homeFor(res.data.user.role))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function resendOtp() {
    setError('')
    try { await api.post('/auth/resend-otp', { email: form.email }) } catch (err) { setError(errorMessage(err)) }
  }

  return (
    // Sits on the same nearly-white body colour as the landing page (set in PublicLayout)
    <section className="relative left-1/2 -mb-10 w-screen -translate-x-1/2 overflow-x-clip pb-4 pt-6">
      {/* quiet decoration like the mockup: pale circles on the left, leaves in the bottom-right corner */}
      <div className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block" aria-hidden="true">
        <span className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-brand-100/40" />
        <span className="absolute -left-10 bottom-10 h-40 w-40 rounded-full bg-brand-100/30" />
        {/* transparent cut-out of the plant: it bleeds off the right edge and fades out softly at the bottom, so nothing ends on a hard line */}
        <img src="/img/art/leaf-corner.png" alt="" className="absolute bottom-3 right-0 h-[22rem] w-auto" />
      </div>
    <div className="relative mx-auto max-w-[81.25rem] px-4 md:px-8">
      <div className="relative">
        {step < 2 && (
          <button onClick={() => (step === 1 ? setStep(0) : navigate('/'))} className="absolute left-0 top-0 flex min-h-11 items-center gap-2 text-sm font-medium text-navy hover:text-brand-600">
            <Icon name="arrow-left" className="h-4 w-4" /> Back
          </button>
        )}
        <Stepper step={step} />
      </div>

      {step === 0 && (
        <div className="mx-auto mt-6 max-w-[860px] text-center">
          <h1 className="font-display text-3xl font-bold text-navy md:text-4xl">
            Join WonderTutor <Icon name="sparkle" fill className="mb-2 inline h-5 w-5 text-accent" />
          </h1>
          <p className="mt-1 text-base text-slate-700">Choose how you will use WonderTutor.</p>
          <p className="text-sm text-slate-700">
            Already have an account? <Link to="/login" className="inline-flex min-h-11 items-center font-semibold text-brand-600 hover:underline">Log In</Link>
          </p>
          <div role="radiogroup" aria-label="I am joining as" className="mt-6 grid gap-5 text-left md:grid-cols-2">
            <RoleCard
              active={role === 'PARENT'} onClick={() => setRole('PARENT')} img="/img/art/role-parent.jpg" tone="blue"
              title="I'm a Parent" desc="Find and book suitable tutors for your child."
              points={['Browse qualified tutors', 'Track lessons and bookings', 'Manage multiple children', 'Leave reviews and feedback']}
            />
            <RoleCard
              active={role === 'TUTOR'} onClick={() => setRole('TUTOR')} img="/img/art/role-tutor.jpg" tone="yellow"
              title="I'm a Tutor" desc="Share your knowledge and teaching experience."
              points={['Set your availability', 'Manage your bookings', 'Track your earnings', 'Build your teaching profile']}
            />
          </div>
          <button onClick={() => { setSection('basic'); setStep(1) }} className="btn-primary mx-auto mt-5 h-12 w-full max-w-[560px] text-base">
            Next <Icon name="arrow-right" className="h-4 w-4" />
          </button>
          <div className="mx-auto mt-4 max-w-[560px]">
            <div className="mb-3 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" /> or sign up with <span className="h-px flex-1 bg-slate-200" /></div>
            <GoogleButton role={role} onError={setError} />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="mx-auto mt-6 grid max-w-[68.75rem] overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-card md:grid-cols-[260px_1fr]">
          {/* one card: the menu panel and the form share a single box, separated only by a thin divider */}
          {/* The side panel is as tall as the form next to it: the menu stays on top and the picture fills the rest, anchored to the bottom */}
          <aside className="flex flex-col overflow-hidden border-b border-brand-100 bg-brand-25 p-3 md:border-b-0 md:border-r">
           <div className="space-y-1.5">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={s.locked}
                onClick={() => { setError(''); setSection(s.id) }}
                title={s.locked ? 'Completed in the Tutor Portal after your email is verified' : ''}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm font-medium transition ${
                  section === s.id ? 'border-brand-500 bg-white text-brand-600 shadow-card' : 'border-transparent text-navy hover:bg-white/70'
                } ${s.locked ? 'cursor-not-allowed opacity-55' : ''}`}
              >
                <Icon name={s.icon} className="h-[18px] w-[18px] shrink-0" />
                <span className="min-w-0 flex-1">
                  {s.label}
                  {s.optional && !isDone(s.id) && <span className="block text-xs font-normal text-slate-600">Optional</span>}
                </span>
                {s.locked && <Icon name="lock" className="ml-auto h-3.5 w-3.5" />}
                {!s.locked && isDone(s.id) && <Icon name="check-circle" className="ml-auto h-4 w-4 shrink-0 text-ok" aria-label="Completed" />}
              </button>
            ))}
           </div>
            {/* the whole illustration at its natural shape, sitting at the bottom of the panel (menu on top, picture below) */}
            <div className="mt-auto hidden pt-4 md:block">
              <img
                src={role === 'PARENT' ? '/img/art/signup-parent.jpg' : '/img/art/signup-tutor.jpg'}
                alt="" aria-hidden="true"
                className="-mx-3 -mb-3 block w-[calc(100%+1.5rem)] max-w-none [mask-image:linear-gradient(to_top,black_72%,transparent)]"
              />
            </div>
          </aside>

          <form onSubmit={next} noValidate className="p-6 md:p-8">
            <h1 className="font-display text-3xl font-bold text-navy">Create Your {role === 'PARENT' ? 'Parent' : 'Tutor'} Account</h1>
            <p className="mt-1 text-sm text-slate-500">
              {role === 'PARENT' ? "Let's set up your profile to get started." : 'Build your profile and let parents discover your expertise.'}
            </p>

            <div className="mt-5 rounded-xl border border-brand-100 bg-brand-25 p-5">
              {/* Every section is laid out in the same grid cell and the inactive ones are only hidden, so the card is always as tall as the
                  tallest section and switching sections never moves the footer. (invisible = not focusable and skipped by screen readers) */}
              <div className="grid">
                {active.map((sec) => (
                  <div key={sec.id} className={`col-start-1 row-start-1 ${section === sec.id ? '' : 'invisible'}`} aria-hidden={section !== sec.id}>
                    <h2 className="mb-4 font-display text-lg font-bold text-navy">{sec.label}</h2>
                    {sec.id === 'basic' && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Input label="Full Name" required value={form.fullName} onChange={set('fullName')} placeholder="e.g. Miki Lim" autoComplete="name" />
                        <Input label="Email Address" required type="email" value={form.email} onChange={set('email')} placeholder="you@example.com" autoComplete="email" />
                        <Input label="Create Password" required type="password" value={form.password} onChange={set('password')} placeholder="At least 8 characters" autoComplete="new-password" />
                        <Input label="Confirm Password" required type="password" value={form.confirmPassword} onChange={set('confirmPassword')} placeholder="Re-enter your password" autoComplete="new-password" />
                        <p className="text-xs text-slate-600 md:col-span-2">Use a letter and a number. Your email is your login.</p>
                        {role === 'TUTOR' && (
                          <>
                            <Input label="Emergency Contact Name" required value={form.emergencyContactName} onChange={set('emergencyContactName')} placeholder="e.g. Lee Siew Ling" />
                            <Phone label="Emergency Contact Number" required value={form.emergencyContactPhone} onChange={set('emergencyContactPhone')} />
                            <fieldset className="md:col-span-2">
                              <legend className="mb-1.5 text-sm font-semibold text-navy">Gender <span className="text-red-600">*</span></legend>
                              <div className="flex flex-wrap gap-x-6 text-sm text-navy">
                                {[['MALE', 'Male'], ['FEMALE', 'Female'], ['UNSPECIFIED', 'Prefer not to say']].map(([v, l]) => (
                                  <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2">
                                    <input type="radio" name="gender" className="h-4 w-4 accent-brand-500" checked={form.gender === v} onChange={() => setForm({ ...form, gender: v })} /> {l}
                                  </label>
                                ))}
                              </div>
                              <p className="text-xs text-slate-600">Your emergency contact stays private. It is never shown on your public profile.</p>
                            </fieldset>
                          </>
                        )}
                      </div>
                    )}

                    {sec.id === 'contact' && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <Phone label="Phone Number" required value={form.phone} onChange={set('phone')} />
                        {role === 'PARENT' && (
                          <label className="block">
                            <span className="mb-1.5 block text-sm font-semibold text-navy">Home Area</span>
                            <div className="relative">
                              <Icon name="pin" className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-brand-500" />
                              <input list="areas" className="input h-11 pl-10" placeholder="e.g. Kepong, Kuala Lumpur" value={form.address} onChange={set('address')} />
                              <datalist id="areas">
                                {['Kepong, Kuala Lumpur', 'Mont Kiara, Kuala Lumpur', 'Damansara, Kuala Lumpur', 'Bangsar, Kuala Lumpur', 'Sri Petaling, Kuala Lumpur', 'Cheras, Kuala Lumpur', 'Petaling Jaya, Selangor', 'Subang Jaya, Selangor', 'Puchong, Selangor', 'Shah Alam, Selangor', 'Klang, Selangor', 'Banting, Selangor'].map((a) => <option key={a} value={a} />)}
                              </datalist>
                            </div>
                            <span className="mt-1 block text-xs text-slate-600">Optional. Pick your area so we can rank tutors by distance. Your exact address is only needed when you book a physical lesson.</span>
                          </label>
                        )}
                        <div className="md:col-span-2">
                          <PhotoUpload photo={photo} setPhoto={setPhoto} />
                        </div>
                      </div>
                    )}

                    {sec.id === 'children' && <Kids kids={kids} setKids={setKids} subjects={subjects} />}

                    {sec.id === 'preferences' && (
                      <div className="space-y-4">
                        <p className="text-sm text-slate-700">Optional. Tell us how you would like lessons to be. These help rank tutors for you and start your searches pre-filled. You can change them any time in <b>My Profile</b>.</p>
                        <PreferencesFields value={prefs} onChange={setPrefs} />
                      </div>
                    )}
                    {sec.id === active[active.length - 1].id && <div className="mt-4"><Recaptcha onToken={setCaptcha} /></div>}
                  </div>
                ))}
              </div>
            </div>

            {/* Fixed-height slot for the error: showing or clearing a message never changes the card height */}
            <div className="mt-3 h-12 overflow-hidden text-sm" aria-live="polite">
              {error && (
                <p role="alert" className="flex items-start gap-1.5 font-medium text-red-700">
                  <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" /> <span className="line-clamp-2">{error}</span>
                </p>
              )}
            </div>
            <button disabled={busy} className="btn-primary h-12 w-full text-base">
              {busy ? 'Creating account…' : idx < active.length - 1 ? 'Next' : 'Create Account'}
              {!busy && <Icon name="arrow-right" className="h-4 w-4" />}
            </button>
            {role === 'TUTOR' && (
              <p className="mt-3 text-center text-xs text-slate-500">
                Teaching information, qualifications and portfolio are added in your Tutor Portal after your email is verified.
              </p>
            )}
          </form>
        </div>
      )}

      {step === 2 && (
        <form onSubmit={submitOtp} className="mx-auto mt-8 max-w-md space-y-4 rounded-2xl border border-brand-100 bg-white p-8 text-center shadow-card">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500"><Icon name="mail" className="h-7 w-7" /></span>
          <h1 className="font-display text-2xl font-bold text-navy">Verify your email</h1>
          <p className="text-sm text-slate-500">We sent a 6-digit code to <b className="text-navy">{form.email}</b>.</p>
          <ErrorBox className="text-left">{error}</ErrorBox>
          <input required maxLength={6} inputMode="numeric" autoFocus className="input h-14 text-center text-2xl tracking-[0.6em]"
            value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
          <button disabled={busy || otp.length < 6} className="btn-primary h-12 w-full text-base">{busy ? 'Verifying…' : 'Verify & Continue'}</button>
          <button type="button" onClick={resendOtp} className="text-sm font-semibold text-brand-500 hover:underline">Resend code</button>
        </form>
      )}
    </div>
    </section>
  )
}

function Stepper({ step }) {
  return (
    <ol className="mx-auto flex max-w-md items-start justify-between">
      {STEPS.map((s, i) => (
        <li key={s} className="relative flex flex-1 flex-col items-center">
          {i > 0 && <span className={`absolute right-1/2 top-[15px] h-0.5 w-full ${i <= step ? 'bg-brand-500' : 'bg-brand-200'}`} />}
          <span className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
            i < step ? 'bg-brand-500 text-white' : i === step ? 'bg-brand-500 text-white ring-4 ring-brand-100' : 'border-2 border-brand-200 bg-white text-slate-400'
          }`}>
            {i < step ? <Icon name="check" className="h-4 w-4" strokeWidth={3} /> : i + 1}
          </span>
          <span className={`mt-1 text-xs ${i === step ? 'font-bold text-navy' : 'text-slate-500'}`}>{s}</span>
        </li>
      ))}
    </ol>
  )
}

function RoleCard({ active, onClick, title, desc, points, img, tone }) {
  const blue = tone === 'blue'
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`relative flex flex-col overflow-hidden rounded-2xl border-2 p-3 text-left transition ${
        active ? (blue ? 'border-brand-500 bg-white shadow-lg' : 'border-accent bg-accent-50 shadow-lg') : 'border-white bg-white shadow-card hover:border-brand-100'
      }`}
    >
      <span className={`absolute right-5 top-5 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white ${active ? (blue ? 'border-brand-500' : 'border-accent') : 'border-slate-300'}`} aria-hidden="true">
        {active && <span className={`h-3.5 w-3.5 rounded-full ${blue ? 'bg-brand-500' : 'bg-accent'}`} />}
      </span>
      {/* Same shape for both pictures at every width (not a fixed height), cropped toward the top so the faces stay in frame */}
      <img src={img} alt="" aria-hidden="true" className="aspect-[2/1] w-full rounded-xl object-cover object-[center_30%]" />
      <div className="px-3 pb-3 pt-4">
        <div className="text-center font-display text-xl font-bold text-navy">{title}</div>
        <div className="mb-3 text-center text-sm text-slate-700">{desc}</div>
        <ul className="mx-auto w-fit space-y-2 text-sm text-navy">
          {points.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-white ${blue ? 'bg-brand-500' : 'bg-accent-600'}`}>
                <Icon name="check" className="h-3 w-3" strokeWidth={3.5} />
              </span>
              {p}
            </li>
          ))}
        </ul>
      </div>
    </button>
  )
}

function Input({ label, required, ...rest }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-navy">{label} {required && <span className="text-red-500">*</span>}</span>
      <input className="input h-11" {...rest} />
    </label>
  )
}

function Phone({ label, required, value, onChange }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-navy">{label} {required && <span className="text-red-500">*</span>}</span>
      <div className="flex gap-2">
        <span className="flex h-11 w-24 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-sm font-medium text-navy">
          <span className="rounded bg-brand-50 px-1 text-[10px] font-bold text-brand-500">MY</span> +60
        </span>
        <input className="input h-11" inputMode="tel" placeholder="e.g. 12 345 6789" value={value} onChange={onChange} />
      </div>
    </label>
  )
}

// Preview only for now: photo storage (Cloudinary) is wired in a later milestone
function PhotoUpload({ photo, setPhoto }) {
  const ref = useRef(null)
  return (
    <div>
      <span className="mb-1.5 block text-sm font-semibold text-navy">Profile Photo</span>
      <div className="flex items-center gap-4 rounded-xl border border-dashed border-brand-200 bg-white p-4">
        {photo ? (
          <img src={photo} alt="" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500"><Icon name="camera" className="h-6 w-6" /></span>
        )}
        <div>
          <button type="button" onClick={() => ref.current?.click()} className="text-sm font-bold text-brand-500 hover:underline">Upload Photo</button>
          <div className="text-xs text-slate-500">JPG, PNG (Max 5MB) · saved to your profile once photo storage is connected</div>
        </div>
        <input
          ref={ref} type="file" accept="image/png,image/jpeg" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f && f.size <= 5 * 1024 * 1024) setPhoto(URL.createObjectURL(f))
          }}
        />
      </div>
    </div>
  )
}

function Kids({ kids, setKids, subjects }) {
  const update = (i, patch) => setKids(kids.map((k, j) => (j === i ? { ...k, ...patch } : k)))
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-700">
        Optional now, but add at least one child to get tutor matches straight away. You can add or edit children later under <b>My Children</b>.
      </p>
      {kids.map((k, i) => (
        <div key={i} className="grid gap-3 rounded-xl bg-white p-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-start">
          <Input label="Child's Name" required value={k.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="e.g. Sarah" />
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-navy">Education Level <span className="text-red-600">*</span></span>
            <select className="input h-11" value={k.level ? `${k.level}:${k.grade}` : ''} onChange={(e) => { const g = parseGrade(e.target.value); update(i, g.level ? { level: g.level, grade: g.grade } : {}) }}>
              <option value="">Select…</option>
              {GRADE_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>{g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-navy">Subject needed <span className="text-red-600">*</span></span>
            <select className="input h-11" value={k.subject || ''} onChange={(e) => update(i, { subject: e.target.value })}>
              <option value="">Select…</option>
              {subjects.map((sub) => <option key={sub}>{sub}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => setKids(kids.filter((_, j) => j !== i))} className="flex h-11 w-11 items-center justify-center self-end rounded-lg text-red-600 hover:bg-red-50" aria-label={`Remove ${k.name || 'this child'}`}>
            <Icon name="trash" className="h-5 w-5" />
          </button>
          <label className="block md:col-span-4">
            <span className="mb-1.5 block text-sm font-semibold text-navy">Learning needs or goals <span className="font-normal text-slate-600">(optional)</span></span>
            <input className="input h-11" maxLength={500} value={k.notes || ''} onChange={(e) => update(i, { notes: e.target.value })} placeholder="e.g. Wants to improve exam scores, needs help with fractions" />
          </label>
        </div>
      ))}
      {kids.length < 5 && (
        <button type="button" onClick={() => setKids([...kids, { name: '', level: '', grade: null, subject: '', notes: '' }])} className="btn-outline min-h-11">
          <Icon name="plus" className="h-4 w-4" /> Add a child
        </button>
      )}
    </div>
  )
}
