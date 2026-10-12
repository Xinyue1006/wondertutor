import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import { EmptyState, ErrorBox, Modal, PageTitle, SelectBox, Spinner } from '../../components/ui/Common'
import { fmtDate, fmtShortDate } from '../../lib/format'

export const COMPLAINT_STATUS = {
  OPEN: ['Open', 'bg-accent-100 text-amber-700'],
  IN_PROGRESS: ['In Progress', 'bg-sky-100 text-sky-700'],
  RESOLVED: ['Resolved', 'bg-ok-50 text-ok'],
  DISMISSED: ['Closed', 'bg-slate-100 text-slate-600'],
}

export function ComplaintPill({ status }) {
  const [label, cls] = COMPLAINT_STATUS[status]
  return <span className={`pill px-3 py-1.5 ${cls}`}>{label}</span>
}

// Parent: file a complaint (optionally about a booking) and track its status
export default function Complaints() {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [bookings, setBookings] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ bookingId: '', category: '', description: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/parent/complaints').then((r) => setData(r.data))
  useEffect(() => {
    load()
    api.get('/parent/bookings').then((r) => setBookings(r.data.bookings.filter((b) => ['CONFIRMED', 'COMPLETED', 'CANCELLED'].includes(b.status))))
  }, [])

  // Deep link from a lesson: /parent/complaints?booking=<id>
  useEffect(() => {
    if (params.get('booking')) {
      setForm((f) => ({ ...f, bookingId: params.get('booking') }))
      setOpen(true)
    }
  }, [params])

  function close() {
    setOpen(false)
    setError('')
    if (params.get('booking')) setParams({})
  }

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.post('/parent/complaints', {
        bookingId: form.bookingId ? Number(form.bookingId) : null,
        category: form.category,
        description: form.description,
      })
      setForm({ bookingId: '', category: '', description: '' })
      close()
      load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!data) return <Spinner />

  return (
    <div>
      <PageTitle
        icon="shield" title="My Complaints" subtitle="Report a problem and follow how it is being handled."
        right={<button onClick={() => setOpen(true)} className="btn-primary h-11 px-5"><Icon name="plus" className="h-4 w-4" /> File a Complaint</button>}
      />

      {data.complaints.length === 0 ? (
        <div className="card"><EmptyState icon="shield" title="No complaints filed">If something went wrong with a lesson, let us know and our team will look into it.</EmptyState></div>
      ) : (
        <div className="space-y-3">
          {data.complaints.map((c) => (
            <article key={c.id} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-extrabold text-navy">{c.category}</h2>
                  <ComplaintPill status={c.status} />
                </div>
                <span className="text-xs text-slate-400">Filed {fmtShortDate(c.createdAt)}</span>
              </div>
              {(c.booking || c.against) && (
                <div className="mt-1 text-sm text-slate-500">
                  {c.booking && <>About: {c.booking.subject} lesson on {fmtDate(c.booking.startAt)}</>}
                  {c.against && <> · Tutor: {c.against.name}</>}
                </div>
              )}
              <p className="mt-2 text-sm text-slate-600">{c.description}</p>
              {c.adminResponse && (
                <div className="mt-3 rounded-xl bg-brand-25 p-3 text-sm">
                  <div className="mb-0.5 flex items-center gap-1.5 font-bold text-navy"><Icon name="shield" className="h-4 w-4 text-brand-500" /> Response from WonderTutor</div>
                  <p className="text-slate-600">{c.adminResponse}</p>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Modal open={open} onClose={close} title="File a complaint">
        <form onSubmit={submit} className="space-y-4">
          <ErrorBox>{error}</ErrorBox>
          <label className="block"><span className="mb-1.5 block text-sm font-bold text-navy">Category <span className="text-red-500">*</span></span>
            <SelectBox value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="" disabled>Choose a category…</option>
              {data.categories.map((c) => <option key={c}>{c}</option>)}
            </SelectBox></label>
          <label className="block"><span className="mb-1.5 block text-sm font-bold text-navy">Related lesson <span className="font-normal text-slate-500">(Optional)</span></span>
            <SelectBox value={form.bookingId} onChange={(e) => setForm({ ...form, bookingId: e.target.value })}>
              <option value="">Not about a specific lesson</option>
              {bookings.map((b) => <option key={b.id} value={b.id}>{b.subject} with {b.tutor.name} · {fmtDate(b.startAt)}</option>)}
            </SelectBox></label>
          <label className="block"><span className="mb-1.5 block text-sm font-bold text-navy">What happened? <span className="text-red-500">*</span></span>
            <textarea rows={5} maxLength={1000} className="input resize-none" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Please describe the problem so our team can look into it." />
            <span className="block text-right text-xs text-slate-400">{form.description.length}/1000</span></label>
          <div className="flex justify-end gap-3"><button type="button" onClick={close} className="btn-outline">Cancel</button><button disabled={busy} className="btn-primary px-6">{busy ? 'Submitting…' : 'Submit'}</button></div>
        </form>
      </Modal>
    </div>
  )
}
