import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useMatching } from '../../assistant/MatchingContext'
import Icon from '../../components/ui/Icon'
import { EmptyState, ErrorBox, LoadError, PageTitle, Spinner } from '../../components/ui/Common'
import TutorCard from '../../components/TutorCard'
import { CompareBar, useCompare } from '../../components/Compare'
import FilterChips, { NO_EXTRA, applyExtra } from '../../components/FilterChips'

const SORTS = [
  ['recommended', 'Recommended'],
  ['price_asc', 'Price: Low to High'],
  ['price_desc', 'Price: High to Low'],
  ['rating', 'Highest Rated'],
  ['nearest', 'Nearest'],
]

// Matching results: each card shows the match % and the "why we recommend this tutor" reasons
export default function MatchResults() {
  const compare = useCompare() // up to 3 tutors ticked for the side-by-side comparison
  const navigate = useNavigate()
  const { result, setResult, setCriteria } = useMatching()
  const [loading, setLoading] = useState(!result)
  const [extra, setExtra] = useState(NO_EXTRA)
  const [sort, setSort] = useState('recommended')
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const saving = useRef(new Set())

  // Opened directly (e.g. page refresh)? Fall back to the parent's most recent saved search
  const loadLatest = () => {
    setLoadError('')
    setLoading(true)
    api.get('/parent/matching/latest')
      .then((r) => { if (r.data.matching) { setResult(r.data.matching); setCriteria((c) => ({ ...c, ...r.data.matching.criteria })) } })
      .catch((e) => setLoadError(errorMessage(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => {
    if (!result) loadLatest()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save / unsave from the results, the same heart as on Find a Tutor (a second click waits for the first)
  async function toggleSave(t) {
    if (saving.current.has(t.id)) return
    saving.current.add(t.id)
    setSaveError('')
    try {
      const r = await api.post(`/parent/favourites/${t.id}`)
      setResult((res) => ({ ...res, tutors: res.tutors.map((x) => (x.id === t.id ? { ...x, isFavourite: r.data.isFavourite } : x)) }))
    } catch (err) {
      setSaveError(errorMessage(err))
    } finally {
      saving.current.delete(t.id)
    }
  }

  const tutors = useMemo(() => {
    if (!result) return []
    const list = applyExtra(result.tutors, extra)
    const by = {
      price_asc: (a, b) => a.hourlyRate - b.hourlyRate,
      price_desc: (a, b) => b.hourlyRate - a.hourlyRate,
      rating: (a, b) => b.rating - a.rating,
      nearest: (a, b) => (a.match.distanceKm ?? 999) - (b.match.distanceKm ?? 999),
    }[sort]
    return by ? [...list].sort(by) : list // "recommended" keeps the server's score order
  }, [result, extra, sort])

  if (loading) return <Spinner />
  if (!result && loadError) return <LoadError message={loadError} onRetry={loadLatest} />

  if (!result)
    return (
      <div className="card"><EmptyState icon="search" title="No matching search yet" action={<Link to="/parent/find-tutor/match" className="btn-primary mt-2">Start Matching</Link>}>
        Tell us what your child needs and we'll recommend suitable tutors.
      </EmptyState></div>
    )

  return (
    <div>
      <Link to="/parent/find-tutor/match" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-500 hover:underline">
        <Icon name="arrow-left" className="h-4 w-4" /> Back to Matching Preferences
      </Link>
      <PageTitle
        title="Here are your recommended tutors"
        subtitle={`We found ${result.total} tutor${result.total === 1 ? '' : 's'} that match your requirements.${tutors.length !== result.total && result.total > 0 ? ` Showing ${tutors.length} with your filters.` : ''}`}
        right={<button onClick={() => navigate('/parent/find-tutor/match')} className="btn-outline h-11 px-5"><Icon name="edit" className="h-4 w-4" /> Edit Matching Preferences</button>}
      />

      <div className="mb-4 flex items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800">
        <Icon name="info" className="h-4 w-4 shrink-0" />
        These tutors match your subject and education level, and are ranked based on their availability, location, teaching style, price and rating.
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <FilterChips extra={extra} setExtra={setExtra} locationName={result.criteria.location} />
        <label className="flex items-center gap-2 text-sm font-semibold text-navy">
          Sort by:
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="input h-10 w-44 font-medium">
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      <ErrorBox className="mb-4">{saveError}</ErrorBox>
      {tutors.length === 0 ? (
        <div className="card"><EmptyState icon="search" title={result.total === 0 ? 'No eligible tutors yet' : 'No tutors match these filters'}>
          {result.total === 0 ? 'No tutor currently teaches this subject at your child\'s level. Try changing the subject or level.' : 'Try removing some filters.'}
        </EmptyState></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {tutors.map((t) => <TutorCard key={t.id} tutor={t} match={t.match} saved={t.isFavourite} onToggleSave={toggleSave} compare={compare} />)}
        </div>
      )}
      <CompareBar compare={compare} />
    </div>
  )
}
