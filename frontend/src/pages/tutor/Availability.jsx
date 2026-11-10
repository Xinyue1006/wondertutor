import { useEffect, useState } from 'react'
import api, { errorMessage } from '../../api/client'
import { PageTitle, ErrorBox } from '../../components/ui/Common'
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
  return <div className="max-w-3xl space-y-4">
    <PageTitle title="Date-specific Availability" subtitle="Set different hours for a particular date. Your usual weekly hours apply to other dates." />
    <ErrorBox>{error}</ErrorBox>
    <div className="card space-y-4 p-5">
      <label className="block">Date<input aria-label="Exception date" type="date" className="input" min={todayYmd()} value={date} onChange={e=>choose(e.target.value)} /></label>
      <p>Leave the hours empty to mark the whole date unavailable. Enter whole-hour ranges to replace that date's usual hours.</p>
      {ranges.map((r,i)=><div key={i} className="flex flex-wrap items-center gap-3">
        {['startTime','endTime'].map((key)=><label key={key}>{key==='startTime'?'From':'Until'}<input aria-label={key+' '+i} type="time" step="3600" className="input" value={r[key]} onChange={e=>setRanges(ranges.map((x,j)=>j===i?{...x,[key]:e.target.value}:x))} /></label>)}
        <button className="btn-outline" onClick={()=>setRanges(ranges.filter((_,j)=>j!==i))}>Remove hours</button>
      </div>)}
      <button className="btn-outline" disabled={ranges.length>=24} onClick={()=>setRanges([...ranges,{startTime:'09:00',endTime:'10:00'}])}>Add hours</button>
      <div className="flex gap-3"><button className="btn-primary" disabled={busy||!date} onClick={()=>save()}>Save date</button><button className="btn-outline" disabled={busy||!items.some(i=>i.date===date)} onClick={()=>save(true)}>Restore weekly hours</button></div>
    </div>
    <div className="card space-y-3 p-5"><h2 className="font-bold">Saved date exceptions</h2>{items.length===0&&<p>No date exceptions saved.</p>}{items.map(i=><button className="block w-full rounded-lg border p-3 text-left" key={i.id} onClick={()=>choose(i.date)}>{i.date} · {i.ranges.length?i.ranges.map(r=>r.startTime+'–'+r.endTime).join(', '):'Unavailable all day'}</button>)}</div>
  </div>
}
