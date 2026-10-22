import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import TutorCard from '../../components/TutorCard'
import { CompareBar, useCompare } from '../../components/Compare'
import Icon from '../../components/ui/Icon'
import { EmptyState, ErrorBox, PageTitle, Spinner } from '../../components/ui/Common'

// Tutors the parent saved with the heart button, to compare or book later
export default function SavedTutors() {
  const compare = useCompare() // up to 3 tutors ticked for the side-by-side comparison
  const [tutors, setTutors] = useState(null)
  const [error, setError] = useState('')
  // The tutor just removed, so an accidental click can be undone
  const [removed, setRemoved] = useState(null)
  const busy = useRef(new Set())

  useEffect(() => {
    api.get('/parent/favourites').then((r) => setTutors(r.data.tutors)).catch((e) => setError(errorMessage(e)))
  }, [])

  // The favourites endpoint toggles, so a second click while the first is still running is ignored
  async function toggle(t, saveIt) {
    if (busy.current.has(t.id)) return
    busy.current.add(t.id)
    setError('')
    try {
      await api.post(`/parent/favourites/${t.id}`)
      if (saveIt) {
        setTutors((list) => [...list, t].sort((a, b) => a.name.localeCompare(b.name)))
        setRemoved(null)
      } else {
        setTutors((list) => list.filter((x) => x.id !== t.id))
        setRemoved(t)
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      busy.current.delete(t.id)
    }
  }
  const unsave = (t) => toggle(t, false)

  return (
    <div>
      <PageTitle icon="heart" title="Saved Tutors" subtitle="Tutors you saved to compare or book later." />
      <ErrorBox className="mb-4">{error}</ErrorBox>
      {removed && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-brand-25 px-4 py-2.5 text-sm text-slate-700">
          Removed {removed.name} from your saved tutors.
          <button onClick={() => toggle(removed, true)} className="min-h-10 font-semibold text-brand-600 hover:underline">Undo</button>
        </div>
      )}
      {!tutors && !error && <Spinner />}
      {tutors?.length === 0 && (
        <div className="card">
          <EmptyState icon="heart" title="No saved tutors yet">
            Tap the heart on a tutor card to save it here. <Link to="/parent/find-tutor" className="font-semibold text-brand-600 hover:underline">Find a tutor</Link>
          </EmptyState>
        </div>
      )}
      {tutors?.length > 0 && (
        <>
          <p className="mb-3 text-sm text-slate-600">{tutors.length === 1 ? '1 saved tutor' : `${tutors.length} saved tutors`}</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {tutors.map((t) => <TutorCard key={t.id} tutor={t} saved onToggleSave={unsave} compare={compare} />)}
          </div>
          <CompareBar compare={compare} />
          <Link to="/parent/find-tutor" className="btn-outline mt-6 min-h-11"><Icon name="search" className="h-4 w-4" /> Find more tutors</Link>
        </>
      )}
    </div>
  )
}
