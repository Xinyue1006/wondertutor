import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { LoadError } from './ui/Common'

// Blocks a route unless the user is logged in AND has one of the allowed roles.
// A logged-out visitor is sent to Log In and remembered where they were going, so they land there afterwards.
export default function ProtectedRoute({ roles }) {
  const { user, loading, sessionError, sessionEnd, refreshSession } = useAuth()
  const location = useLocation()
  if (loading) return <div className="p-10 text-center text-slate-500">Loading...</div>
  if (!user && sessionError) return <LoadError message={sessionError} onRetry={refreshSession} />
  // Previously shared profile links now have a safe public equivalent. Booking,
  // family and payment routes still follow the normal authentication guard.
  const publicTutor = !user && roles?.length === 1 && roles[0] === 'PARENT'
    ? location.pathname.match(/^\/parent\/tutors\/([1-9]\d*)\/?$/)
    : null
  if (publicTutor) return <Navigate to={`/tutors/${publicTutor[1]}${location.search}`} replace />
  if (!user) return <Navigate to={roles?.length === 1 && roles[0] === 'ADMIN' ? '/admin/login' : '/login'} replace
    state={sessionEnd?.reason === 'logout' ? null : { from: location.pathname + location.search, ...(sessionEnd?.userId != null && { fromUserId: sessionEnd.userId }) }} />
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return <Outlet />
}

export function homeFor(role) {
  return { PARENT: '/parent', TUTOR: '/tutor', ADMIN: '/admin' }[role] || '/'
}

// Where to go after logging in: the page the user was trying to open, but only inside their own portal
// (a parent is never sent to /admin) and only a path on this site; otherwise their home page.
export function afterLogin(user, from, fromUserId) {
  const home = homeFor(user.role)
  if (fromUserId != null && String(fromUserId) !== String(user.id)) return home
  const ok = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && from.split('?')[0] !== '/admin/login' && (from === home || from.startsWith(`${home}/`) || from.startsWith(`${home}?`))
  return ok ? from : home
}
