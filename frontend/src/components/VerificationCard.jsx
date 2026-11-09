import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { fmtDateLong } from '../lib/format'

// Verification summary at the top of My Profile. The status comes from GET /tutor/profile (derived on the server
// from the submit date and the document reviews). Verification only adds the badge and search priority.
const STATUS = {
  NOT_SUBMITTED: ['Not submitted', 'bg-accent-100 text-amber-900', 'Submit your documents to get the verified badge and appear higher when parents search.'],
  UNDER_REVIEW: ['Under review', 'bg-accent-100 text-amber-900', "Admin is checking your identity document and qualifications. You'll get a notification when there's a decision."],
  CHANGES_REQUESTED: ['Changes requested', 'bg-red-50 text-red-700', 'One of your documents was not accepted or has been removed. Upload a new one and the review carries on.'],
  VERIFIED: ['Verified', 'bg-ok-50 text-green-800', 'Your profile shows the verified badge, and you appear before unverified tutors when parents search.'],
}

const KINDS = [['IDENTITY', 'Identity document (NRIC or passport)'], ['QUALIFICATION', 'Qualification']]

const VerificationCard = forwardRef(function VerificationCard({ profile, onUpload }, ref) {
  const [badge, badgeCls, text] = STATUS[profile.status]
  const docs = profile.documents
  const usable = (kind) => docs.some((d) => d.kind === kind && d.status !== 'REJECTED')
  const rejected = docs.filter((d) => d.status === 'REJECTED' && !usable(d.kind))
  // After submitting, a kind with no usable document left has to be uploaded again
  const missing = profile.submittedAt && profile.status !== 'VERIFIED'
    ? KINDS.filter(([kind]) => !usable(kind) && !rejected.some((d) => d.kind === kind))
    : []
  const needsDocument = rejected.length > 0 || missing.length > 0

  return (
    <section ref={ref} aria-labelledby="verification-title" className="card mb-5 p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="verification-title" className="font-display text-lg font-bold text-navy">Verification</h2>
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${badgeCls}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> {badge}
        </span>
        {profile.submittedAt && <span className="text-xs text-slate-600">Submitted {fmtDateLong(profile.submittedAt)}</span>}
      </div>
      <p className="mt-2 text-sm text-slate-600">{text}</p>

      {needsDocument && (
        <ul className="mt-3 space-y-1 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-navy">
          {rejected.map((d) => <li key={d.id}><b>{d.title}</b>{d.reviewNote ? `: ${d.reviewNote}` : ''}</li>)}
          {missing.map(([kind, label]) => <li key={kind}><b>{label}</b>: none uploaded</li>)}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {needsDocument && <button type="button" onClick={onUpload} className="btn-primary min-h-11 px-4">Upload a new document</button>}
        <Link to="/tutor/preview" className="btn-outline min-h-11 px-4">Preview my profile</Link>
      </div>
    </section>
  )
})

export default VerificationCard
