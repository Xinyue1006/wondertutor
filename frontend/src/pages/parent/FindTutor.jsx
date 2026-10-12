import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useMatching } from '../../assistant/MatchingContext'
import Icon from '../../components/ui/Icon'
import Robot from '../../components/ui/Robot'
import TutorCard from '../../components/TutorCard'
import FilterChips, { NO_EXTRA } from '../../components/FilterChips'
import { ErrorBox, FilterDropdown, PageTitle, SelectBox, Spinner, EmptyState } from '../../components/ui/Common'
import { GRADE_GROUPS, parseGrade } from '../../lib/education'
import { hhmmLabel, todayYmd } from '../../lib/format'

const SORTS = [
  ['recommended', 'Recommended'],
  ['price_asc', 'Price: Low to High'],
  ['price_desc', 'Price: High to Low'],
  ['rating', 'Highest Rated'],
  ['experience', 'Most Experienced'],
  ['nearest', 'Nearest'],
]
const HOURS = Array.from({ length: 15 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`) // 08:00 - 22:00

export default function FindTutor() {
  const navigate = useNavigate()
  const { catalog, kids, kidsLoaded, patchCriteria } = useMatching()

  // Top search bar (draft values, applied when "Search Tutors" is pressed)
  const [bar, setBar] = useState(null)
  // What the results currently reflect
  const [applied, setApplied] = useState(null)
  const [extra, setExtra] = useState(NO_EXTRA)
  const [sort, setSort] = useState('recommended')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const initialised = useRef(false)

  // First visit: pre-fill from the parent's first child and saved area, so results show immediately
  useEffect(() => {
    if (initialised.current || !catalog || !kidsLoaded) return
    initialised.current = true
    const kid = kids[0]
    const initial = {
      subject: kid?.subject || 'Mathematics',
      grade: kid ? `${kid.educationLevel}:${kid.grade}` : 'PRIMARY:5',
      location: catalog.homeLocation || '',
      date: '',
      time: '',
    }
    setBar(initial)
    setApplied(initial)
  }, [catalog, kids, kidsLoaded])

  const query = useMemo(() => {
    if (!applied) return null
    const { level, grade } = parseGrade(applied.grade)
    const p = { subject: applied.subject, level, grade, sort }
    if (applied.location) p.location = applied.location
    if (applied.date && applied.time) Object.assign(p, { date: applied.date, time: applied.time })
    if (extra.minPrice !== '') p.minPrice = extra.minPrice
    if (extra.maxPrice !== '') p.maxPrice = extra.maxPrice
    if (extra.minRating) p.minRating = extra.minRating
    if (extra.days.length) p.days = extra.days.join(',')
    if (extra.maxDistance) p.maxDistance = extra.maxDistance
    if (extra.mode) p.mode = extra.mode
    if (extra.characteristics.length) p.characteristics = extra.characteristics.join(',')
    return p
  }, [applied, extra, sort])

  useEffect(() => {
    if (!query) return
    let cancelled = false
    setLoading(true)
    setError('')
    api.get('/parent/tutors', { params: query })
      .then((r) => !cancelled && setData(r.data))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [query])

  if (!bar || !catalog) return <Spinner />

  const set = (k) => (e) => setBar({ ...bar, [k]: e.target.value })
  const search = () => { if (!bar.subject || !bar.grade) return setError('Subject and education level are required'); setError(''); setApplied(bar) }

  function tryAiMatching() {
    const { level, grade } = parseGrade(bar.grade)
    patchCriteria({ subject: bar.subject, level, grade, location: bar.location, childId: kids.find((k) => k.educationLevel === level && k.grade === grade)?.id ?? null })
    navigate('/parent/find-tutor/match')
  }

  const dateTimeLabel = bar.date && bar.time ? `${bar.date} · ${hhmmLabel(bar.time)}` : 'Select date & time'

  return (
    <div>
      <PageTitle title="Find the Right Tutor for Your Child" subtitle="Browse qualified tutors or let our AI Tutor Assistant help you find suitable matches." />

      <section className="card p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto] xl:items-end">
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-navy">Subject <span className="text-red-500">*</span></span>
            <SelectBox icon="book" value={bar.subject} onChange={set('subject')}>
              {catalog.subjects.map((s) => <option key={s}>{s}</option>)}
            </SelectBox>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-navy">Education Level <span className="text-red-500">*</span></span>
            <SelectBox icon="cap" value={bar.grade} onChange={set('grade')}>
              {GRADE_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>{g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
              ))}
            </SelectBox>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-navy">Location</span>
            <SelectBox icon="pin" value={bar.location} onChange={set('location')}>
              <option value="">Any location</option>
              {catalog.locations.map((l) => <option key={l}>{l}</option>)}
            </SelectBox>
          </label>
          <div>
            <span className="mb-1.5 block text-sm font-semibold text-navy">Availability</span>
            <AvailabilityPicker bar={bar} setBar={setBar} label={dateTimeLabel} />
          </div>
          <button onClick={search} className="btn-primary h-11 px-8 text-base"><Icon name="search" className="h-[18px] w-[18px]" /> Search Tutors</button>
        </div>
        <ErrorBox className="mt-3">{error}</ErrorBox>

        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-brand-100 bg-brand-25 p-3">
          <Robot className="h-14 w-14 shrink-0" />
          <div className="min-w-[200px] flex-1">
            <div className="font-bold text-navy">Not sure which tutor to choose?</div>
            <div className="text-sm text-slate-500">Let our AI Tutor Assistant understand your child's learning needs and recommend suitable tutors.</div>
          </div>
          <button onClick={tryAiMatching} className="btn-accent px-5">Try AI Matching <Icon name="arrow-right" className="h-4 w-4" /></button>
        </div>
      </section>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold text-navy">{data ? `${data.total} tutor${data.total === 1 ? '' : 's'} found` : '…'}</h2>
        <label className="flex items-center gap-2 text-sm font-semibold text-navy">
          Sort by:
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="input h-10 w-48 font-medium">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-3">
        <FilterChips extra={extra} setExtra={setExtra} locationName={applied.location} />
      </div>

      <div className="mt-4">
        {loading && !data ? <Spinner /> : null}
        {data && data.tutors.length === 0 && !loading && (
          <div className="card"><EmptyState icon="search" title="No tutors match these filters">Try another subject or level, or remove some filters.</EmptyState></div>
        )}
        <div className={`grid gap-4 md:grid-cols-2 xl:grid-cols-3 ${loading ? 'opacity-60' : ''}`}>
          {data?.tutors.map((t) => <TutorCard key={t.id} tutor={t} />)}
        </div>
      </div>
    </div>
  )
}

// "Select date & time" popover: a date and a 1-hour start time
function AvailabilityPicker({ bar, setBar, label }) {
  return (
    <FilterDropdown label={<span className="flex items-center gap-2"><Icon name="calendar" className="h-[18px] w-[18px] text-brand-500" />{label}</span>} width="w-72" active={!!bar.date}>
      {(close) => (
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-navy">Date
            <input type="date" min={todayYmd()} className="input mt-1 h-10" value={bar.date} onChange={(e) => setBar({ ...bar, date: e.target.value })} />
          </label>
          <label className="block text-sm font-semibold text-navy">Start time
            <select className="input mt-1 h-10" value={bar.time} onChange={(e) => setBar({ ...bar, time: e.target.value })}>
              <option value="">Select time</option>
              {HOURS.map((h) => <option key={h} value={h}>{hhmmLabel(h)}</option>)}
            </select>
          </label>
          <div className="flex justify-between">
            <button className="text-sm font-semibold text-slate-500 hover:underline" onClick={() => { setBar({ ...bar, date: '', time: '' }); close() }}>Clear</button>
            <button className="btn-primary px-4 py-1.5" onClick={close}>Done</button>
          </div>
          <p className="text-xs text-slate-500">Press “Search Tutors” to apply. Only tutors free at that time are shown.</p>
        </div>
      )}
    </FilterDropdown>
  )
}
