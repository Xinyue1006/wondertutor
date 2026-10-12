import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

// Blocks a route unless the user is logged in AND has one of the allowed roles
export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="p-10 text-center text-slate-500">Loading...</div>
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />
  return <Outlet />
}

export function homeFor(role) {
  return { PARENT: '/parent', TUTOR: '/tutor', ADMIN: '/admin' }[role] || '/'
}
