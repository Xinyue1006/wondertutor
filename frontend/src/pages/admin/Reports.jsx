import { useState } from 'react'
import { PageTitle, SectionCard } from '../../components/ui/Common'
import { Period, Records, Rows } from '../../components/ui/AdminRecords'
import { exportRows, useRecords } from '../../lib/adminRecords'
import { money } from '../../lib/format'

const monthly = [['Month', r => r.month], ['Platform commission', r => money(r.commission)], ['Tutor share', r => money(r.tutorNet)]]
const tutors = [['Tutor', r => r.tutor], ['Bookings', r => r.bookings], ['Completed', r => r.completed], ['Cancelled', r => r.cancelled], ['Average rating', r => r.rating?.toFixed(1) ?? '—'], ['Tutor share of payments', r => money(r.tutorNet)]]
function RevenueTrend({ months }) {
  const peak = Math.max(1, ...months.map(row => Math.abs(Number(row.commission))))
  return <ul aria-label="Monthly platform commission" className="my-3 space-y-2">{months.map(row =>
    <li key={row.month} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 text-sm"><span>{row.month}</span>
      <span aria-hidden="true" className="rounded bg-brand-50"><span className={'block h-3 rounded ' + (Number(row.commission) < 0 ? 'bg-red-500' : 'bg-brand-500')} style={{ width: Math.abs(Number(row.commission)) / peak * 100 + '%' }} /></span>
      <span>{money(row.commission)}</span></li>)}</ul>
}

export default function Reports() {
  const [period,setPeriod] = useState('')
  const source = useRecords('/admin/reports?' + period)
  const dates = new URLSearchParams(period)
  return <div className="space-y-4"><PageTitle title="Platform reports" /><Period value={period} onChange={setPeriod} />
    <p>{dates.get('from') || 'Beginning of records'} – {dates.get('to') || 'Today'}</p>
    <Records source={source}>{r => <><SectionCard title="Platform activity"><dl className="grid grid-cols-2 gap-4 md:grid-cols-3">{[['Payments received',money(r.gross)],['Refunds issued',money(r.refunded)],['Net collected',money(r.netCollected)],['Platform commission',money(r.commission)],['Transactions',r.transactionCount],['Bookings',r.bookings]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl></SectionCard>
      <SectionCard title="Monthly revenue"><RevenueTrend months={r.months} /><Rows columns={monthly} rows={r.months} /><button className="btn-outline min-h-11 print:hidden" onClick={() => exportRows('monthly-revenue',monthly,r.months)}>Export revenue CSV</button></SectionCard>
      <SectionCard title="Booking status"><Rows columns={ [['Status', x => x[0].replaceAll('_',' ')], ['Bookings',x => x[1]]] } rows={Object.entries(r.statuses)} /></SectionCard>
      <SectionCard title="Tutor performance"><Rows columns={tutors} rows={r.performance} /><button className="btn-outline min-h-11 print:hidden" onClick={() => exportRows('tutor-performance',tutors,r.performance)}>Export tutor CSV</button></SectionCard>
      <button className="btn-primary min-h-11 print:hidden" onClick={() => window.print()}>Print or save PDF</button></>}</Records></div>
}
