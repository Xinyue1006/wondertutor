import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import Icon from '../../components/ui/Icon'
import { LoadError, Spinner } from '../../components/ui/Common'
import { fmtDateLong } from '../../lib/format'

// Verification status (mockup 07): where an unverified tutor lands, and what every locked tutor page points to.
// The status comes from GET /tutor/profile (derived on the server from the submit date and the document reviews).
const HEADLINE = {
  NOT_SUBMITTED: ['Profile not submitted', 'bg-accent-100 text-amber-900', 'Finish setting up your profile', 'Complete the setup and submit it. Admin then checks your documents before parents can find you.'],
  UNDER_REVIEW: ['Under review', 'bg-accent-100 text-amber-900', "We're reviewing your documents", "Admin checks your identity document and qualifications. You'll get a notification when there's a decision. Until then your profile isn't open for bookings."],
  CHANGES_REQUESTED: ['Changes requested', 'bg-red-50 text-red-700', 'A document is needed', 'One of your documents was not accepted or has been removed. Upload a new one and the review carries on.'],
  VERIFIED: ['Verified', 'bg-ok-50 text-green-800', "You're verified", 'Your profile shows the verified badge. Teaching features are now open.'],
}

export default function VerificationStatus() {
  const { user, setUser } = useAuth()
  const [p, setP] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await api.get('/tutor/profile')
      setP(res.data)
      // Admin may have decided since login: keep the menu and the page gate in step with the server
      if (res.data.status !== user.tutorStatus) setUser((u) => ({ ...u, tutorStatus: res.data.status }))
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [user.tutorStatus, setUser])
  useEffect(() => { load() }, [load])

  if (error) return <LoadError message={error} onRetry={load} />
  if (!p) return <Spinner />

  const [badge, badgeCls, title, text] = HEADLINE[p.status]
  const docs = p.documents
  const rejected = docs.filter((d) => d.status === 'REJECTED' && !docs.some((o) => o.kind === d.kind && o.status !== 'REJECTED'))
  // After submitting, a kind with no usable document left (rejected or removed) has to be uploaded again
  const missingKinds = p.submittedAt && p.status !== 'VERIFIED'
    ? [['IDENTITY', 'Identity document (NRIC or passport)'], ['QUALIFICATION', 'Qualification']].filter(([k]) => !docs.some((d) => d.kind === k && d.status !== 'REJECTED'))
    : []
  const firstName = p.fullName.split(' ')[0]

  // Review progress timeline: each line is done, current or still to come
  const timeline = [
    ['Email verified', p.email, p.isEmailVerified ? 'done' : 'current'],
    ['Profile submitted', p.submittedAt ? `Submitted ${fmtDateLong(p.submittedAt)}` : `${p.missing.length} item${p.missing.length === 1 ? '' : 's'} still to complete`, p.submittedAt ? 'done' : 'current'],
    ['Admin document review', p.status === 'CHANGES_REQUESTED' ? 'Waiting for a new document from you' : 'Identity document and qualification', p.status === 'VERIFIED' ? 'done' : p.submittedAt ? 'current' : 'todo'],
    ['Approved: verified badge and go live', 'Platform base commission rate applied', p.status === 'VERIFIED' ? 'done' : 'todo'],
  ]
  const dot = { done: 'bg-ok', current: 'bg-accent-600', todo: 'bg-slate-300' }
  const verified = p.status === 'VERIFIED'

  return (
    <div className="mx-auto max-w-[60rem] space-y-5 py-2">
      <section className="card flex flex-wrap items-start gap-5 p-6 md:p-8">
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${verified ? 'bg-ok-50 text-ok' : 'bg-accent-100 text-amber-800'}`}>
          <Icon name={verified ? 'check-circle' : 'clock'} className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${badgeCls}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> {badge}
          </span>
          <h1 className="mt-2 font-display text-2xl font-bold text-navy md:text-3xl">
            {p.status === 'UNDER_REVIEW' ? `Thanks, ${firstName}! ${title}.` : title}
          </h1>
          <p className="mt-2 max-w-2xl text-slate-600">{text}</p>
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-display text-lg font-bold text-navy">Review progress</h2>
          <ol className="mt-4 space-y-4">
            {timeline.map(([label, sub, state]) => (
              <li key={label} className="flex gap-3">
                <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${dot[state]}`} aria-hidden="true" />
                <span>
                  <b className={`block text-sm ${state === 'todo' ? 'text-slate-500' : 'text-navy'}`}>{label}</b>
                  <span className="text-xs text-slate-600">{sub}</span>
                  <span className="sr-only"> ({state === 'done' ? 'done' : state === 'current' ? 'in progress' : 'not started'})</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="space-y-5">
          <section className="card p-6">
            <h2 className="font-display text-lg font-bold text-navy">{verified ? 'Your portal' : 'While you wait'}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {[
                [true, 'Edit your profile, rate and bio'],
                [true, 'Preview how parents will see you'],
                [verified, 'Receive booking requests'],
                [verified, 'Set availability and withdraw earnings'],
              ].map(([open, label]) => (
                <li key={label} className="flex items-center gap-3">
                  <span className={`w-20 shrink-0 rounded-full px-2.5 py-1 text-center text-xs font-semibold ${open ? 'bg-ok-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{open ? 'Allowed' : 'Locked'}</span>
                  <span className="text-navy">{label}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              {p.status === 'NOT_SUBMITTED' ? (
                <Link to="/tutor/setup" className="btn-primary min-h-11 px-5">Continue setup</Link>
              ) : verified ? (
                <Link to="/tutor" className="btn-primary min-h-11 px-5">Go to dashboard</Link>
              ) : null}
              <Link to="/tutor/preview" className="btn-outline min-h-11 px-4">Preview my profile</Link>
              <Link to="/tutor/setup" className="btn-outline min-h-11 px-4">Edit profile</Link>
            </div>
          </section>

          {(rejected.length > 0 || missingKinds.length > 0) && (
            <section className="card border-red-200 p-6" aria-labelledby="changes-title">
              <span id="changes-title" className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> Changes requested
              </span>
              <ul className="mt-3 space-y-2 text-sm text-navy">
                {rejected.map((d) => (
                  <li key={d.id}><b>{d.title}</b>{d.reviewNote ? `: ${d.reviewNote}` : ''}</li>
                ))}
                {missingKinds.filter(([k]) => !rejected.some((d) => d.kind === k)).map(([k, label]) => (
                  <li key={k}><b>{label}</b>: none uploaded</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-600">Upload only that document again; the review restarts from that step.</p>
              <Link to="/tutor/setup" state={{ step: 'documents' }} className="btn-outline mt-3 min-h-11 border-red-200 px-4 text-red-700">Re-upload document</Link>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
