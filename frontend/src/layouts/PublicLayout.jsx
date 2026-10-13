import { useState } from 'react'
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

// The current page is marked with a yellow underline (and aria-current), so it is not shown by colour alone
function NavLink({ label, to, active }) {
  return (
    <a href={to} aria-current={active ? 'page' : undefined} className={`flex min-h-11 items-center border-b-[3px] ${active ? 'border-accent text-brand-500' : 'border-transparent hover:text-brand-500'}`}>
      {label}
    </a>
  )
}

export default function PublicLayout() {
  const { pathname, hash } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const isActive = (to) => (to.startsWith('/#') ? pathname === '/' && hash === to.slice(1) : pathname === to)
  // The landing page body is a whiter blue than the app pages (the hero keeps the stronger blue)
  return (
    <div className={`min-h-screen overflow-x-clip pb-10 ${pathname === '/' ? 'bg-gradient-to-b from-[#f9fbff] to-white' : ''}`}>
      {/* Plain full-width bar (no box or border), like the landing mockup */}
      <header className="relative z-20 w-full bg-white">
        <div className="mx-auto flex max-w-[1300px] items-center justify-between gap-3 px-4 py-2 md:px-8">
          <Link to="/" aria-label="WonderTutor home" className="flex min-h-11 items-center">
            {/* The compact "W" mark on phones keeps room for the Log In / Sign Up buttons */}
            <Logo mark className="h-9 sm:hidden" />
            <Logo className="hidden h-9 sm:block" />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-7 text-sm font-medium text-navy lg:flex">
            {LINKS.map(([label, to]) => <NavLink key={label} label={label} to={to} active={isActive(to)} />)}
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" aria-current={pathname === '/login' ? 'page' : undefined} className={`btn-outline min-h-11 px-4 sm:px-5 ${pathname === '/login' ? 'bg-brand-50' : ''}`}>Log In</Link>
            <Link to="/signup" aria-current={pathname === '/signup' ? 'page' : undefined} className="btn-accent min-h-11 px-4 sm:px-5">Sign Up</Link>
            <button
              type="button"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-navy hover:bg-brand-50 lg:hidden"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              onClick={() => setMenuOpen((o) => !o)}
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {menuOpen ? <path d="M18 6L6 18M6 6l12 12" /> : <path d="M3 6h18M3 12h18M3 18h18" />}
              </svg>
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav id="mobile-menu" aria-label="Mobile" className="border-t border-brand-100 bg-white px-4 py-2 lg:hidden">
            <ul>
              {LINKS.map(([label, to]) => (
                <li key={label}>
                  <a href={to} onClick={() => setMenuOpen(false)} aria-current={isActive(to) ? 'page' : undefined} className={`flex min-h-11 items-center text-base font-medium ${isActive(to) ? 'text-brand-500' : 'text-navy'}`}>{label}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>
      <main className="mx-auto max-w-[1300px] px-3 md:px-6">
        <Outlet />
      </main>
      <footer id="about" className="mx-auto mt-14 max-w-[1300px] px-3 md:px-6 scroll-mt-24 border-t border-brand-100 pt-8 text-sm text-slate-600">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo className="h-8" />
            <p className="mt-3 max-w-xs">A trusted tutoring platform connecting parents and tutors for a brighter tomorrow. Built with Wonderland Learning Materials &amp; Tuition Centre, Banting.</p>
          </div>
          <div>
            <div className="mb-2 font-bold text-navy">Platform</div>
            <ul className="space-y-1">
              <li><Link to="/login" className="inline-flex min-h-9 items-center hover:text-brand-500 hover:underline">Find a Tutor</Link></li>
              <li><a href="/#how-it-works" className="inline-flex min-h-9 items-center hover:text-brand-500 hover:underline">How It Works</a></li>
              <li><a href="/#for-parents" className="inline-flex min-h-9 items-center hover:text-brand-500 hover:underline">For Parents</a></li>
              <li><a href="/#for-tutors" className="inline-flex min-h-9 items-center hover:text-brand-500 hover:underline">For Tutors</a></li>
            </ul>
          </div>
          <div>
            <div className="mb-2 font-bold text-navy">Account</div>
            <ul className="space-y-1">
              <li><Link to="/login" className="inline-flex min-h-9 items-center hover:text-brand-500 hover:underline">Log In</Link></li>
              <li><Link to="/signup" className="inline-flex min-h-9 items-center hover:text-brand-500 hover:underline">Sign Up</Link></li>
            </ul>
          </div>
          <div>
            <div className="mb-2 font-bold text-navy">Contact</div>
            <ul className="space-y-1"><li>Banting, Selangor, Malaysia</li></ul>
          </div>
        </div>
        <div className="mt-8 border-t border-brand-100 py-4 text-center text-xs">&copy; {new Date().getFullYear()} WonderTutor. All rights reserved.</div>
      </footer>
    </div>
  )
}
