import { Link, Outlet, useLocation } from 'react-router-dom'
import Logo from '../components/Logo'

// Public nav (matches the login / signup mockups). "Find a Tutor" needs an account, so it leads to Log In.
const LINKS = [
  ['Find a Tutor', '/login'],
  ['How It Works', '/#how-it-works'],
  ['For Parents', '/#for-parents'],
  ['For Tutors', '/#for-tutors'],
  ['About Us', '/#about'],
]

export default function PublicLayout() {
  const { pathname } = useLocation()
  return (
    <div className="min-h-screen px-3 pb-10 pt-3 md:px-6">
      <header className="mx-auto max-w-[1300px] rounded-2xl bg-white/90 shadow-card backdrop-blur">
        <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-6">
          <Link to="/"><Logo className="h-9" /></Link>
          <nav className="hidden items-center gap-7 text-[13px] font-medium text-navy lg:flex">
            {LINKS.map(([label, to]) => (
              <a key={label} href={to} className="hover:text-brand-500">{label}</a>
            ))}
          </nav>
          <div className="flex gap-2">
            <Link to="/login" className={`btn-outline px-5 py-1.5 ${pathname === '/login' ? 'bg-brand-50' : ''}`}>Log In</Link>
            <Link to="/signup" className="btn-accent px-5 py-1.5">Sign Up</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1300px]">
        <Outlet />
      </main>
    </div>
  )
}
