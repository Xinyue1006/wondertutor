import { useState } from 'react'
import api from '../../api/client'
import { PageTitle, SectionCard } from '../../components/ui/Common'
import { Records, Rows, DecisionForm, Note } from '../../components/ui/AdminRecords'
import { useRecords } from '../../lib/adminRecords'
import { fmtDate, fmtTime, money } from '../../lib/format'

export default function TutorRates() {
  const source = useRecords('/admin/rates')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [notice, setNotice] = useState('')
  return <div className="space-y-4"><PageTitle title="Tutor commission and rates" subtitle="Review each tutor’s rates and the reasons for changes." />
    {notice && <p role="status">{notice}</p>}
    <Records source={source}>{({ base,tutors }) => {
      const visible = tutors.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
      const t = visible.find(t => t.id === selected) || visible[0]
      return <><SectionCard title="Tutors"><label>Search tutors<input className="input min-h-11 text-base" value={search} onChange={e => setSearch(e.target.value)} /></label>
        {t && <label>Tutor<select className="input min-h-11 text-base" value={t.id} onChange={e => setSelected(Number(e.target.value))}>{visible.map(v => <option key={v.id} value={v.id}>{v.name} · #{v.id}</option>)}</select></label>}
        <p className="mt-2">Platform base commission: {Number(base)}%</p></SectionCard>
        {t ? <div key={t.id} className="space-y-4"><div className="grid gap-4 md:grid-cols-2">{['COMMISSION','HOURLY'].map(kind => {
          const pct = kind === 'COMMISSION', current = Number(pct ? t.commission : t.hourly)
          return <SectionCard key={kind} title={pct ? 'Commission override' : 'Hourly salary rate'}><p className="mb-3">Current: {pct ? current + '%' : money(current) + ' / hour'}</p>
            <DecisionForm label="Save new rate" done={() => { setNotice('Rate saved. The tutor has been notified.'); source.reload() }} submit={f => api.patch('/admin/rates/' + t.id, { kind, previous: current, rate: Number(f.rate), reason: f.reason })}>
              <label className="block">{pct ? 'New commission (%)' : 'New hourly rate (RM)'}<input className="input min-h-11 text-base" type="number" name="rate" required min={pct ? 0 : 0.01} max={pct ? 100 : 500} step="0.01" /></label><Note />
            </DecisionForm></SectionCard>
        })}</div><SectionCard title={'Rate history · ' + t.name}><Rows rows={t.history} columns={[
          ['Effective', x => fmtDate(x.createdAt) + ' ' + fmtTime(x.createdAt)], ['Rate', x => x.kind === 'HOURLY' ? 'Hourly (RM)' : 'Commission (%)'],
          ['Previous', x => x.previous ?? '—'], ['New', x => x.rate], ['Changed by', x => x.changedBy], ['Reason', x => x.reason],
        ]} /></SectionCard></div> : <p>No matching tutor.</p>}</>
    }}</Records></div>
}
