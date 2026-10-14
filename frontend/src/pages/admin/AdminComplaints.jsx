import { useCallback, useEffect, useState } from 'react'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import { EmptyState, ErrorBox, LoadError, Modal, PageTitle, Spinner } from '../../components/ui/Common'
import { ComplaintPill } from '../parent/Complaints'
import { fmtDate, fmtShortDate } from '../../lib/format'
import ComplaintsReport from '../../components/ComplaintsReport'

const TABS = [['', 'All'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In Progress'], ['RESOLVED', 'Resolved'], ['DISMISSED', 'Dismissed']]

// Admin: review complaints (OPEN -> IN_PROGRESS -> RESOLVED / DISMISSED) and reply to the parent
export default function AdminComplaints() {
  const [status, setStatus] = useState('')
  const [data, setData] = useState(null)
  const [sel, setSel] = useState(null)
  // Bumped after every status change so the report above recounts
  const [reportVersion, setReportVersion] = useState(0)

  const [loadError, setLoadError] = useState('')
  const load = useCallback(() => {
    setLoadError('')
    return api.get('/admin/complaints', { params: { status } }).then((r) => setData(r.data)).catch((e) => setLoadError(errorMessage(e)))
  }, [status])
  useEffect(() => { load() }, [load])

  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0

  return (
    <div>
      <PageTitle title="Complaints & Reports" subtitle="Review complaints from parents and respond to them." />
      <ComplaintsReport refreshKey={reportVersion} />
      <div className="card mb-4 flex flex-wrap gap-2 p-3">
        {TABS.map(([v, l]) => (
          <button key={l} onClick={() => setStatus(v)} className={`rounded-lg border px-4 py-2 text-sm font-semibold ${status === v ? 'border-brand-500 bg-brand-500 text-white' : 'border-brand-200 bg-white text-navy hover:border-brand-500'}`}>
            {l}{data && ` (${v ? data.counts[v] : total})`}
          </button>))}
      </div>

      {!data ? (loadError ? <LoadError message={loadError} onRetry={load} /> : <Spinner />) : data.complaints.length === 0 ? (
        <div className="card"><EmptyState icon="shield" title="No complaints here">Nothing to review in this list.</EmptyState></div>
      ) : (
        <div className="space-y-3">
          {data.complaints.map((c) => (
            <article key={c.id} className="card flex flex-wrap items-center gap-4 p-5">
              <div className="min-w-[260px] flex-1">
                <div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-extrabold text-navy">{c.category}</h2><ComplaintPill status={c.status} /></div>
                <div className="mt-0.5 text-xs text-slate-500">
                  From {c.filedBy.name} ({c.filedBy.email}) · {fmtShortDate(c.createdAt)}
                  {c.against && <> · Against {c.against.name}</>}
                  {c.booking && <> · {c.booking.subject} lesson on {fmtDate(c.booking.startAt)}</>}
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{c.description}</p>
              </div>
              <button onClick={() => setSel(c)} className="btn-outline px-5">{['OPEN', 'IN_PROGRESS'].includes(c.status) ? 'Review' : 'View'} <Icon name="arrow-right" className="h-4 w-4" /></button>
            </article>))}
        </div>
      )}

      <ReviewModal complaint={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); load(); setReportVersion((v) => v + 1) }} />
    </div>
  )
}

function ReviewModal({ complaint: c, onClose, onDone }) {
  const [response, setResponse] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setResponse(c?.adminResponse || ''); setError('') }, [c])
  if (!c) return null
  const closed = ['RESOLVED', 'DISMISSED'].includes(c.status)

  async function act(status) {
    setError('')
    // The parent reads this response, so a closed complaint always says what was done or why
    if (status !== 'IN_PROGRESS' && response.trim().length < 3) return setError('Write a response to the parent before resolving or dismissing.')
    setBusy(true)
    try {
      await api.patch(`/admin/complaints/${c.id}`, { status, adminResponse: response || undefined })
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={c.category} width="max-w-xl">
      <div className="space-y-3">
        <ComplaintPill status={c.status} />
        <div className="rounded-xl bg-brand-25 p-3 text-sm">
          <div className="mb-1 text-xs text-slate-500">From {c.filedBy.name} · {fmtShortDate(c.createdAt)}{c.against && ` · Against ${c.against.name}`}</div>
          <p className="text-slate-700">{c.description}</p>
        </div>
        <ErrorBox>{error}</ErrorBox>
        <label className="block text-sm font-bold text-navy">Response to the parent {closed ? '' : <span className="font-normal text-slate-500">(required to resolve or dismiss)</span>}
          <textarea rows={4} maxLength={1000} disabled={closed} className="input mt-1.5 resize-none disabled:bg-slate-50" value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Explain what was done or why the complaint is closed." />
        </label>
        {!closed && (
          <div className="flex flex-wrap justify-end gap-2">
            {c.status === 'OPEN' && <button disabled={busy} onClick={() => act('IN_PROGRESS')} className="btn-outline">Mark In Progress</button>}
            <button disabled={busy} onClick={() => act('DISMISSED')} className="btn-danger">Dismiss</button>
            <button disabled={busy} onClick={() => act('RESOLVED')} className="btn-primary">Resolve</button>
          </div>
        )}
      </div>
    </Modal>
  )
}
