import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../components/ProtectedRoute'
export default function NotFound() {
  const { user } = useAuth()
  return (
    <main className="mx-auto max-w-xl px-5 py-16 text-center">
      <h1 className="text-3xl font-bold text-navy">Page not found</h1>
      <p className="mt-3 text-slate-600">The link may be out of date, or the page may have moved. You can return to your dashboard or find answers in Help & FAQs.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link to={user ? homeFor(user.role) : '/'} className="btn-primary min-h-11">{user ? 'My dashboard' : 'Go home'}</Link>
        <Link to={user?.role === 'PARENT' ? '/parent/help' : '/faq'} className="btn-outline min-h-11">Help & FAQs</Link>
      </div>
    </main>
  )
}
