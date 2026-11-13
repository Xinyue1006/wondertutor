import { useState } from 'react'
import api from '../../api/client'
import { PageTitle, SectionCard } from '../../components/ui/Common'
import { Records, Rows, DecisionForm, Note } from '../../components/ui/AdminRecords'
import { useRecords, exportRows } from '../../lib/adminRecords'
import { fmtDate, fmtTime, money } from '../../lib/format'

const when = d => fmtDate(d) + ' · ' + fmtTime(d)
const columns = [['Booking', b => '#' + b.id], ['Parent', b => b.parent], ['Tutor', b => b.tutor], ['Subject', b => b.subject],
  ['Session', b => when(b.startAt)], ['Status', b => b.status], ['Hourly rate', b => money(b.agreed ?? b.counter ?? b.offered)]]

function Decision({ booking: b, issue, done }) {
  const [action,setAction] = useState('keep')
  return <details className="rounded-xl border border-brand-100 p-3">
    <summary className="cursor-pointer py-2 font-semibold">{issue.kind} · #{b.id} · {b.parent} and {b.tutor}</summary>
    <div className="my-3 space-y-1"><p>{b.subject} · {when(b.startAt)} · {b.status}</p><p>{issue.reason}</p>
      {issue.proposed && <p>Proposed time: {when(issue.proposed)}</p>}
      {issue.kind === 'Fee negotiation' && <p>Parent offered {money(b.offered)} / hour{b.counter && ' · Tutor offered ' + money(b.counter) + ' / hour'}</p>}</div>
    <DecisionForm label="Record final decision" done={done} submit={f => api.post('/admin/bookings/' + b.id + '/decision', {
      kind: issue.kind, caseId: issue.id, version: b.version, action, reason: f.reason, ...(action === 'set-fee' && { price: Number(f.price) }),
    })}>
      <label className="block">Decision<select className="input min-h-11 text-base" value={action} onChange={e => setAction(e.target.value)}>
        <option value="keep">Keep current booking and close case</option>
        {issue.kind === 'Schedule change' ? <option value="move">Approve proposed time</option> : <>
          {issue.kind === 'Fee negotiation' && <option value="set-fee">Set final hourly fee</option>}
          {b.status !== 'CANCELLED' && <option value="cancel">Cancel booking</option>}</>}
      </select></label>
      {action === 'set-fee' && <label>Hourly fee (RM)<input required name="price" type="number" step="0.01" min="0.01" max="1000" className="input text-base" /></label>}
      <Note label="Decision and reason for both parties" />
    </DecisionForm>
  </details>
}
export default function BookingOversight() {
  const source = useRecords('/admin/bookings')
  const [q,setQ] = useState(''), [status,setStatus] = useState(''), [notice,setNotice] = useState('')
  return <div className="space-y-4"><PageTitle title="Booking oversight" subtitle="Review bookings and resolve requests that need an admin decision." />
    {notice && <p role="status">{notice}</p>}
    <Records source={source}>{({rows}) => {
      const issues = rows.flatMap(b => b.cases.map(issue => ({b,issue})))
      const filtered = rows.filter(b => (!status || b.status === status) && [b.id,b.parent,b.tutor,b.subject,b.student].join(' ').toLowerCase().includes(q.toLowerCase()))
      return <><SectionCard title={'Escalations waiting for a decision (' + issues.length + ')'}><div className="space-y-2">{issues.length ? issues.map(({b,issue}) =>
        <Decision key={issue.kind + issue.id} booking={b} issue={issue} done={() => { setNotice('Decision recorded. Both parties have been notified.'); source.reload() }} />) : 'No escalations are waiting.'}</div></SectionCard>
        <SectionCard title="All bookings"><div className="mb-4 flex flex-wrap items-end gap-2"><label>Search<input className="input text-base" value={q} onChange={e => setQ(e.target.value)} placeholder="Booking, parent or tutor" /></label>
          <label>Status<select className="input min-h-11 text-base" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{[...new Set(rows.map(b => b.status))].map(s => <option key={s}>{s}</option>)}</select></label>
          <button className="btn-outline min-h-11" onClick={() => exportRows('bookings',columns,filtered)}>Export CSV</button></div>
          <Rows columns={[...columns,['Student',b => b.student],['Mode',b => b.mode]]} rows={filtered} /></SectionCard></>
    }}</Records></div>
}
