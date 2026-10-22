import { useState } from 'react'
import api, { errorMessage } from '../api/client'
import { ErrorBox } from './ui/Common'

// Admin: a formal warning to a user (FR 8.2). The user sees the reason in a notification, and it is kept in their history.
export default function WarnUser({ userId, name, complaintId, onDone }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    if (busy) return
    if (reason.trim().length < 10) return setError('Please explain the warning (at least 10 characters).')
    setBusy(true)
    setError('')
    try {
      await api.post(`/admin/users/${userId}/warn`, { reason, ...(complaintId && { complaintId }) })
      setOpen(false)
      setReason('')
      onDone?.()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} className="btn-outline px-4 py-1.5 text-sm">Issue warning to {name}</button>
  return (
    <div className="space-y-2 rounded-xl border border-accent/40 bg-accent-50 p-3">
      <ErrorBox>{error}</ErrorBox>
      <label className="block text-sm font-bold text-navy">What is the warning for?
        <textarea rows={3} maxLength={500} className="input mt-1.5 resize-none" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Arrived late to three lessons this month." />
      </label>
      <p className="text-xs text-slate-600">{name} will see this reason in a notification, and is told that further problems may lead to deactivation.</p>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={send} className="btn-primary px-4 py-1.5">{busy ? 'Sending…' : 'Send warning'}</button>
        <button type="button" className="btn-outline px-4 py-1.5" onClick={() => { setOpen(false); setError('') }}>Cancel</button>
      </div>
    </div>
  )
}
