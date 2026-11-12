import { useEffect, useState } from 'react'
import api, { errorMessage } from '../../api/client'
import { ErrorBox, LoadError, PageTitle, Spinner } from '../../components/ui/Common'

const fields = [
  { key: 'GPS_RADIUS_METRES', title: 'GPS check-in distance', hint: 'How close a tutor must be to the lesson address for a physical check-in.', unit: 'metres', min: 50, max: 300, step: 1, type: 'range' },
  { key: 'RATING_THRESHOLD', title: 'Rating warning threshold', hint: 'Flag tutors whose average rating falls below this score for admin review.', unit: 'out of 5', min: 1, max: 5, step: 0.1 },
  { key: 'BASE_COMMISSION_RATE', title: 'Base commission rate', hint: 'The platform commission assigned when a tutor is newly verified. Existing verified tutors keep their rate.', unit: '%', min: 0, max: 100, step: 0.01 },
]

function SettingCard({ field, initial }) {
  const { key, title, hint, unit, min, max, step, type = 'number' } = field
  const [saved, setSaved] = useState(initial)
  const [draft, setDraft] = useState(String(initial))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function save(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const { data } = await api.patch('/admin/settings', { key, value: Number(draft) })
      setSaved(data.value)
      setMessage('Saved.')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} aria-labelledby={key + '-title'} className="card grid min-w-0 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,1fr)_auto] lg:items-start">
      <div>
        <h2 id={key + '-title'} className="text-lg font-bold text-navy"><label htmlFor={key}>{title}</label></h2>
        <p id={key + '-hint'} className="mt-1 text-sm text-slate-600">{hint}</p>
      </div>
      <div className="min-w-0">
        {type === 'range' && <div className="flex items-baseline justify-between text-sm text-slate-600"><span>{min} m</span><strong className="text-xl text-navy">{draft} m</strong><span>{max} m</span></div>}
        <div className="flex items-center gap-2">
          <input id={key} type={type} min={min} max={max} step={step} required disabled={busy} value={draft}
            aria-describedby={key + '-hint'} aria-valuetext={type === 'range' ? draft + ' metres' : undefined}
            className={type === 'range' ? 'min-h-11 w-full accent-brand-600' : 'input min-h-11 min-w-0 flex-1 text-base'}
            onChange={(e) => { setDraft(e.target.value); setMessage(''); setError('') }} />
          {type !== 'range' && <span className="text-sm text-slate-600">{unit}</span>}
        </div>
      </div>
      <button type="submit" aria-label={'Save ' + title.toLowerCase()} disabled={busy || draft === '' || Number(draft) === saved}
        className="btn-primary min-h-11 w-full justify-center lg:w-auto">{busy ? 'Saving…' : 'Save'}</button>
      {error && <ErrorBox className="lg:col-span-3">{error}</ErrorBox>}
      {message && <p role="status" className="text-sm font-semibold text-green-700 lg:col-span-3">{message}</p>}
    </form>
  )
}

export default function AdminSettings() {
  const [settings, setSettings] = useState(null)
  const [error, setError] = useState('')
  function load() {
    api.get('/admin/settings').then(({ data }) => setSettings(data)).catch((err) => setError(errorMessage(err)))
  }
  useEffect(() => { load() }, [])
  return (
    <div className="min-w-0">
      <PageTitle title="System configuration" subtitle="Manage check-in, tutor ratings and commission." sparkle={false} />
      {settings ? <div className="space-y-4">{fields.map((field) => <SettingCard key={field.key} field={field} initial={settings[field.key]} />)}</div>
        : error ? <LoadError message={error} onRetry={() => { setError(''); load() }} /> : <Spinner />}
    </div>
  )
}
