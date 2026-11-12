import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { LoadError, PageTitle, Spinner } from '../components/ui/Common'

export default function Help() {
  const { user } = useAuth()
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const load = () => {
    setError('')
    api.get('/public/faq').then(r => setEntries(r.data.entries)).catch(e => setError(errorMessage(e)))
  }
  useEffect(() => { load() }, [])
  const shown = entries?.filter(e => `${e.topic} ${e.answer}`.toLowerCase().includes(query.trim().toLowerCase())) || []
  return <div className="mx-auto w-full max-w-3xl py-4">
    <PageTitle title="Help & FAQs" subtitle="Find answers about tutor matching, bookings, payments and your account." sparkle={false} />
    <section className="card mb-6 p-5">
      <h2 className="text-lg font-bold text-navy">New to WonderTutor?</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-700">
        <li>Add a child profile with their education level, grade and subjects.</li>
        <li>Browse tutors or use Guided Tutor Search to compare suitable teachers.</li>
        <li>Choose available lesson dates and times, then send a booking request.</li>
        <li>Check My Bookings for the tutor’s response. Pay the agreed amount to confirm an accepted lesson.</li>
      </ol>
      <p className="mt-3 text-sm text-slate-600">A request is not a confirmed lesson. Check its status and payment deadline in My Bookings.</p>
      <Link to={user?.role === 'PARENT' ? '/parent/find-tutor' : '/login'} className="btn-primary mt-4 min-h-11">Find a tutor</Link>
    </section>
    <label className="mb-2 block text-sm font-semibold text-navy" htmlFor="faq-search">Search FAQs</label>
    <div className="mb-4 flex flex-wrap gap-2">
      <input id="faq-search" type="search" className="input min-w-0 flex-1" placeholder="Try payment, refund or availability" value={query} onChange={e => setQuery(e.target.value)} />
      {query && <button className="btn-outline min-h-11" onClick={() => setQuery('')}>Clear search</button>}
    </div>
    {error ? <LoadError message={error} onRetry={load} /> : !entries ? <Spinner /> : <>
      <p role="status" className="mb-3 text-sm text-slate-600">{shown.length} {shown.length === 1 ? 'answer' : 'answers'} found</p>
      {!shown.length && <div className="card p-5 text-slate-700">No matching answers. Try a shorter search or clear the search to see all topics.</div>}
      <div className="space-y-3">{shown.map(e => <details key={e.id} className="card p-4 open:border-brand-300">
        <summary className="cursor-pointer py-1 font-semibold text-navy focus-visible:outline-2 focus-visible:outline-brand-500">{e.topic}</summary>
        <p className="mt-3 whitespace-pre-line leading-relaxed text-slate-700">{e.answer}</p>
      </details>)}</div>
    </>}
    <section className="mt-6 rounded-xl border border-brand-100 bg-brand-50 p-5">
      <h2 className="font-bold text-navy">Still need help?</h2>
      <p className="mt-2 text-slate-700">If something went wrong, include the lesson or payment details and what happened. Never include passwords, OTP codes or bank login details.</p>
      <Link to={user?.role === 'PARENT' ? '/parent/complaints' : '/login'} className="btn-outline mt-3 min-h-11">{user?.role === 'PARENT' ? 'Report an issue' : 'Log in to report an issue'}</Link>
    </section>
  </div>
}
