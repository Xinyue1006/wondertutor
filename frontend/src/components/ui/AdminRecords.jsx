import { useState } from 'react'
import { errorMessage } from '../../api/client'
import { ErrorBox, LoadError, Spinner } from './Common'

export function Records({ source, children }) {
  if (source.error) return <LoadError message={source.error} onRetry={source.reload} />
  return source.data ? children(source.data) : <Spinner />
}
export function Rows({ columns, rows, empty = 'No records for this selection.' }) {
  if (!rows.length) return <p className="py-3 text-slate-600">{empty}</p>
  return <div className="min-w-0">
    <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead className="bg-brand-50"><tr>{columns.map(([label]) => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row,i) => <tr className="border-b border-brand-100" key={i}>{columns.map(([label,read]) => <td className="p-2" key={label}>{read(row)}</td>)}</tr>)}</tbody></table></div>
    <ul className="divide-y divide-brand-100 md:hidden">{rows.map((row,i) => <li key={i} className="py-3"><dl className="grid grid-cols-2 gap-2 text-sm">{columns.map(([label,read]) => <div key={label} className="min-w-0 break-words"><dt className="text-slate-600">{label}</dt><dd className="font-semibold">{read(row)}</dd></div>)}</dl></li>)}</ul>
  </div>
}
export function Period({ value, onChange }) {
  return <form className="flex flex-wrap items-end gap-3 print:hidden" onSubmit={e => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const query = new URLSearchParams()
    for (const [key,val] of form) if (val) query.set(key,val)
    onChange(query.toString())
  }}><label>From<input className="input min-h-11 text-base" name="from" type="date" defaultValue={new URLSearchParams(value).get('from') || ''} /></label>
    <label>To<input className="input min-h-11 text-base" name="to" type="date" defaultValue={new URLSearchParams(value).get('to') || ''} /></label>
    <button className="btn-outline min-h-11">Apply dates</button></form>
}
export function DecisionForm({ submit, label, children, done }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <form className="space-y-3" onSubmit={async e => {
    e.preventDefault()
    if (busy) return
    const data = Object.fromEntries(new FormData(e.currentTarget))
    setBusy(true); setError('')
    try { await submit(data); done() } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }}><fieldset className="min-w-0 space-y-3" disabled={busy}>{children}<button className="btn-primary min-h-11">{busy ? 'Saving…' : label}</button></fieldset>{error && <ErrorBox>{error}</ErrorBox>}</form>
}
export function Note({ label = 'Reason', maxLength = 191 }) {
  return <label className="block">{label}<textarea required name="reason" maxLength={maxLength} className="input w-full text-base" /></label>
}
