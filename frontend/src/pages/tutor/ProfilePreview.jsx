import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import { LoadError, ModePills, Spinner, VerifiedTick } from '../../components/ui/Common'
import { gradeLabel } from '../../lib/education'

// "Preview my profile": the public facts parents will see, built from the tutor's own setup data.
// Private details (phone, emergency contact, identity document) are deliberately left out, as on the real profile.
export default function ProfilePreview() {
  const [p, setP] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      setP((await api.get('/tutor/profile')).data)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])
  useEffect(() => { load() }, [load])

  if (error) return <LoadError message={error} onRetry={load} />
  if (!p) return <Spinner />

  const quals = p.documents.filter((d) => d.kind === 'QUALIFICATION' && d.status !== 'REJECTED')
  const verified = p.status === 'VERIFIED'

  return (
    <div className="mx-auto max-w-[60rem] space-y-5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold text-navy">Preview of your profile</h1>
          <p className="mt-1 text-slate-600">This is how parents will see you{verified ? '' : ' once Admin verifies your documents'}.</p>
        </div>
        <Link to="/tutor/setup" className="btn-outline min-h-11 px-4"><Icon name="edit" className="h-4 w-4" /> Edit profile</Link>
      </div>

      <section className="card flex flex-wrap items-center gap-5 p-6">
        <Avatar src={p.profilePhotoUrl} name={p.fullName} className="h-20 w-20" text="text-2xl" />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-navy">
            {p.fullName} {verified && <VerifiedTick />}
          </h2>
          <p className="text-sm text-slate-600">{[...new Set(p.subjects.map((s) => s.subject))].join(', ') || 'No subjects yet'}{p.location ? ` · ${p.location}` : ''}</p>
          <div className="mt-2"><ModePills online={p.offersOnline} physical={p.offersPhysical} /></div>
        </div>
        <div className="text-right">
          <div className="font-display text-2xl font-bold text-navy">{p.hourlyRate ? `RM ${p.hourlyRate}` : 'RM –'}<span className="text-sm font-normal text-slate-600"> / hour</span></div>
          <div className="text-xs text-slate-600">{p.yearsExperience} years of experience</div>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="font-display text-lg font-bold text-navy">About</h2>
        <p className="mt-2 whitespace-pre-line text-slate-700">{p.bio || 'Not written yet.'}</p>
        {p.subjects.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            {p.subjects.map((s, i) => (
              <li key={i} className="rounded-full bg-brand-50 px-3 py-1 text-brand-700">
                {s.subject}: {gradeLabel(s.educationLevel, s.minGrade)}{s.maxGrade !== s.minGrade ? ` – ${gradeLabel(s.educationLevel, s.maxGrade)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-display text-lg font-bold text-navy">Qualifications</h2>
          {quals.length ? (
            <ul className="mt-2 space-y-1 text-sm text-navy">
              {quals.map((q) => (
                <li key={q.id}>{q.title}{q.institution ? `, ${q.institution}` : ''}{q.year ? ` (${q.year})` : ''}{q.status === 'PENDING' && <span className="text-slate-500"> · awaiting verification</span>}</li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-slate-600">None uploaded yet.</p>}
        </section>
        <section className="card p-6">
          <h2 className="font-display text-lg font-bold text-navy">Portfolio</h2>
          {p.portfolio.length ? (
            <ul className="mt-2 space-y-1 text-sm text-navy">{p.portfolio.map((x) => <li key={x.id}>{x.title}</li>)}</ul>
          ) : <p className="mt-2 text-sm text-slate-600">Nothing added yet.</p>}
        </section>
      </div>
    </div>
  )
}
