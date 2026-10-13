import { useEffect, useState } from 'react'
import api, { errorMessage } from '../api/client'
import Icon from './ui/Icon'
import { ErrorBox, Modal, Spinner } from './ui/Common'
import { addDaysYmd, dateLabel, fmtDateLong, fmtTimeRange, hhmmLabel, mondayOfYmd, todayYmd } from '../lib/format'

// Ask the tutor for a new lesson time. Only the tutor's free 1-hour slots are offered, week by week,
// so the parent cannot pick a time the tutor cannot teach. The tutor then accepts, or Admin decides.
export default function RescheduleModal({ booking, onClose, onSubmit }) {
  const [week, setWeek] = useState(() => mondayOfYmd(todayYmd()))
  const [days, setDays] = useState(null)
  const [pick, setPick] = useState(null) // { date, start }
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!booking) return
    setDays(null)
    api.get(`/parent/tutors/${booking.tutor.id}/slots`, { params: { from: week } })
      .then((r) => setDays(r.data.days))
      .catch((e) => setError(errorMessage(e)))
  }, [booking, week])

  if (!booking) return null
  const thisWeek = mondayOfYmd(todayYmd())

  async function submit() {
    if (!pick) return setError('Choose a new time first.')
    setBusy(true)
    setError('')
    const problem = await onSubmit({ date: pick.date, startTime: pick.start, reason: reason.trim() || undefined })
    setBusy(false)
    if (problem) setError(problem)
  }

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title="Request a new lesson time"
      footer={<>
        <button onClick={onClose} className="btn-outline">Keep current time</button>
        <button disabled={busy || !pick} onClick={submit} className="btn-primary">{busy ? 'Sending…' : 'Send Request'}</button>
      </>}
    >
      <p className="text-sm text-slate-700">
        Now: <b className="text-navy">{fmtDateLong(booking.startAt)}, {fmtTimeRange(booking.startAt, booking.endAt)}</b> with {booking.tutor.name}.
        The lesson only moves if the tutor agrees. If not, our admin team decides.
      </p>

      <div className="mt-4 flex items-center justify-between">
        <button type="button" className="btn-outline min-h-10 px-3" disabled={week <= thisWeek} onClick={() => setWeek(addDaysYmd(week, -7))} aria-label="Previous week"><Icon name="left" className="h-4 w-4" /></button>
        <span className="text-sm font-semibold text-navy">Week of {dateLabel(week)}</span>
        <button type="button" className="btn-outline min-h-10 px-3" disabled={week >= addDaysYmd(thisWeek, 21)} onClick={() => setWeek(addDaysYmd(week, 7))} aria-label="Next week"><Icon name="right" className="h-4 w-4" /></button>
      </div>

      <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
        {!days ? <Spinner /> : days.every((d) => !d.slots.some((s) => s.status === 'available')) ? (
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">No free times this week. Try the next week.</p>
        ) : days.map((d) => {
          const free = d.slots.filter((s) => s.status === 'available')
          if (!free.length) return null
          return (
            <div key={d.date}>
              <div className="mb-1.5 text-sm font-semibold text-navy">{dateLabel(d.date)}</div>
              <div className="flex flex-wrap gap-2">
                {free.map((s) => {
                  const on = pick?.date === d.date && pick?.start === s.start
                  return (
                    <button key={s.start} type="button" aria-pressed={on} onClick={() => setPick({ date: d.date, start: s.start })} className={`chip min-h-10 ${on ? 'chip-on' : ''}`}>
                      {hhmmLabel(s.start)}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <label className="mt-4 block text-sm font-semibold text-navy">Reason for the tutor (optional)
        <textarea rows={2} maxLength={200} className="input mt-1 resize-none" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. School event on the original day" />
      </label>
      <ErrorBox className="mt-3">{error}</ErrorBox>
    </Modal>
  )
}
