import { attendanceLabels, refundHoldLabels } from '../../lib/attendanceReview'
import { useState } from 'react'
import api from '../../api/client'
import { PageTitle, SectionCard } from '../../components/ui/Common'
import { Records, Rows, DecisionForm, Note, Period } from '../../components/ui/AdminRecords'
import { useRecords, exportRows } from '../../lib/adminRecords'
import { fmtDate, money } from '../../lib/format'
import WithdrawalReviews from './WithdrawalReviews'

const transactionColumns = [['Date', x => fmtDate(x.date)], ['Transaction', x => x.type + ' #' + x.id], ['Booking', x => x.bookingId ?? '—'],
  ['Tutor', x => x.tutor], ['Parent', x => x.parent || '—'], ['Status', x => x.status], ['Amount', x => money(x.amount)], ['Saved rate', x => x.rate == null ? '—' : Number(x.rate) + '%'],
  ['Commission', x => money(x.commission)], ['Tutor share', x => money(x.tutorNet)]]

function Transactions() {
  const [period,setPeriod] = useState(''), [q,setQ] = useState('')
  const source = useRecords('/admin/transactions?' + period)
  return <SectionCard title="Transactions"><Period value={period} onChange={setPeriod} /><label className="my-3 block">Search transactions<input className="input text-base" value={q} onChange={e => setQ(e.target.value)} placeholder="Type, booking or name" /></label>
    <Records source={source}>{({rows}) => {
      const filtered = rows.filter(x => [x.type,x.id,x.bookingId,x.tutor,x.parent,x.status].join(' ').toLowerCase().includes(q.toLowerCase()))
      return <><button className="btn-outline mb-3 min-h-11" onClick={() => exportRows('transactions',transactionColumns,filtered)}>Export CSV</button><Rows columns={transactionColumns} rows={filtered} /></>
    }}</Records></SectionCard>
}

function RefundItem({r,done}) {
  const [action,setAction] = useState(r.status === 'APPROVED' ? 'issued' : 'approve')
  return <details className="rounded-xl border border-brand-100 p-3"><summary className="cursor-pointer py-2 font-semibold">#{r.bookingId} · {r.parent} · {money(r.amount)} · {r.status}</summary>
    {r.attendanceOutcome && <p>Attendance review: {attendanceLabels[r.attendanceOutcome]}</p>}
    <p className="my-2">Reason: {r.reason} · Paid: {money(r.paid)}</p>{r.decision && <p>{r.decision}</p>}
    {r.attendanceRefundState === 'ON_HOLD' ? <p role="status">{refundHoldLabels.ON_HOLD}</p> : <DecisionForm label={action === 'issued' ? 'Record completed transfer' : 'Save refund decision'} done={done} submit={f => api.post('/admin/refunds/' + r.id + '/decision',
      action === 'issued' ? { action, reference: f.reference } : action === 'reject' ? { action, reason: f.reason } : { action, amount: Number(f.amount), basis: f.basis, reason: f.reason })}>
      {r.status === 'APPROVED' ? <label>Reference from the completed bank or gateway refund<input name="reference" required maxLength={100} className="input text-base" /></label> : <>
        <label>Decision<select className="input text-base" value={action} onChange={e => setAction(e.target.value)}><option value="approve">Approve refund</option><option value="reject">Reject refund</option></select></label>
        {action === 'approve' && <><label>Refund amount (RM)<input name="amount" type="number" required min="0.01" max={r.amount} step="0.01" defaultValue={r.amount} className="input text-base" /></label>
          <label>Eligibility<select className="input text-base" name="basis" required defaultValue=""><option disabled value="">Choose a basis</option><option>Mutual agreement</option><option>Refund policy condition</option></select></label></>}
        <Note label="Record the evidence and reason" maxLength={150} />
      </>}
    </DecisionForm>}</details>
}
function Refunds() {
  const source = useRecords('/admin/refunds')
  return <SectionCard title="Refunds"><Records source={source}>{({rows}) => rows.length ? <div className="space-y-2">{rows.map(r =>
    <RefundItem key={r.id + '-' + r.status} r={r} done={source.reload} />)}</div> : <p>No refunds waiting for review or transfer.</p>}</Records></SectionCard>
}
function Salary() {
  const list = useRecords('/admin/rates')
  const [id,setId] = useState(''), [period,setPeriod] = useState('')
  const summary = useRecords(id ? '/admin/salary/' + id + '?' + period : null)
  return <SectionCard title="Tutor salary summary"><div className="space-y-3 print:hidden"><Records source={list}>{({tutors}) => <label>Tutor<select className="input text-base" value={id} onChange={e => setId(e.target.value)}><option value="">Choose a tutor</option>{tutors.map(t => <option key={t.id} value={t.id}>{t.name} · #{t.id}</option>)}</select></label>}</Records>
    <Period value={period} onChange={setPeriod} /></div>
    {id && <Records source={summary}>{s => <div className="mt-4 space-y-3"><h2 className="text-xl font-bold">{s.tutor} · Earnings statement</h2>
      <p>Payment period: {new URLSearchParams(period).get('from') || 'Beginning'} to {new URLSearchParams(period).get('to') || 'today'}</p>
      <Rows rows={s.sessions} columns={[['Paid on',x => fmtDate(x.date)],['Booking',x=>x.bookingId],['Subject',x=>x.subject],['Gross',x=>money(x.fee)],['Refunds',x=>money(x.refunded)],['Commission',x=>money(x.commission)],['Net',x=>money(x.net)]]} />
      <dl>{[['Gross lesson fees',s.gross],['Refunds',s.refunded],['Commission deducted',s.commission],['Net earnings',s.net],['Withdrawals approved in period',s.approved],['Currently available',s.available]].map(([k,v]) => <div key={k} className="flex justify-between gap-2 border-b py-1"><dt>{k}</dt><dd>{money(v)}</dd></div>)}</dl>
      <button className="btn-outline min-h-11 print:hidden" onClick={() => window.print()}>Print or save PDF</button></div>}</Records>}
  </SectionCard>
}
export default function Finance() {
  const [tab,setTab] = useState('Transactions')
  return <div className="min-w-0 space-y-4"><PageTitle title="Financial management" subtitle="Review payments, withdrawals, refunds and tutor earnings." />
    <div className="flex flex-wrap gap-2 print:hidden">{['Transactions','Withdrawals','Refunds','Salary summary'].map(t => <button key={t} aria-pressed={tab === t} className={(tab === t ? 'btn-primary' : 'btn-outline') + ' min-h-11'} onClick={() => setTab(t)}>{t}</button>)}</div>
    {tab === 'Transactions' ? <Transactions /> : tab === 'Withdrawals' ? <WithdrawalReviews /> : tab === 'Refunds' ? <Refunds /> : <Salary />}</div>
}
