import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Icon from './ui/Icon'

const bookingPath = (tutorId, mode) => `/parent/tutors/${tutorId}/book${['ONLINE', 'PHYSICAL'].includes(mode) ? `?mode=${mode}` : ''}`

// Guests can inspect public teaching information first. Only a booking needs
// the parent's private child details and authenticated booking workflow.
export function PublicBookLink({ tutorId, mode, className = 'btn-primary min-h-11', children = 'Book a Lesson' }) {
  const { user } = useAuth() || {}
  const route = useLocation()
  const lessonMode = mode || new URLSearchParams(route.search).get('mode')
  if (user && user.role !== 'PARENT') return <span className="text-sm text-slate-600">Use a parent account to book lessons.</span>
  const from = bookingPath(tutorId, lessonMode)
  return <Link to={user ? from : '/login'} state={user ? undefined : { from }} className={className}>{children}</Link>
}

export default function PublicBookingActions({ tutor }) {
  const { user } = useAuth() || {}
  const mode = new URLSearchParams(useLocation().search).get('mode')
  return (
    <aside className="card min-w-0 p-5 xl:sticky xl:top-24">
      <h2 className="flex items-center gap-2 text-xl font-bold text-navy"><Icon name="calendar" className="h-5 w-5 text-brand-500" /> Book a Lesson</h2>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">Explore this tutor's teaching information, qualifications, availability and parent reviews before deciding.</p>
      <p className="mt-3 text-lg font-bold text-navy">RM {tutor.hourlyRate} <span className="text-sm font-normal text-slate-500">/ hour</span></p>
      <p className="mt-2 text-sm text-slate-600">Choose lessons and send a request. Your booking is confirmed after the tutor accepts and you pay.</p>
      <div className="mt-5"><PublicBookLink tutorId={tutor.id} className="btn-primary min-h-12 w-full">{user?.role === 'PARENT' ? 'Continue to Booking' : 'Log In to Book'}</PublicBookLink></div>
      {!user && <>
        <Link to="/signup" state={{ from: bookingPath(tutor.id, mode) }} className="btn-outline mt-3 min-h-11 w-full">Create a Parent Account</Link>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">An account keeps your child's information, lesson requests and payments private.</p>
      </>}
    </aside>
  )
}
