import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useMatching } from '../../assistant/MatchingContext'
import Icon from '../../components/ui/Icon'
import Robot from '../../components/ui/Robot'
import TutorCard from '../../components/TutorCard'
import { CompareBar, useCompare } from '../../components/Compare'
import Pagination from '../../components/ui/Pagination'
import FilterChips, { NO_EXTRA } from '../../components/FilterChips'
import PlaceSearch from '../../components/PlaceSearch'
import { ErrorBox, FilterDropdown, LoadError, PageTitle, SelectBox, Spinner, EmptyState } from '../../components/ui/Common'
import { GRADE_GROUPS, parseGrade } from '../../lib/education'
import { subjectsForLevel } from '../../lib/subjects'
import { hhmmLabel, todayYmd } from '../../lib/format'

const SORTS = [
  ['recommended', 'Recommended'],
  ['price_asc', 'Price: Low to High'],
  ['price_desc', 'Price: High to Low'],
  ['rating', 'Highest Rated'],
  ['experience', 'Most Experienced'],
  ['nearest', 'Nearest'],
]
const PAGE_SIZE = 9
const HOURS = Array.from({ length: 15 }, (_, i) => `${String(i + 8).padStart(2, '0')}:00`) // 08:00 - 22:00

export default function FindTutor() {
  const compare = useCompare() // up to 3 tutors ticked for the side-by-side comparison
  const navigate = useNavigate()
  const { catalog, kids, kidsLoaded, patchCriteria, loadError, reloadShared } = useMatching()

  // Top search bar (draft values, applied when "Search Tutors" is pressed)
  const [bar, setBar] = useState(null)
  // What the results currently reflect
  const [applied, setApplied] = useState(null)
  const [extra, setExtra] = useState(NO_EXTRA)
  const [sort, setSort] = useState('recommended')
  const [page, setPage] = useState(1)
  const resultsTop = useRef(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const initialised = useRef(false)
  // Tutors whose heart was just clicked: a second click waits until the first save/unsave has finished
  const [saving, setSaving] = useState(() => new Set())

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
    const p = { subject: applied.subject, level, grade, sort, page, pageSize: PAGE_SIZE }
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
  }, [applied, extra, sort, page])

  useEffect(() => { setPage(1) }, [applied, extra, sort])

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

  if (!bar || !catalog) return loadError ? <LoadError message={loadError} onRetry={reloadShared} /> : <Spinner />

  const set = (k) => (e) => setBar({ ...bar, [k]: e.target.value })
  // Save / unsave straight from the results; the heart updates at once
  async function toggleSave(t) {
    if (saving.has(t.id)) return
    setSaving((s) => new Set(s).add(t.id))
    try {
      const r = await api.post(`/parent/favourites/${t.id}`)
      setData((d) => ({ ...d, tutors: d.tutors.map((x) => (x.id === t.id ? { ...x, isFavourite: r.data.isFavourite } : x)) }))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(t.id); return n })
    }
  }

  const search = () => {
    if (!bar.subject || !bar.grade) return setError('Subject and education level are required')
    // The availability filter needs both parts; half of it would be silently ignored
    if (Boolean(bar.date) !== Boolean(bar.time)) return setError('Choose both a date and a start time, or clear the availability filter.')
    setError('')
    setApplied(bar)
  }

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
              {[...new Set([...subjectsForLevel(catalog.subjects, catalog.subjectLevels, parseGrade(bar.grade).level), bar.subject])].map((s) => <option key={s}>{s}</option>)}
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
          <PlaceSearch
            label="Location" value={bar.location} onChange={(v) => setBar((b) => ({ ...b, location: v }))} quiet
            labelClass="mb-1.5 block text-sm font-semibold text-navy" placeholder="Any location: search a town or postcode"
          />
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
        <div ref={resultsTop} className="scroll-mt-24">
          {/* "Showing 1–9 of 11 tutors": what is on screen out of everything that matches */}
          <h2 className="text-xl font-bold text-navy" aria-live="polite">{error && !data ? 'Tutors could not be loaded' : resultsHeading(data)}</h2>
          {data?.total > 0 && sort === 'recommended' && (
            <p className="text-sm text-slate-600">
              Best match first{data.rankedBy?.length ? `, based on ${data.rankedBy.join(' and ')}` : ''}. Every card shows its match score and why.
            </p>
          )}
        </div>
        <Link to="/parent/favourites" className="ml-auto flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
          <Icon name="heart" className="h-4 w-4" /> Saved tutors
        </Link>
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
          {data?.tutors.map((t) => <TutorCard key={t.id} tutor={t} match={t.match} saved={t.isFavourite} onToggleSave={toggleSave} compare={compare} />)}
        </div>
        <CompareBar compare={compare} />
        {data && (
          <div className="mt-6">
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              onChange={(p) => { setPage(p); resultsTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
              label="Tutor results pages"
            />
          </div>
        )}
      </div>
    </div>
  )
}

// "Showing 1–9 of 11 tutors" / "Showing 1 tutor" / "No tutors found"
export function resultsHeading(data) {
  if (!data) return 'Searching…'
  if (data.total === 0) return 'No tutors found'
  const from = (data.page - 1) * data.pageSize + 1
  const to = from + data.tutors.length - 1
  if (data.total === 1) return 'Showing 1 tutor'
  if (from === 1 && to === data.total) return `Showing all ${data.total} tutors`
  return `Showing ${from}–${to} of ${data.total} tutors`
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
