import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { errorMessage } from '../../api/client'
import { useMatching } from '../../assistant/MatchingContext'
import Icon from '../../components/ui/Icon'
import Robot from '../../components/ui/Robot'
import { ErrorBox, LoadError, PageTitle, SelectBox, Spinner } from '../../components/ui/Common'
import { CHARACTERISTICS, GRADE_GROUPS, gradeLabel, parseGrade } from '../../lib/education'
import { DAY_SHORT } from '../../lib/format'
import { TIME_PRESETS, defaultRange, rangeKey, rangeLabel } from '../../lib/times'

const STEPS = ['Learning Needs', 'Schedule & Location', 'Preferences']
const MIN_RATE = 20
const MAX_RATE = 150

// 3-step matching wizard: Learning Needs -> Schedule & Location -> Preferences -> Results
export default function MatchingWizard() {
  const navigate = useNavigate()
  const { catalog, kids, criteria: c, patchCriteria, applyChild, runMatching, setChatOpen, loadError, reloadShared } = useMatching()
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Start from the first child's level/subject so the parent only has to adjust, not retype
  useEffect(() => {
    if (kids.length && !c.childId && !c.subject && !c.level) applyChild(kids[0])
  }, [kids, c.childId, c.subject, c.level, applyChild])

  // Carry over what was typed in the landing-page search bar (subject / level / location), once
  useEffect(() => {
    if (!catalog) return
    let saved
    try { saved = JSON.parse(sessionStorage.getItem('wt-home-search') || 'null'); sessionStorage.removeItem('wt-home-search') } catch { saved = null }
    if (!saved) return
    const pick = (list, text) => list.find((x) => x.toLowerCase() === String(text || '').trim().toLowerCase())
    const level = { kindergarten: 'KINDERGARTEN', primary: 'PRIMARY', secondary: 'SECONDARY' }[String(saved.level || '').trim().toLowerCase()]
    const patch = {}
    const subject = pick(catalog.subjects, saved.subject)
    const location = pick(catalog.locations, saved.location)
    if (subject) patch.subject = subject
    if (level) Object.assign(patch, { level, grade: null, childId: null }) // the grade is chosen in the wizard; drop any child's old grade
    if (location) patch.location = location
    if (Object.keys(patch).length) patchCriteria(patch)
  }, [catalog, patchCriteria])

  if (!catalog) return loadError ? <LoadError message={loadError} onRetry={reloadShared} /> : <Spinner />

  function next() {
    if (step === 0 && (!c.subject || !c.level || (!c.grade && c.level !== 'KINDERGARTEN'))) return setError('Subject and education level are required to find eligible tutors.')
    setError('')
    setStep(step + 1)
  }

  async function find() {
    setBusy(true)
    setError('')
    try {
      await runMatching('WIZARD')
      navigate('/parent/find-tutor/results')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle title="Find the Right Tutor for Your Child" subtitle="Tell us what you're looking for and we'll recommend suitable tutors." />
        <div className="card flex max-w-md items-center gap-3 border-accent/30 bg-accent-50 p-3">
          <Robot className="h-16 w-16 shrink-0" />
          <div className="text-sm">
            <div className="font-bold text-navy">AI Tutor Assistant</div>
            <div className="text-slate-600">Prefer to tell us your needs naturally? You can chat with our AI assistant instead.</div>
            <button onClick={() => setChatOpen(true)} className="btn-accent mt-2 px-4 py-1.5 text-xs">Chat with AI <Icon name="arrow-right" className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>

      <Stepper step={step} />

      <section className="card mx-auto mt-4 max-w-[62.5rem] p-6 md:p-8">
        <ErrorBox className="mb-4">{error}</ErrorBox>
        {step === 0 && <StepLearning c={c} kids={kids} catalog={catalog} patch={patchCriteria} applyChild={applyChild} onNext={next} />}
        {step === 1 && <StepSchedule c={c} catalog={catalog} patch={patchCriteria} onBack={() => setStep(0)} onNext={next} />}
        {step === 2 && <StepPrefs c={c} patch={patchCriteria} onBack={() => setStep(1)} onFind={find} busy={busy} />}
      </section>
    </div>
  )
}

function Stepper({ step }) {
  return (
    <ol className="mx-auto my-6 flex max-w-[860px] items-start">
      {STEPS.map((s, i) => (
        <li key={s} className="relative flex flex-1 flex-col items-center">
          {i > 0 && <span className={`absolute right-1/2 top-[19px] h-0.5 w-full ${i <= step ? 'bg-brand-500' : 'bg-brand-200'}`} />}
          <span className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full text-base font-bold ${
            i <= step ? 'bg-brand-500 text-white' : 'border-2 border-brand-200 bg-white text-slate-400'
          } ${i === step ? 'ring-4 ring-brand-100' : ''}`}>
            {i < step ? <Icon name="check" className="h-5 w-5" strokeWidth={3} /> : i + 1}
          </span>
          <span className={`mt-1 text-xs ${i === step ? 'font-bold text-brand-500' : 'text-slate-500'}`}>{s}</span>
        </li>
      ))}
    </ol>
  )
}

function StepHeader({ icon, step, title, text, art }) {
  return (
    <div className="mb-6 flex items-start gap-4">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500"><Icon name={icon} className="h-8 w-8" strokeWidth={1.5} /></span>
      <div className="flex-1">
        <div className="text-sm text-slate-500">Step {step} of 3</div>
        <h2 className="text-3xl font-extrabold text-navy">{title}</h2>
        <p className="text-sm text-slate-500">{text}</p>
      </div>
      <div className="relative hidden h-20 w-32 shrink-0 sm:block">
        <Icon name={art} className="absolute inset-0 m-auto h-16 w-16 text-brand-200" strokeWidth={1.25} />
        <Icon name="sparkle" fill className="absolute right-2 top-0 h-5 w-5 text-accent" />
        <Icon name="sparkle" fill className="absolute left-4 top-6 h-3 w-3 text-accent" />
      </div>
    </div>
  )
}

function Label({ children, required }) {
  return <span className="mb-1.5 block text-sm font-bold text-navy">{children} {required && <span className="text-red-500">*</span>}</span>
}

// ───────────── Step 1: Learning Needs ─────────────
function StepLearning({ c, kids, catalog, patch, applyChild, onNext }) {
  const gradeValue = c.level ? `${c.level}:${c.grade ?? 1}` : ''
  return (
    <>
      <StepHeader icon="book" step={1} title="Learning Needs" text="Start with the two requirements needed to find eligible tutors." art="book" />
      {kids.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-navy">For:</span>
          {kids.map((k) => (
            <button key={k.id} type="button" onClick={() => applyChild(k)} className={`chip px-3 py-1.5 text-[13px] ${c.childId === k.id ? 'chip-on' : ''}`}>
              {k.name} · {gradeLabel(k.educationLevel, k.grade)}
            </button>
          ))}
          <button type="button" onClick={() => patch({ childId: null })} className={`chip px-3 py-1.5 text-[13px] ${!c.childId ? 'chip-on' : ''}`}>Someone else</button>
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block">
          <Label required>Subject</Label>
          <SelectBox icon="book" value={c.subject} onChange={(e) => patch({ subject: e.target.value })}>
            <option value="" disabled>Select a subject</option>
            {catalog.subjects.map((s) => <option key={s}>{s}</option>)}
          </SelectBox>
        </label>
        <label className="block">
          <Label required>Education Level</Label>
          <SelectBox icon="cap" value={gradeValue} onChange={(e) => { const g = parseGrade(e.target.value); patch({ level: g.level, grade: g.grade }) }}>
            <option value="" disabled>Select a level</option>
            {GRADE_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>{g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
            ))}
          </SelectBox>
        </label>
      </div>
      <div className="mt-5 flex items-center gap-2 rounded-lg bg-brand-50 px-4 py-3 text-sm text-slate-600">
        <Icon name="info" className="h-4 w-4 shrink-0 text-brand-500" /> Subject and education level are required to find suitable tutors.
      </div>
      <div className="mt-6 flex justify-end">
        <button onClick={onNext} className="btn-primary h-12 w-44 text-base">Next <Icon name="arrow-right" className="h-4 w-4" /></button>
      </div>
    </>
  )
}

// ───────────── Step 2: Schedule & Location ─────────────
function StepSchedule({ c, catalog, patch, onBack, onNext }) {
  const toggleDay = (d) => patch({ days: c.days.includes(d) ? c.days.filter((x) => x !== d) : [...c.days, d].sort() })
  const pickPreset = (p) => {
    if (c.timePreset === p) return patch({ timePreset: null, timeStart: null, timeEnd: null })
    const [s, e] = defaultRange(p)
    patch({ timePreset: p, timeStart: s, timeEnd: e })
  }
  const rangeValue = c.timeStart ? rangeKey(c.timeStart, c.timeEnd) : ''

  return (
    <>
      <StepHeader icon="calendar" step={2} title="Schedule & Location" text="Let us know when and where your child would like to have lessons." art="pin" />
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
        <div>
          <Label>Preferred Days</Label>
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <button key={d} type="button" onClick={() => toggleDay(d)} className={`chip py-2.5 ${c.days.includes(d) ? 'chip-on' : ''}`}>
                {c.days.includes(d) && <Icon name="check-circle" className="h-4 w-4" />} {DAY_SHORT[d]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Preferred Time</Label>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(TIME_PRESETS).map(([k, p]) => (
              <button key={k} type="button" onClick={() => pickPreset(k)} className={`chip py-2.5 ${c.timePreset === k ? 'chip-on' : ''}`}>
                {c.timePreset === k && <Icon name="check-circle" className="h-4 w-4" />} {p.label}
              </button>
            ))}
          </div>
          <SelectBox
            icon="clock" className="mt-3" value={rangeValue}
            onChange={(e) => {
              const [s, en] = e.target.value.split('-')
              patch({ timeStart: s, timeEnd: en, timePreset: Object.keys(TIME_PRESETS).find((k) => TIME_PRESETS[k].ranges.some(([a, b]) => a === s && b === en)) || c.timePreset })
            }}
          >
            <option value="">Any time</option>
            {Object.entries(TIME_PRESETS).map(([k, p]) => (
              <optgroup key={k} label={p.label}>{p.ranges.map(([s, e]) => <option key={rangeKey(s, e)} value={rangeKey(s, e)}>{rangeLabel(s, e)}</option>)}</optgroup>
            ))}
          </SelectBox>
        </div>

        <div>
          <Label>Teaching Mode</Label>
          <div className="grid grid-cols-3 gap-2">
            {[['ONLINE', 'Online'], ['PHYSICAL', 'Physical'], ['EITHER', 'Either']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => patch({ mode: v })} className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${c.mode === v ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-slate-200 bg-white text-slate-600'}`}>
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${c.mode === v ? 'border-brand-500' : 'border-slate-300'}`}>{c.mode === v && <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />}</span>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Preferred Location</Label>
          <div className="relative">
            <SelectBox icon="pin" value={c.location} onChange={(e) => patch({ location: e.target.value })} disabled={c.mode === 'ONLINE'}>
              <option value="">Any location</option>
              {catalog.locations.map((l) => <option key={l}>{l}</option>)}
            </SelectBox>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">{c.mode === 'ONLINE' ? 'Not needed for online lessons.' : 'Used to match tutors who can teach within your preferred area.'}</p>
        </div>
      </div>
      <div className="mt-8 flex items-center justify-between">
        <button onClick={onBack} className="btn-outline h-12 px-6"><Icon name="arrow-left" className="h-4 w-4" /> Back</button>
        <button onClick={onNext} className="btn-primary h-12 w-44 text-base">Next <Icon name="arrow-right" className="h-4 w-4" /></button>
      </div>
    </>
  )
}

// ───────────── Step 3: Preferences ─────────────
function StepPrefs({ c, patch, onBack, onFind, busy }) {
  const lo = c.budgetMin ?? MIN_RATE
  const hi = c.budgetMax ?? MAX_RATE
  const setBudget = (a, b) => (a <= MIN_RATE && b >= MAX_RATE ? patch({ budgetMin: null, budgetMax: null }) : patch({ budgetMin: a, budgetMax: b }))
  const pct = (v) => ((v - MIN_RATE) / (MAX_RATE - MIN_RATE)) * 100

  return (
    <>
      <StepHeader icon="sliders" step={3} title="Tutor Preferences" text="Set your preferences to help us find the most suitable tutors. These are optional." art="check-circle" />
      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
        <div>
          <Label>Preferred Budget</Label>
          <div className="flex items-center gap-4">
            <div className="range-dual relative h-6 flex-1">
              <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-100" />
              <div className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-brand-500" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
              <input type="range" min={MIN_RATE} max={MAX_RATE} step="5" value={lo} aria-label="Minimum hourly budget" onChange={(e) => setBudget(Math.min(Number(e.target.value), hi - 5), hi)} />
              <input type="range" min={MIN_RATE} max={MAX_RATE} step="5" value={hi} aria-label="Maximum hourly budget" onChange={(e) => setBudget(lo, Math.max(Number(e.target.value), lo + 5))} />
            </div>
            <div className="w-36 text-right text-lg font-extrabold text-navy">
              {c.budgetMax == null ? 'Any' : <>RM{lo} – RM{hi}</>} <span className="text-xs font-semibold text-slate-500">/ hour</span>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-slate-600">
            <Icon name="info" className="h-4 w-4 shrink-0 text-brand-500" /> Budget is a preference used for matching, not a hard eligibility requirement.
          </div>
        </div>

        <div>
          <Label>Tutor Gender</Label>
          <div className="flex flex-wrap gap-2">
            {[['FEMALE', 'Female'], ['MALE', 'Male'], ['ANY', 'No preference']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => patch({ gender: v })} className={`flex min-w-[96px] flex-1 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${c.gender === v ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-slate-200 bg-white text-slate-600'}`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${c.gender === v ? 'border-brand-500' : 'border-slate-300'}`}>{c.gender === v && <span className="h-2.5 w-2.5 rounded-full bg-brand-500" />}</span>
                <span className="truncate">{l}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <Label>Tutor Characteristics / Teaching Style</Label>
          <div className="flex flex-wrap gap-2">
            {CHARACTERISTICS.map((ch) => {
              const on = c.characteristics.includes(ch)
              return (
                <button key={ch} type="button" onClick={() => patch({ characteristics: on ? c.characteristics.filter((x) => x !== ch) : [...c.characteristics, ch] })}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${on ? 'border-brand-500 bg-brand-50 text-brand-500' : 'border-slate-200 bg-white text-slate-600'}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded ${on ? 'bg-brand-500 text-white' : 'border-2 border-slate-300'}`}>{on && <Icon name="check" className="h-3.5 w-3.5" strokeWidth={3.5} />}</span>
                  {ch}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <Label>Other Preferences <span className="font-normal text-slate-500">(Optional)</span></Label>
          <textarea
            rows={3} maxLength={200} value={c.notes} onChange={(e) => patch({ notes: e.target.value })}
            placeholder="e.g. Prefer a tutor with experience preparing students for exams."
            className="input resize-none"
          />
          <div className="text-right text-xs text-slate-400">{c.notes.length}/200</div>
        </div>
      </div>
      <div className="mt-8 flex items-center justify-between">
        <button onClick={onBack} className="btn-outline h-12 px-6"><Icon name="arrow-left" className="h-4 w-4" /> Back</button>
        <button onClick={onFind} disabled={busy} className="btn-primary h-12 px-8 text-base">
          <Icon name="sparkle" fill className="h-4 w-4 text-accent" /> {busy ? 'Finding your matches…' : 'Find My Matches'} {!busy && <Icon name="arrow-right" className="h-4 w-4" />}
        </button>
      </div>
    </>
  )
}
