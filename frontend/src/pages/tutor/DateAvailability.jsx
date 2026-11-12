import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { ErrorBox, SectionCard } from '../../components/ui/Common'
import TutorPageHeader from '../../components/TutorPageHeader'
import { todayYmd } from '../../lib/format'

export default function Availability() {
  const [date,setDate] = useState(todayYmd())
  const [ranges,setRanges] = useState([])
  const [items,setItems] = useState([])
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const load = () => api.get('/tutor/availability/exceptions').then(r => setItems(r.data.exceptions))
  useEffect(() => { load().catch(e=>setError(errorMessage(e))) },[])
  const choose = value => {
    setDate(value)
    setRanges(items.find(i=>i.date===value)?.ranges || [])
  }
  async function save(remove=false) {
    setBusy(true); setError('')
    try {
      if(remove) await api.delete('/tutor/availability/exceptions/'+date)
      else await api.put('/tutor/availability/exceptions',{date,ranges})
      await load()
      if(remove) setRanges([])
    } catch(e) { setError(errorMessage(e)) }
    finally { setBusy(false) }
  }
  return <div className="min-w-0 space-y-5">
    <TutorPageHeader title="Date-specific Availability" subtitle="Set different hours for a particular date. Your usual weekly hours apply to other dates."
      right={<Link to="/tutor/availability" className="btn-outline min-h-11">Back to weekly availability</Link>} />
    <ErrorBox>{error}</ErrorBox>
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <SectionCard title="Hours for this date" icon="calendar">
      <div className="min-w-0 space-y-4">
      <label className="block text-sm font-semibold text-navy">Date<input aria-label="Exception date" type="date" className="input mt-1 min-h-11 min-w-0 text-base sm:text-sm" min={todayYmd()} value={date} onChange={e=>choose(e.target.value)} /></label>
      <p className="text-sm text-slate-600">Leave the hours empty to mark the whole date unavailable. Enter whole-hour ranges to replace that date's usual hours.</p>
      {ranges.map((r,i)=><div key={i} className="grid min-w-0 grid-cols-2 items-end gap-2 rounded-lg border border-brand-100 bg-brand-25 p-2 sm:gap-3 sm:p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        {['startTime','endTime'].map((key)=><label key={key} className="min-w-0 text-sm font-semibold text-navy">{key==='startTime'?'From':'Until'}<input aria-label={key+' '+i} type="time" step="3600" className="input mt-1 min-h-11 min-w-0 px-2 text-base sm:text-sm" value={r[key]} onChange={e=>setRanges(ranges.map((x,j)=>j===i?{...x,[key]:e.target.value}:x))} /></label>)}
        <button className="btn-outline col-span-2 min-h-11 sm:col-span-1" onClick={()=>setRanges(ranges.filter((_,j)=>j!==i))}>Remove hours</button>
      </div>)}
      <button className="btn-outline min-h-11 w-full sm:w-auto" disabled={ranges.length>=24} onClick={()=>setRanges([...ranges,{startTime:'09:00',endTime:'10:00'}])}>Add hours</button>
      <div className="flex flex-col gap-3 border-t border-brand-100 pt-4 sm:flex-row sm:flex-wrap"><button className="btn-primary min-h-11" disabled={busy||!date} onClick={()=>save()}>Save date</button><button className="btn-outline min-h-11" disabled={busy||!items.some(i=>i.date===date)} onClick={()=>save(true)}>Restore weekly hours</button></div>
      </div>
    </SectionCard>
    <SectionCard title="Saved date exceptions" icon="clock">
      <div className="space-y-3 text-sm text-slate-600">{items.length===0&&<p>No date exceptions saved.</p>}{items.map(i=><button className="block min-h-11 w-full break-words rounded-lg border border-brand-100 p-3 text-left text-navy hover:bg-brand-50" key={i.id} onClick={()=>choose(i.date)}>{i.date} · {i.ranges.length?i.ranges.map(r=>r.startTime+'–'+r.endTime).join(', '):'Unavailable all day'}</button>)}</div>
    </SectionCard>
    </div>
  </div>
}
