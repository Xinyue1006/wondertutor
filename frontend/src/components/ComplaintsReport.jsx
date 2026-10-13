import { useEffect, useState } from 'react'
import api, { errorMessage } from '../api/client'
import Icon from './ui/Icon'
import { ErrorBox } from './ui/Common'

// Admin summary of how complaints are being handled, for any date range, plus a CSV download for record keeping
const hoursLabel = (h) => (h == null ? '—' : h < 48 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} days`)

export default function ComplaintsReport({ refreshKey = 0 }) {
  const [range, setRange] = useState({ from: '', to: '' })
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)

  const params = Object.fromEntries(Object.entries(range).filter(([, v]) => v))

  useEffect(() => {
    if (range.from && range.to && range.from > range.to) return setError('The start date must be before the end date.')
    setError('')
    api.get('/admin/complaints/report', { params }).then((r) => setReport(r.data)).catch((e) => setError(errorMessage(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to, refreshKey])

  async function download() {
    setDownloading(true)
    try {
      const r = await api.get('/admin/complaints/export', { params, responseType: 'blob' })
      const url = URL.createObjectURL(r.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `complaints${range.from ? `-from-${range.from}` : ''}${range.to ? `-to-${range.to}` : ''}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setDownloading(false)
    }
  }

  const tile = (label, value, hint, tone = 'text-navy') => (
    <div className="rounded-xl border border-brand-100 bg-white p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${tone}`}>{value}</div>
      {hint && <div className="text-xs text-slate-600">{hint}</div>}
    </div>
  )

  return (
    <section aria-labelledby="report-title" className="card mb-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="report-title" className="text-lg font-bold text-navy">Complaints Report</h2>
          <p className="text-sm text-slate-600">Filed between the dates below. Leave them empty for all time.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-navy">From<input type="date" className="input mt-1 h-10" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label className="text-xs font-semibold text-navy">To<input type="date" className="input mt-1 h-10" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          {(range.from || range.to) && <button onClick={() => setRange({ from: '', to: '' })} className="btn-outline min-h-10 px-3">Clear</button>}
          <button onClick={download} disabled={downloading} className="btn-primary min-h-10 px-4"><Icon name="file" className="h-4 w-4" /> {downloading ? 'Preparing…' : 'Export CSV'}</button>
        </div>
      </div>
      <ErrorBox className="mt-3">{error}</ErrorBox>
      {report && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {tile('Complaints', report.total, `${report.byStatus.OPEN} open · ${report.byStatus.IN_PROGRESS} in progress`)}
            {tile(`Waiting over ${report.overdueDays} days`, report.overdue, report.overdue ? 'Handle these first' : 'Nothing overdue', report.overdue ? 'text-red-700' : 'text-ok')}
            {tile('Average time to close', hoursLabel(report.averageResolutionHours), 'Resolved or dismissed')}
            {tile('Closed', report.resolutionRate == null ? '—' : `${report.resolutionRate}%`, `${report.byStatus.RESOLVED} resolved · ${report.byStatus.DISMISSED} dismissed`)}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl bg-brand-25 p-4">
              <h3 className="text-sm font-bold text-navy">By category</h3>
              {report.byCategory.length === 0 ? <p className="mt-1 text-sm text-slate-600">No complaints in this period.</p> : (
                <ul className="mt-2 space-y-1.5">
                  {report.byCategory.map((c) => (
                    <li key={c.category} className="flex items-center gap-2 text-sm">
                      <span className="w-36 shrink-0 truncate text-slate-700">{c.category}</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-brand-100" aria-hidden="true"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${(c.count / report.total) * 100}%` }} /></span>
                      <b className="w-6 text-right text-navy">{c.count}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl bg-brand-25 p-4">
              <h3 className="text-sm font-bold text-navy">Most complained about</h3>
              {report.mostComplainedAbout.length === 0 ? <p className="mt-1 text-sm text-slate-600">No complaints named a user.</p> : (
                <ol className="mt-2 space-y-1.5 text-sm">
                  {report.mostComplainedAbout.map((u) => (
                    <li key={u.userId} className="flex justify-between gap-2"><span className="text-slate-700">{u.name} <span className="text-xs text-slate-500">({u.role.toLowerCase()})</span></span><b className="text-navy">{u.count}</b></li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
