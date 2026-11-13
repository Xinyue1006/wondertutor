import { Link } from 'react-router-dom'
import { useState } from 'react'
import { PageTitle, SectionCard } from '../../components/ui/Common'
import { Records } from '../../components/ui/AdminRecords'
import { useRecords } from '../../lib/adminRecords'
import { fmtDate } from '../../lib/format'

export default function Students() {
  const source = useRecords('/tutor/bookings')
  const [query,setQuery] = useState('')
  return <div className="space-y-4"><PageTitle title="My students" /><SectionCard title="Student lessons"><label>Find a student<input className="input text-base" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <Records source={source}>{({bookings}) => {
      const students = new Map()
      for (const b of bookings) {
        if (!['CONFIRMED','COMPLETED','DISPUTED'].includes(b.status) || !b.child.name.toLowerCase().includes(query.toLowerCase())) continue
        if (!students.has(b.child.id)) students.set(b.child.id, [])
        students.get(b.child.id).push(b)
      }
      return students.size ? [...students].map(([id,lessons]) => <details key={id} className="border-b py-3"><summary className="cursor-pointer py-2">{lessons[0].child.name} · {lessons[0].child.grade} · {lessons.length} lessons</summary><ul>{lessons.map(b => <li key={b.id}><Link className="inline-block py-3 underline" to={'/tutor/bookings/' + b.id + '/session'}>{fmtDate(b.startAt)} · {b.subject} · {b.status.toLowerCase()}</Link></li>)}</ul></details>) : <p className="mt-3">No matching students.</p>
    }}</Records></SectionCard></div>
}
