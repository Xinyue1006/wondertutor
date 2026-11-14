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

function documentStatus(profile, kind) {
  const docs = profile.documents.filter(d => d.kind === kind)
  if (docs.some(d => d.status === 'APPROVED')) return 'Approved'
  if (docs.some(d => d.status === 'PENDING')) return profile.submittedAt ? 'Awaiting admin review' : 'Uploaded · ready to submit'
  return docs.length ? 'Replacement needed' : 'None uploaded'
}

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
      <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-3">
        {[
          ['Email address', profile.isEmailVerified ? 'Verified' : 'Unverified'],
          ['Qualification', documentStatus(profile, 'QUALIFICATION')],
          ['Verified tutor badge', profile.isVerified ? 'Awarded' : 'Not awarded'],
        ].map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-brand-25 p-3">
          <dt className="text-sm text-slate-600">{label}</dt>
          <dd className="font-semibold text-navy">{value}</dd>
        </div>)}
      </dl>
      <p className="mt-3 text-sm"><strong>Identity document:</strong> {documentStatus(profile, 'IDENTITY')}. The badge requires an approved identity document and at least one approved qualification.</p>
      {!profile.isVerified && <p className="mt-2 font-semibold text-navy">You can accept booking requests before you earn the badge.</p>}
      <p className="mt-2 text-sm text-slate-600">{text}</p>

      {needsDocument && (
        <ul className="mt-3 space-y-1 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-navy">
          {rejected.map((d) => <li key={d.id}><b>{d.title}</b>{d.reviewNote ? `: ${d.reviewNote}` : ''}</li>)}
          {missing.map(([kind, label]) => <li key={kind}><b>{label}</b>: none uploaded</li>)}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {needsDocument && onUpload && <button type="button" onClick={onUpload} className="btn-primary min-h-11 px-4">Upload a new document</button>}
        {!onUpload && <Link to="/tutor/setup" state={{ step: 'documents' }} className="btn-outline min-h-11 px-4">Manage verification documents</Link>}
        <Link to="/tutor/preview" className="btn-outline min-h-11 px-4">Preview my profile</Link>
      </div>
    </section>
  )
})

export default VerificationCard
