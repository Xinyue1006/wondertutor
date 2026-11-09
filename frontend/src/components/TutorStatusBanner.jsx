import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from './ui/Icon'

// Reminder at the top of the tutor pages until the tutor is verified. Nothing is locked without verification;
// the banner says what the tutor gains (badge, higher in search) and what to do next.
// Hidden on My Profile, which already shows the verification status.
const MESSAGES = {
  NOT_SUBMITTED: {
    text: 'Finish your profile so parents can find and book you. Submit your documents to get the verified badge and appear higher in search.',
    to: '/tutor/setup',
    cta: 'Complete profile',
  },
  UNDER_REVIEW: {
    text: "Your documents are being reviewed. You'll get the verified badge and appear higher in search once Admin approves them.",
    to: '/tutor/setup',
    cta: 'View status',
  },
  CHANGES_REQUESTED: {
    text: 'Admin needs a new document from you before you can get the verified badge.',
    to: '/tutor/setup',
    cta: 'See what is needed',
  },
}

export default function TutorStatusBanner() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const message = MESSAGES[user?.tutorStatus]
  if (!message || pathname.startsWith('/tutor/setup')) return null

  return (
    <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-accent-100 bg-accent-50 px-4 py-3 text-sm text-amber-900">
      <Icon name="info" className="h-5 w-5 shrink-0" />
      <p className="min-w-0 flex-1 basis-60">{message.text}</p>
      <Link to={message.to} className="btn-outline min-h-11 shrink-0 border-amber-300 bg-white px-4 text-amber-900">{message.cta}</Link>
    </div>
  )
}
