import { useEffect, useState } from 'react'
import api, { errorMessage } from '../../api/client'
import Avatar from '../../components/ui/Avatar'
import Icon from '../../components/ui/Icon'
import { EmptyState, ErrorBox, Modal, PageTitle, SelectBox, Spinner, StatusPill } from '../../components/ui/Common'
import LessonDetails from '../../components/LessonDetails'
import { fmtDate, fmtTime, fmtTimeRange, money } from '../../lib/format'
import { gradeLabel } from '../../lib/education'

const lessonTitle = (b) => `${b.subject}${b.isTrial ? ' Trial' : ''} Lesson`
// Unpaid bookings are released 1 hour before the lesson (the backend scheduler uses the same rule)
const payBy = (b) => new Date(new Date(b.startAt).getTime() - 60 * 60_000)
const BANK_KEY = 'wt_preferred_bank'
const savedBank = () => { try { return localStorage.getItem(BANK_KEY) || '' } catch { return '' } }

export default function Payments() {
  const [data, setData] = useState(null)
  const [payFor, setPayFor] = useState(null)
  const [detail, setDetail] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [methodOpen, setMethodOpen] = useState(false)
  const [bank, setBank] = useState(savedBank())

  const load = () => api.get('/parent/payments').then((r) => setData(r.data))
  useEffect(() => { load() }, [])
  if (!data) return <Spinner />

  const { required, summary, transactions, banks } = data
  const rows = showAll ? transactions : transactions.slice(0, 5)

  return (
    <div>
      <PageTitle title="Payments" subtitle="Manage your lesson payments and view your transaction history." sparkle={false}
        right={<div className="pointer-events-none hidden items-center gap-3 pr-6 lg:flex"><Icon name="card" className="h-16 w-16 text-brand-200" strokeWidth={1.25} /><div className="font-hand text-2xl leading-6 text-brand-200 [transform:rotate(-8deg)]">Learning<br />Today<br />Brighter<br />Tomorrow</div></div>} />

      <div className="grid items-start gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {required.map((b) => (
            <section key={b.id} className="card border-accent/30 bg-accent-50/70 p-6">
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-100 text-accent-600"><Icon name="clock" className="h-7 w-7" /></span>
                <div><h2 className="text-2xl font-extrabold text-navy">Payment Required</h2><p className="text-sm text-slate-600">Complete the payment to confirm your upcoming lesson.</p></div>
              </div>
              <div className="mt-4 grid gap-4 rounded-2xl bg-white p-4 md:grid-cols-[1fr_auto] md:items-center">
                <div className="flex gap-4">
                  <Avatar src={b.tutor.photoUrl} name={b.tutor.name} className="h-24 w-24" rounded="rounded-xl" />
                  <div>
                    <div className="text-xl font-extrabold text-navy">{lessonTitle(b)}</div>
                    <div className="text-sm text-slate-500">{b.tutor.name} <span className="mx-1 text-slate-300">·</span> {gradeLabel(b.child.educationLevel, b.child.grade)}</div>
                    <div className="mt-1.5 flex items-center gap-2 text-sm text-navy"><Icon name="calendar" className="h-4 w-4 text-brand-500" /> {fmtDate(b.startAt)} <span className="text-slate-400">·</span> {fmtTimeRange(b.startAt, b.endAt)}</div>
                    <div className="flex items-center gap-2 text-sm text-slate-500"><Icon name={b.teachingMode === 'ONLINE' ? 'monitor' : 'pin'} className="h-4 w-4 text-brand-500" /> {b.teachingMode === 'ONLINE' ? 'Online' : `Physical · ${b.location || ''}`}</div>
                  </div>
                </div>
                <div className="space-y-2 md:border-l md:border-slate-100 md:pl-6 md:text-left">
                  <StatusPill status="AWAITING_PAYMENT" label="Payment Pending" />
                  <div className="text-3xl font-extrabold text-navy">{money(b.totalAmount)}</div>
                  <div className="text-xs text-slate-600">Pay by <b className="text-navy">{fmtDate(payBy(b))}, {fmtTime(payBy(b))}</b> or the slot is released.</div>
                  <button onClick={() => setPayFor(b)} className="btn-primary h-12 w-full px-8 text-base md:w-48">Pay Now <Icon name="arrow-right" className="h-4 w-4" /></button>
                </div>
              </div>
            </section>
          ))}

          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xl font-extrabold text-navy">Recent Transactions</h2>
              {transactions.length > 5 && <button onClick={() => setShowAll((s) => !s)} className="flex items-center gap-1 text-sm font-semibold text-brand-500 hover:underline">{showAll ? 'Show Less' : 'View All Transactions'} <Icon name="arrow-right" className="h-4 w-4" /></button>}
            </div>
            {transactions.length === 0 ? <EmptyState icon="card" title="No transactions yet">Your payments will appear here once you pay for a lesson.</EmptyState> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead><tr className="bg-brand-50 text-slate-500"><th className="rounded-l-lg px-4 py-2.5 font-semibold">Lesson Details</th><th className="px-3 py-2.5 font-semibold">Date</th><th className="px-3 py-2.5 font-semibold">Amount</th><th className="px-3 py-2.5 font-semibold">Status</th><th className="rounded-r-lg px-3 py-2.5 font-semibold">Action</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((t) => (
                      <tr key={t.id}>
                        <td className="px-4 py-3"><div className="flex items-center gap-3"><Avatar src={t.booking.tutor.photoUrl} name={t.booking.tutor.name} className="h-11 w-11" rounded="rounded-lg" />
                          <div><div className="font-bold text-navy">{lessonTitle(t.booking)}</div><div className="text-xs text-slate-500">{t.booking.tutor.name} · {gradeLabel(t.booking.child.educationLevel, t.booking.child.grade)}</div></div></div></td>
                        <td className="px-3 py-3"><div className="flex items-start gap-2"><Icon name="calendar" className="mt-0.5 h-4 w-4 text-brand-500" /><div><div className="text-navy">{fmtDate(t.booking.startAt)}</div><div className="text-xs text-slate-500">{fmtTimeRange(t.booking.startAt, t.booking.endAt)}</div></div></div></td>
                        <td className="px-3 py-3 font-bold text-navy">{money(t.amount)}</td>
                        <td className="px-3 py-3"><StatusPill status={t.status} /></td>
                        <td className="px-3 py-3"><button onClick={() => setDetail(t.booking)} className="flex items-center gap-1 font-semibold text-brand-500 hover:underline">View Details <Icon name="arrow-right" className="h-4 w-4" /></button></td>
                      </tr>))}
                  </tbody>
                </table>
              </div>)}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="card p-5">
            <h2 className="mb-3 text-xl font-extrabold text-navy">Payment Summary</h2>
            <div className="space-y-3">
              {[['wallet', money(summary.totalPaid), 'Total Paid', 'bg-brand-50', 'bg-brand-500 text-white'], ['clock', money(summary.pendingPayment), 'Pending Payment', 'bg-accent-50', 'bg-accent-100 text-accent-600'], ['chart', money(summary.paidThisMonth), 'Paid This Month', 'bg-ok-50', 'bg-ok text-white']].map(([icon, v, l, bg, tone]) => (
                <div key={l} className={`flex items-center gap-4 rounded-xl p-4 ${bg}`}>
                  <span className={`flex h-12 w-12 items-center justify-center rounded-full ${tone}`}><Icon name={icon} className="h-6 w-6" /></span>
                  <div className="flex-1"><div className="text-2xl font-extrabold text-navy">{v}</div><div className="text-sm text-slate-600">{l}</div></div>
                </div>))}
            </div>
          </section>
          <section className="card p-5">
            <h2 className="mb-3 text-xl font-extrabold text-navy">Payment Method</h2>
            <div className="rounded-xl border border-slate-100 p-4">
              <div className="flex items-center gap-4">
                <span className="text-3xl font-black italic tracking-tight text-navy"><span className="text-brand-500">❯</span>FPX</span>
                <div><div className="font-bold text-navy">FPX Online Banking</div><div className="text-sm text-slate-500">{bank ? `Preferred bank: ${bank}` : 'Preferred payment method'}</div></div>
              </div>
              <button onClick={() => setMethodOpen(true)} className="btn-outline mt-4 w-full">Change Payment Method <Icon name="arrow-right" className="h-4 w-4" /></button>
            </div>
          </section>
        </aside>
      </div>

      {/* Reload on every close: even a failed attempt can change things (e.g. the booking expired meanwhile) */}
      <PayModal booking={payFor} banks={banks} defaultBank={bank} onClose={() => { setPayFor(null); load() }} onDone={() => { setPayFor(null); load() }} />
      <LessonDetails booking={detail} onClose={() => setDetail(null)} onChanged={load} />
      <Modal open={methodOpen} onClose={() => setMethodOpen(false)} title="Payment Method">
        <p className="mb-3 text-sm text-slate-500">Lessons are paid by FPX online banking. Choose the bank you'd like pre-selected at checkout.</p>
        <SelectBox icon="card" value={bank} onChange={(e) => { setBank(e.target.value); try { localStorage.setItem(BANK_KEY, e.target.value) } catch { /* private mode */ } }}>
          <option value="">Ask me every time</option>{banks.map((b) => <option key={b}>{b}</option>)}
        </SelectBox>
        <div className="mt-5 flex justify-end"><button onClick={() => setMethodOpen(false)} className="btn-primary px-6">Done</button></div>
      </Modal>
    </div>
  )
}

// Sandbox FPX checkout: no real money moves. "Simulate failed payment" tests the failure path.
function PayModal({ booking, banks, defaultBank, onClose, onDone }) {
  const [bank, setBank] = useState(defaultBank || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  if (!booking) return null

  async function pay(outcome) {
    if (!bank) return setError('Please choose your bank.')
    setBusy(true)
    setError('')
    try {
      const checkout = await api.post('/parent/payments/checkout', { bookingId: booking.id })
      const res = await api.post(`/parent/payments/${checkout.data.paymentId}/confirm`, { bank, outcome })
      setResult(res.data)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const close = () => { const ok = result?.status === 'SUCCESS'; setResult(null); setError(''); if (ok) onDone(); else onClose() }

  return (
    <Modal open onClose={close} title={result ? (result.status === 'SUCCESS' ? 'Payment successful' : 'Payment failed') : 'Pay with FPX'}>
      {result ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className={`flex h-16 w-16 items-center justify-center rounded-full text-white ${result.status === 'SUCCESS' ? 'bg-ok' : 'bg-red-500'}`}><Icon name={result.status === 'SUCCESS' ? 'check' : 'x'} className="h-9 w-9" strokeWidth={3} /></span>
          <p className="text-sm text-slate-600">{result.message}</p>
          <button onClick={close} className="btn-primary px-8">{result.status === 'SUCCESS' ? 'Done' : 'Close'}</button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-brand-50 p-4">
            <div><div className="font-bold text-navy">{lessonTitle(booking)}</div><div className="text-xs text-slate-500">{booking.tutor.name} · {fmtDate(booking.startAt)}</div></div>
            <div className="text-2xl font-extrabold text-navy">{money(booking.totalAmount)}</div>
          </div>
          <div className="flex gap-2 rounded-lg bg-accent-50 p-3 text-xs text-amber-800"><Icon name="info" className="h-4 w-4 shrink-0" /> Sandbox mode: this is a test payment gateway. No real money is charged.</div>
          <ErrorBox>{error}</ErrorBox>
          <label className="block text-sm font-bold text-navy">Select your bank
            <SelectBox icon="card" className="mt-1.5" value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="" disabled>Choose a bank…</option>{banks.map((b) => <option key={b}>{b}</option>)}
            </SelectBox></label>
          <button disabled={busy} onClick={() => pay('SUCCESS')} className="btn-primary h-12 w-full text-base">{busy ? 'Processing…' : `Pay ${money(booking.totalAmount)}`}</button>
          <button disabled={busy} onClick={() => pay('FAILED')} className="w-full text-center text-xs font-semibold text-slate-500 hover:underline">Simulate a failed payment (test only)</button>
        </div>
      )}
    </Modal>
  )
}
