import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Blocks a route unless the user is logged in AND has one of the allowed roles.
// A logged-out visitor is sent to Log In and remembered where they were going, so they land there afterwards.
export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="p-10 text-center text-slate-500">Loading...</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return <Outlet />
}

export function homeFor(role) {
  return { PARENT: '/parent', TUTOR: '/tutor', ADMIN: '/admin' }[role] || '/'
}

// A tutor who is not verified yet can only use the onboarding pages (the server enforces the same rule)
export const TUTOR_ONBOARDING = ['/tutor/setup', '/tutor/verification', '/tutor/preview']
export const isUnverifiedTutor = (user) => user?.role === 'TUTOR' && user.tutorStatus !== 'VERIFIED'
const tutorStart = (user) => (user.tutorStatus === 'NOT_SUBMITTED' ? '/tutor/setup' : '/tutor/verification')

// Where to go after logging in: the page the user was trying to open, but only inside their own portal
// (a parent is never sent to /admin) and only a path on this site; otherwise their home page.
// An unverified tutor goes to the setup (draft) or the verification status page instead of the dashboard.
export function afterLogin(user, from) {
  const home = homeFor(user.role)
  const ok = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && (from === home || from.startsWith(`${home}/`) || from.startsWith(`${home}?`))
  if (isUnverifiedTutor(user)) return ok && TUTOR_ONBOARDING.some((p) => from.startsWith(p)) ? from : tutorStart(user)
  return ok ? from : home
}

// Wraps the tutor pages that need Admin verification (dashboard, availability, bookings, earnings).
// An unverified tutor is sent to the verification status page, which explains what is still locked and why.
export function VerifiedTutorRoute() {
  const { user } = useAuth()
  if (isUnverifiedTutor(user)) return <Navigate to="/tutor/verification" replace />
  return <Outlet />
}
