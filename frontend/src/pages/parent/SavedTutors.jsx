import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import TutorCard from '../../components/TutorCard'
import Icon from '../../components/ui/Icon'
import { EmptyState, ErrorBox, PageTitle, Spinner } from '../../components/ui/Common'

// Tutors the parent saved with the heart button, to compare or book later
export default function SavedTutors() {
  const [tutors, setTutors] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/parent/favourites').then((r) => setTutors(r.data.tutors)).catch((e) => setError(errorMessage(e)))
  }, [])

  async function unsave(t) {
    try {
      await api.post(`/parent/favourites/${t.id}`)
      setTutors((list) => list.filter((x) => x.id !== t.id))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <div>
      <PageTitle icon="heart" title="Saved Tutors" subtitle="Tutors you saved to compare or book later." />
      <ErrorBox className="mb-4">{error}</ErrorBox>
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
            {tutors.map((t) => <TutorCard key={t.id} tutor={t} saved onToggleSave={unsave} />)}
          </div>
          <Link to="/parent/find-tutor" className="btn-outline mt-6 min-h-11"><Icon name="search" className="h-4 w-4" /> Find more tutors</Link>
        </>
      )}
    </div>
  )
}
