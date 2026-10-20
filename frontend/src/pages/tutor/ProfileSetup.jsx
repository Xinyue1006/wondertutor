import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import PhotoPicker, { uploadDocument, uploadError } from '../../components/PhotoPicker'
import Icon from '../../components/ui/Icon'
import { ErrorBox, LoadError, Spinner } from '../../components/ui/Common'
import { LEVELS, gradeLabel } from '../../lib/education'
import { isOwnUpload, normalizePhone } from '../../lib/validation'
import { SETUP_STEPS, checkStep } from '../../lib/tutorSetup'

// Tutor profile setup (mockup 06), step 4 of sign-up. Five steps, each saved to the server as a draft
// (PUT /tutor/profile), so a tutor can leave and come back. Submitting sends it to Admin for verification.

const GENDERS = [['MALE', 'Male'], ['FEMALE', 'Female'], ['UNSPECIFIED', 'Prefer not to say']]
const DOC_KINDS = [['IDENTITY', 'NRIC or passport'], ['QUALIFICATION', 'Qualification (degree, diploma, certificate)']]
const DOC_STATUS = {
  PENDING: ['Waiting for Admin', 'bg-accent-100 text-amber-900'],
  APPROVED: ['Approved', 'bg-ok-50 text-green-800'],
  REJECTED: ['Rejected', 'bg-red-50 text-red-700'],
}

// The form keeps text inputs as strings; the server gets numbers and +60 phone numbers
function toForm(p) {
  return {
    fullName: p.fullName || '',
    phone: p.phone || '',
    gender: p.gender || '',
    emergencyContactName: p.emergencyContactName || '',
    emergencyContactPhone: p.emergencyContactPhone || '',
    location: p.location || '',
    subjects: p.subjects.length ? p.subjects : [],
    hourlyRate: p.hourlyRate ? String(p.hourlyRate) : '',
    yearsExperience: String(p.yearsExperience ?? 0),
    offersPhysical: p.offersPhysical,
    offersOnline: p.offersOnline,
    languages: p.languages,
    characteristics: p.characteristics,
    bio: p.bio || '',
    teachingApproach: p.teachingApproach || '',
  }
}

// What each step sends: only its own fields, so a step never overwrites another one
function payloadFor(id, f) {
  if (id === 'basic')
    return {
      fullName: f.fullName.trim(), phone: normalizePhone(f.phone), gender: f.gender,
      emergencyContactName: f.emergencyContactName.trim(), emergencyContactPhone: normalizePhone(f.emergencyContactPhone), location: f.location,
    }
  if (id === 'teaching')
    return {
      subjects: f.subjects, hourlyRate: Number(f.hourlyRate), yearsExperience: Number(f.yearsExperience),
      offersPhysical: f.offersPhysical, offersOnline: f.offersOnline, languages: f.languages, characteristics: f.characteristics,
      bio: f.bio.trim(), teachingApproach: f.teachingApproach.trim(),
    }
  return null
}

export default function ProfileSetup() {
  const navigate = useNavigate()
  const { user, setUser } = useAuth()
  const [profile, setProfile] = useState(null)
  const [catalog, setCatalog] = useState(null)
  const [form, setForm] = useState(null)
  // "Re-upload document" on the status page opens the documents step directly
  const { state } = useLocation()
  const [step, setStep] = useState(SETUP_STEPS.some((s) => s.id === state?.step) ? state.step : 'basic')
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const heading = useRef(null)

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const [p, c] = await Promise.all([api.get('/tutor/profile'), api.get('/tutor/catalog')])
      setProfile(p.data)
      setForm(toForm(p.data))
      setCatalog(c.data)
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [])
  useEffect(() => { load() }, [load])

  // Keyboard and screen-reader users start each step at its heading
  useEffect(() => { heading.current?.focus() }, [step])

  if (loadError) return <LoadError message={loadError} onRetry={load} />
  if (!profile || !form || !catalog) return <Spinner />

  const submitted = profile.status !== 'NOT_SUBMITTED'
  const idx = SETUP_STEPS.findIndex((s) => s.id === step)
  const done = (id) => id !== 'review' && !checkStep(id, form, profile)
  const progress = Math.round((SETUP_STEPS.filter((s) => done(s.id)).length / (SETUP_STEPS.length - 1)) * 100)
  const update = (patch) => setForm((f) => ({ ...f, ...patch }))

  async function save(id = step) {
    const body = payloadFor(id, form)
    if (!body) return true
    const res = await api.put('/tutor/profile', body)
    setProfile(res.data)
    setSavedAt(new Date())
    return true
  }

  async function saveAndContinue(e) {
    e.preventDefault()
    const problem = checkStep(step, form, profile)
    if (problem) return setError(problem)
    setError('')
    setBusy(true)
    try {
      await save()
      // A changed name or photo also shows in the header
      setUser((u) => ({ ...u, fullName: form.fullName.trim() }))
      if (idx < SETUP_STEPS.length - 1) setStep(SETUP_STEPS[idx + 1].id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  // Keeps whatever is valid so far: a half-finished step is not saved, but nothing already saved is lost
  async function saveAndExit() {
    setError('')
    setBusy(true)
    try {
      if (!checkStep(step, form, profile)) await save()
      navigate('/tutor/verification')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function submit() {
    for (const s of SETUP_STEPS.slice(0, -1)) {
      const problem = checkStep(s.id, form, profile)
      if (problem) {
        setStep(s.id)
        return setError(problem)
      }
    }
    setError('')
    setBusy(true)
    try {
      const res = await api.post('/tutor/submit-for-verification')
      setProfile(res.data)
      setUser((u) => ({ ...u, tutorStatus: res.data.status }))
      navigate('/tutor/verification')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const goTo = (id) => {
    setError('')
    setStep(id)
  }

  return (
    <div className="mx-auto max-w-[72rem] py-2">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-navy">{submitted ? 'Edit your tutor profile' : 'Set up your tutor profile'}</h1>
          <p className="mt-1 text-slate-600">Parents only see you after Admin approves your documents. Your progress is saved as you go.</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${submitted ? 'bg-brand-50 text-brand-700' : 'bg-accent-100 text-amber-900'}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> {submitted ? 'Submitted for review' : 'Profile not submitted'}
          </span>
          <button type="button" onClick={saveAndExit} disabled={busy} className="btn-outline min-h-11 px-4">Save and exit</button>
        </div>
      </div>
      <div className="mb-5 max-w-xs">
        <div className="flex justify-between text-xs font-semibold text-navy"><span>Progress</span><span>{progress}%</span></div>
        <div className="mt-1 h-2 rounded-full bg-brand-100" role="progressbar" aria-label="Setup progress" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-2 rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-[17rem_1fr]">
        <nav aria-label="Setup steps" className="card h-fit p-3">
          <ol className="space-y-1">
            {SETUP_STEPS.map((s, i) => (
              <li key={s.id}>
                <button type="button" onClick={() => goTo(s.id)} aria-current={step === s.id ? 'step' : undefined}
                  className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold ${step === s.id ? 'bg-brand-50 text-brand-700' : 'text-navy hover:bg-brand-25'}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${done(s.id) ? 'bg-ok text-white' : step === s.id ? 'bg-brand-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {done(s.id) ? <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  {s.label}
                  {done(s.id) && <span className="sr-only">(complete)</span>}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <form onSubmit={saveAndContinue} noValidate className="card p-6 md:p-8">
          <h2 ref={heading} tabIndex={-1} className="font-display text-xl font-bold text-navy outline-none">{SETUP_STEPS[idx].label}</h2>

          {step === 'basic' && <BasicStep form={form} update={update} profile={profile} catalog={catalog} />}
          {step === 'teaching' && <TeachingStep form={form} update={update} catalog={catalog} />}
          {step === 'documents' && <DocumentsStep profile={profile} setProfile={setProfile} onStatus={(s) => setUser((u) => ({ ...u, tutorStatus: s }))} />}
          {step === 'photo' && <PhotoStep profile={profile} setProfile={setProfile} name={form.fullName} />}
          {step === 'review' && <ReviewStep profile={profile} submitted={submitted} confirmed={confirmed} setConfirmed={setConfirmed} goTo={goTo} />}

          <ErrorBox className="mt-5">{error}</ErrorBox>
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-brand-100 pt-5">
            <button type="button" disabled={idx === 0 || busy} onClick={() => goTo(SETUP_STEPS[idx - 1].id)} className="btn-outline min-h-11 px-5">Back</button>
            <span className="text-xs text-slate-500" aria-live="polite">{savedAt ? 'Draft saved just now' : ''}</span>
            {step !== 'review' ? (
              <button disabled={busy} className="btn-primary ml-auto min-h-11 px-6">{busy ? 'Saving…' : 'Save and continue'}</button>
            ) : submitted ? (
              <button type="button" onClick={() => navigate('/tutor/verification')} className="btn-primary ml-auto min-h-11 px-6">Back to verification status</button>
            ) : (
              <button type="button" onClick={submit} disabled={busy || !confirmed} className="btn-primary ml-auto min-h-11 px-6">
                {busy ? 'Submitting…' : 'Submit for verification'}
              </button>
            )}
          </div>
        </form>
      </div>
      {user?.tutorStatus === 'VERIFIED' && <p className="mt-4 text-sm text-slate-600">Your profile is verified. Changes you save here show on your public profile straight away.</p>}
    </div>
  )
}

function Text({ label, required, hint, ...rest }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-navy">{label} {required && <span className="text-red-600" aria-hidden="true">*</span>}</span>
      <input className="input h-11" required={required} {...rest} />
      {hint && <span className="mt-1 block text-xs text-slate-600">{hint}</span>}
    </label>
  )
}

function BasicStep({ form, update, profile, catalog }) {
  const set = (k) => (e) => update({ [k]: e.target.value })
  return (
    <div className="mt-1">
      <p className="mb-5 text-sm text-slate-600">Used on your profile and for Admin to contact you.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <Text label="Full name (as on IC)" required value={form.fullName} onChange={set('fullName')} autoComplete="name" />
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold text-navy">Email address</span>
          <span className="flex items-center gap-2">
            <input className="input h-11 bg-slate-50" value={profile.email} readOnly aria-readonly="true" />
            {profile.isEmailVerified && <span className="shrink-0 rounded-full bg-ok-50 px-2.5 py-1 text-xs font-semibold text-green-800">Verified</span>}
          </span>
        </label>
        <Text label="Phone number" required inputMode="tel" placeholder="e.g. 012-345 6789" value={form.phone} onChange={set('phone')} autoComplete="tel" />
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold text-navy">Gender <span className="text-red-600" aria-hidden="true">*</span></legend>
          <div className="flex flex-wrap gap-x-5">
            {GENDERS.map(([v, l]) => (
              <label key={v} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-navy">
                <input type="radio" name="gender" className="h-4 w-4 accent-brand-500" checked={form.gender === v} onChange={() => update({ gender: v })} /> {l}
              </label>
            ))}
          </div>
        </fieldset>
        <Text label="Emergency contact name" required placeholder="e.g. Lisa Tan" value={form.emergencyContactName} onChange={set('emergencyContactName')} />
        <Text label="Emergency contact number" required inputMode="tel" placeholder="e.g. 012-000 0000" value={form.emergencyContactPhone} onChange={set('emergencyContactPhone')} />
        <label className="block md:col-span-2">
          <span className="mb-1.5 block text-sm font-semibold text-navy">Home area <span className="text-red-600" aria-hidden="true">*</span></span>
          <select className="input h-11" value={form.location} onChange={set('location')}>
            <option value="">Choose your area…</option>
            {catalog.locations.map((l) => <option key={l}>{l}</option>)}
          </select>
          <span className="mt-1 block text-xs text-slate-600">Only the area is shown to parents, never your full address. Your emergency contact is never shown.</span>
        </label>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange, children }) {
  return (
    <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${checked ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-200 text-navy'}`}>
      <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}
    </label>
  )
}

function TeachingStep({ form, update, catalog }) {
  const setRow = (i, patch) => update({ subjects: form.subjects.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const toggleIn = (key, value, on) => update({ [key]: on ? [...form[key], value] : form[key].filter((x) => x !== value) })
  return (
    <div className="mt-4 space-y-6">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-navy">Subjects you teach <span className="text-red-600" aria-hidden="true">*</span></legend>
        <div className="space-y-3">
          {form.subjects.map((s, i) => {
            const max = catalog.maxGrade[s.educationLevel] || 6
            const grades = Array.from({ length: max }, (_, g) => g + 1)
            return (
              <div key={i} className="grid gap-2 rounded-xl bg-brand-25 p-3 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto] sm:items-end">
                <label className="block text-xs font-semibold text-navy">Subject
                  <select className="input mt-1 h-11" value={s.subject} onChange={(e) => setRow(i, { subject: e.target.value })}>
                    <option value="">Choose…</option>
                    {catalog.subjects.map((x) => <option key={x}>{x}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-navy">Level
                  <select className="input mt-1 h-11" value={s.educationLevel}
                    onChange={(e) => setRow(i, { educationLevel: e.target.value, minGrade: 1, maxGrade: catalog.maxGrade[e.target.value] })}>
                    {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.value === 'SECONDARY' ? 'Secondary (Form)' : l.label}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-navy">From
                  <select className="input mt-1 h-11" value={s.minGrade} onChange={(e) => setRow(i, { minGrade: Number(e.target.value) })}>
                    {grades.map((g) => <option key={g} value={g}>{gradeLabel(s.educationLevel, g)}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-navy">To
                  <select className="input mt-1 h-11" value={s.maxGrade} onChange={(e) => setRow(i, { maxGrade: Number(e.target.value) })}>
                    {grades.map((g) => <option key={g} value={g}>{gradeLabel(s.educationLevel, g)}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => update({ subjects: form.subjects.filter((_, j) => j !== i) })}
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-red-600 hover:bg-red-50" aria-label={`Remove ${s.subject || 'this subject'}`}>
                  <Icon name="trash" className="h-5 w-5" />
                </button>
              </div>
            )
          })}
        </div>
        {form.subjects.length < 12 && (
          <button type="button" className="btn-outline mt-3 min-h-11"
            onClick={() => update({ subjects: [...form.subjects, { subject: '', educationLevel: 'PRIMARY', minGrade: 1, maxGrade: 6 }] })}>
            <Icon name="plus" className="h-4 w-4" /> Add a subject
          </button>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Text label="Hourly rate (RM)" required inputMode="decimal" placeholder="e.g. 60" value={form.hourlyRate} onChange={(e) => update({ hourlyRate: e.target.value })}
          hint="What you ask per hour. Parents may counter-offer when they book." />
        <Text label="Years of tutoring experience" required inputMode="numeric" value={form.yearsExperience} onChange={(e) => update({ yearsExperience: e.target.value })} />
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-navy">Teaching mode <span className="text-red-600" aria-hidden="true">*</span></legend>
        <div className="flex flex-wrap gap-2">
          <Toggle checked={form.offersPhysical} onChange={(v) => update({ offersPhysical: v })}>Physical (at the student's home)</Toggle>
          <Toggle checked={form.offersOnline} onChange={(v) => update({ offersOnline: v })}>Online (you share a meeting link)</Toggle>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-navy">Languages you teach in</legend>
        <div className="flex flex-wrap gap-2">
          {catalog.languages.map((l) => <Toggle key={l} checked={form.languages.includes(l)} onChange={(on) => toggleIn('languages', l, on)}>{l}</Toggle>)}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-navy">Your teaching style</legend>
        <div className="flex flex-wrap gap-2">
          {catalog.characteristics.map((c) => <Toggle key={c} checked={form.characteristics.includes(c)} onChange={(on) => toggleIn('characteristics', c, on)}>{c}</Toggle>)}
        </div>
        <p className="mt-1 text-xs text-slate-600">Used when parents search for a teaching style.</p>
      </fieldset>

      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-navy">About me <span className="text-red-600" aria-hidden="true">*</span></span>
        <textarea className="input min-h-28 py-2" maxLength={2000} value={form.bio} onChange={(e) => update({ bio: e.target.value })}
          placeholder="e.g. Mathematics tutor with four years of experience helping Form 1-5 students build confidence through step-by-step problem solving." />
        <span className="mt-1 block text-xs text-slate-600">At least 30 characters. Shown at the top of your profile.</span>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-navy">Teaching approach <span className="font-normal text-slate-600">(optional)</span></span>
        <textarea className="input min-h-24 py-2" maxLength={2000} value={form.teachingApproach} onChange={(e) => update({ teachingApproach: e.target.value })}
          placeholder="One point per line, e.g. Weekly practice papers" />
      </label>
    </div>
  )
}

function DocumentsStep({ profile, setProfile, onStatus }) {
  const [doc, setDoc] = useState({ kind: 'IDENTITY', title: '', institution: '', year: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)

  async function add() {
    setError('')
    if (doc.title.trim().length < 2) return setError('Enter the document name, e.g. "NRIC" or "BSc Mathematics".')
    if (doc.year && !/^\d{4}$/.test(doc.year)) return setError('Enter the year as 4 digits, e.g. 2020.')
    if (!file) return setError('Choose the file to upload.')
    setBusy(true)
    try {
      const documentUrl = await uploadDocument(file)
      await api.post('/tutor/documents', {
        kind: doc.kind, title: doc.title.trim(), documentUrl,
        institution: doc.institution.trim() || null, year: doc.year ? Number(doc.year) : null,
      })
      setProfile((await api.get('/tutor/profile')).data)
      setDoc({ kind: doc.kind, title: '', institution: '', year: '' })
      setFile(null)
    } catch (err) {
      setError(uploadError(err))
    } finally {
      setBusy(false)
    }
  }

  async function remove(d) {
    setError('')
    // Removing an approved document takes the verified badge away until Admin approves a replacement
    if (d.status === 'APPROVED' && !window.confirm(`"${d.title}" is approved. If you remove it, your verified badge is put on hold until Admin approves a replacement. Remove it?`)) return
    try {
      await api.delete(`/tutor/documents/${d.id}`)
      const fresh = (await api.get('/tutor/profile')).data
      setProfile(fresh)
      // Keeps the menu and the page gate in step if the badge was just lost
      onStatus(fresh.status)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="mt-1">
      <p className="mb-5 text-sm text-slate-600">Admin checks one identity document (NRIC or passport) and at least one qualification before you are verified. Only Admin sees your identity document.</p>
      {profile.documents.length > 0 && (
        <ul className="mb-5 space-y-2">
          {profile.documents.map((d) => {
            const [label, cls] = DOC_STATUS[d.status]
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-100 p-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><Icon name="file" className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <a href={d.documentUrl} target="_blank" rel="noreferrer" className="block truncate font-semibold text-navy hover:underline">{d.title}</a>
                  <span className="text-xs text-slate-600">{d.kind === 'IDENTITY' ? 'Identity document' : [d.institution, d.year].filter(Boolean).join(' · ') || 'Qualification'}</span>
                  {d.status === 'REJECTED' && d.reviewNote && <span className="block text-xs text-red-700">Admin: {d.reviewNote}</span>}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{label}</span>
                <button type="button" onClick={() => remove(d)} className="flex h-11 w-11 items-center justify-center rounded-lg text-red-600 hover:bg-red-50" aria-label={`Remove ${d.title}`}>
                  <Icon name="trash" className="h-5 w-5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <fieldset className="rounded-xl border border-dashed border-brand-200 p-4">
        <legend className="px-1 text-sm font-semibold text-navy">Add a document</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-navy">Type
            <select className="input mt-1 h-11" value={doc.kind} onChange={(e) => setDoc({ ...doc, kind: e.target.value })}>
              {DOC_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <Text label="Document name" placeholder={doc.kind === 'IDENTITY' ? 'e.g. NRIC' : 'e.g. BSc Mathematics'} value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })} />
          {doc.kind === 'QUALIFICATION' && (
            <>
              <Text label="Institution (optional)" value={doc.institution} onChange={(e) => setDoc({ ...doc, institution: e.target.value })} />
              <Text label="Year (optional)" inputMode="numeric" maxLength={4} value={doc.year} onChange={(e) => setDoc({ ...doc, year: e.target.value.replace(/\D/g, '') })} />
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => input.current?.click()} className="btn-outline min-h-11"><Icon name="file" className="h-4 w-4" /> {file ? 'Change file' : 'Choose file'}</button>
          <span className="text-sm text-slate-600">{file ? file.name : 'PDF, JPG or PNG, up to 10MB'}</span>
          <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = '' }} />
          <button type="button" onClick={add} disabled={busy} className="btn-primary ml-auto min-h-11 px-5">{busy ? 'Uploading…' : 'Upload'}</button>
        </div>
        <ErrorBox className="mt-3">{error}</ErrorBox>
      </fieldset>
    </div>
  )
}

function PhotoStep({ profile, setProfile, name }) {
  const [error, setError] = useState('')
  const [item, setItem] = useState({ title: '', description: '' })
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const input = useRef(null)

  async function setPhoto(url) {
    setError('')
    try {
      setProfile((await api.put('/tutor/profile', { profilePhotoUrl: url })).data)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function addItem() {
    setError('')
    if (item.title.trim().length < 2) return setError('Enter a title for the portfolio item.')
    if (!file) return setError('Choose a file for the portfolio item.')
    setBusy(true)
    try {
      const fileUrl = await uploadDocument(file)
      await api.post('/tutor/portfolio', { title: item.title.trim(), description: item.description.trim() || null, fileUrl })
      setProfile((await api.get('/tutor/profile')).data)
      setItem({ title: '', description: '' })
      setFile(null)
    } catch (err) {
      setError(uploadError(err))
    } finally {
      setBusy(false)
    }
  }

  async function removeItem(p) {
    try {
      await api.delete(`/tutor/portfolio/${p.id}`)
      setProfile((await api.get('/tutor/profile')).data)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div className="mt-4 space-y-6">
      <div>
        <h3 className="mb-1 text-sm font-semibold text-navy">Profile photo <span className="text-red-600" aria-hidden="true">*</span></h3>
        <p className="mb-3 text-xs text-slate-600">Required. A clear photo of your face helps parents recognise you at the first lesson.</p>
        <PhotoPicker value={profile.profilePhotoUrl} name={name} onChange={setPhoto} />
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold text-navy">Portfolio <span className="font-normal text-slate-600">(optional)</span></h3>
        <p className="mb-3 text-xs text-slate-600">Results, sample materials or anything that shows your teaching.</p>
        {profile.portfolio.length > 0 && (
          <ul className="mb-3 space-y-2">
            {profile.portfolio.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-xl border border-brand-100 p-3">
                <span className="min-w-0 flex-1">
                  <a href={p.fileUrl} target="_blank" rel="noreferrer" className="block truncate font-semibold text-navy hover:underline">{p.title}</a>
                  {p.description && <span className="text-xs text-slate-600">{p.description}</span>}
                </span>
                <button type="button" onClick={() => removeItem(p)} className="flex h-11 w-11 items-center justify-center rounded-lg text-red-600 hover:bg-red-50" aria-label={`Remove ${p.title}`}>
                  <Icon name="trash" className="h-5 w-5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 rounded-xl border border-dashed border-brand-200 p-4 sm:grid-cols-2">
          <Text label="Title" placeholder="e.g. SPM Add Maths results 2025" value={item.title} onChange={(e) => setItem({ ...item, title: e.target.value })} />
          <Text label="Short description (optional)" value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="button" onClick={() => input.current?.click()} className="btn-outline min-h-11"><Icon name="file" className="h-4 w-4" /> {file ? 'Change file' : 'Choose file'}</button>
            <span className="text-sm text-slate-600">{file ? file.name : 'PDF, JPG or PNG, up to 10MB'}</span>
            <input ref={input} type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] || null); e.target.value = '' }} />
            <button type="button" onClick={addItem} disabled={busy} className="btn-primary ml-auto min-h-11 px-5">{busy ? 'Uploading…' : 'Add'}</button>
          </div>
        </div>
      </div>
      <ErrorBox>{error}</ErrorBox>
    </div>
  )
}

function ReviewStep({ profile, submitted, confirmed, setConfirmed, goTo }) {
  const subjects = [...new Set(profile.subjects.map((s) => s.subject))].join(', ') || 'None yet'
  const rows = [
    ['basic', 'Name', profile.fullName],
    ['basic', 'Phone', profile.phone || 'Missing'],
    ['basic', 'Home area', profile.location || 'Missing'],
    ['teaching', 'Subjects', subjects],
    ['teaching', 'Hourly rate', profile.hourlyRate ? `RM ${profile.hourlyRate.toFixed(2)}` : 'Missing'],
    ['teaching', 'Teaching mode', [profile.offersPhysical && 'Physical', profile.offersOnline && 'Online'].filter(Boolean).join(' and ') || 'Missing'],
    ['documents', 'Documents', `${profile.documents.filter((d) => d.status !== 'REJECTED').length} uploaded`],
    ['photo', 'Profile photo', isOwnUpload(profile.profilePhotoUrl) ? 'Uploaded' : 'Missing'],
  ]
  return (
    <div className="mt-4 space-y-5">
      <dl className="divide-y divide-brand-100 rounded-xl border border-brand-100">
        {rows.map(([step, label, value]) => (
          <div key={label} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
            <dt className="w-36 font-semibold text-navy">{label}</dt>
            <dd className="min-w-0 flex-1 text-slate-700">{value}</dd>
            <button type="button" onClick={() => goTo(step)} className="min-h-11 text-xs font-semibold text-brand-600 hover:underline">Edit<span className="sr-only"> {label}</span></button>
          </div>
        ))}
      </dl>
      {profile.missing.length > 0 && (
        <div role="status" className="rounded-xl bg-accent-50 p-4 text-sm text-amber-900">
          <b>Still needed before you can submit:</b>
          <ul className="mt-1 list-inside list-disc">{profile.missing.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      )}
      {submitted ? (
        <p className="rounded-xl bg-brand-50 p-4 text-sm text-navy">Your profile was submitted for review. Saved changes apply straight away; new documents go to Admin automatically.</p>
      ) : (
        <label className="flex min-h-11 cursor-pointer items-start gap-2 text-sm text-navy">
          <input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I confirm the information is true and the documents are my own. I understand Admin will check them before my profile goes live.
        </label>
      )}
    </div>
  )
}
