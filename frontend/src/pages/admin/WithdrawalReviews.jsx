import { useCallback, useEffect, useState } from 'react'
import api, { errorMessage } from '../../api/client'
import { ErrorBox, LoadError, PageTitle, Spinner } from '../../components/ui/Common'
import { fmtDate, money } from '../../lib/format'

function Request({ w, refresh }) {
  const [action, setAction] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function review(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.post('/admin/withdrawals/' + w.id + '/review', { status: action, expectedStatus: w.status, ...(action === 'REJECTED' && { reason }) })
      await refresh()
    } catch (err) { setError(errorMessage(err)); await refresh() }
    finally { setBusy(false) }
  }
  return <article className="card min-w-0 space-y-3 break-words p-4">
    <h2 className="text-lg font-bold text-navy">{w.tutor} · {money(w.amount)}</h2>
    <p>{fmtDate(w.date)} · {w.bank.bankName} ••{w.bank.lastFour} · {w.bank.accountName}</p>
    {w.status === 'ESCALATED' && <p className="text-sm font-semibold">Bank details changed after this request. Verify the original account with the tutor before approving.</p>}
    {action ? <form onSubmit={review} className="space-y-2">
      {action === 'REJECTED' ? <label className="block">Reason for rejection<textarea required maxLength={191} className="input text-base" value={reason} onChange={e => setReason(e.target.value)} /></label> :
        <p>Record approval of {money(w.amount)} for the account ending {w.bank.lastFour}? This records the decision and deducts the amount from the tutor’s available earnings. It does not transfer money to the bank automatically.</p>}
      <div className="flex flex-wrap gap-2"><button className="btn-primary min-h-11" disabled={busy || (action === 'REJECTED' && !reason.trim())}>Confirm decision</button><button type="button" disabled={busy} className="btn-outline min-h-11" onClick={() => setAction('')}>Cancel</button></div>
    </form> : <div className="flex flex-wrap gap-2"><button className="btn-primary min-h-11" onClick={() => setAction('APPROVED')}>Approve</button><button className="btn-outline min-h-11" onClick={() => setAction('REJECTED')}>Reject</button></div>}
    {error && <ErrorBox>{error}</ErrorBox>}
  </article>
}

export default function WithdrawalReviews() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.get('/admin/withdrawals')
    .then(({ data }) => { setRows(data.requests); setError('') })
    .catch(err => setError(errorMessage(err))), [])
  useEffect(() => { load() }, [load])
  return <div className="min-w-0 space-y-3"><PageTitle title="Withdrawal requests" subtitle="Review tutors’ requests to withdraw their earnings." sparkle={false} />
    <p className="card p-4 text-sm text-slate-600">Approval records your decision; bank transfers are handled separately. Verify the destination and follow the manual payout process before approving. Only the last four account digits are displayed here.</p>
    {error ? <LoadError message={error} onRetry={load} /> : !rows ? <Spinner /> : rows.length ? rows.map(w => <Request key={w.id + '-' + w.status} w={w} refresh={load} />) : <p className="card p-5">No withdrawal requests are waiting for review.</p>}
  </div>
}
