import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import Logo from '../components/Logo'

// Public nav (matches the login / signup mockups). "Find a Tutor" needs an account, so it leads to Log In.
const footerLink = 'inline-flex min-h-9 items-center text-slate-700 hover:text-brand-600 hover:underline'

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
  const isHome = pathname === '/'
  const [menuOpen, setMenuOpen] = useState(false)
  // Only the in-page sections can be "current"; "Find a Tutor" just leads to Log In and must not light up on that page
  const isActive = (to) => to.startsWith('/#') && pathname === '/' && hash === to.slice(1)
  // The landing page body is a whiter blue than the app pages (the hero keeps the stronger blue)
  return (
    <div className={`min-h-screen overflow-x-clip ${isHome ? 'bg-gradient-to-b from-[#f9fbff] to-white' : ''}`}>
      {/* Plain full-width bar (no box or border), like the landing mockup */}
      <header className="relative z-20 w-full bg-white">
        <div className="mx-auto flex max-w-[81.25rem] items-center justify-between gap-3 px-4 py-2 md:px-8">
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
      <main className={`mx-auto max-w-[81.25rem] px-3 md:px-6 ${isHome ? '' : 'pb-10'}`}>
        <Outlet />
      </main>
      {/* Footer: light-blue band in the same container width as the sections. On the landing page it touches the CTA banner directly. */}
      <footer id="about" className={`scroll-mt-24 bg-brand-50 text-sm text-slate-700 ${isHome ? '' : 'mt-2'}`}>
        <div className="mx-auto grid max-w-[81.25rem] gap-8 px-4 py-8 md:px-8 lg:grid-cols-[26rem_1fr] lg:gap-16">
          <div>
            <Logo className="h-9" />
            <p className="mt-3 max-w-sm">A trusted tutoring platform connecting parents and tutors for a brighter tomorrow. Built with Wonderland Learning Materials &amp; Tuition Centre.</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-3 lg:max-w-2xl">
            <nav aria-label="Platform">
              <h2 className="mb-2 font-display text-base font-bold text-navy">Platform</h2>
              <ul className="space-y-1">
                <li><Link to="/login" className={footerLink}>Find a Tutor</Link></li>
                <li><a href="/#how-it-works" className={footerLink}>How It Works</a></li>
                <li><a href="/#for-parents" className={footerLink}>For Parents</a></li>
                <li><a href="/#for-tutors" className={footerLink}>For Tutors</a></li>
              </ul>
            </nav>
            <nav aria-label="Account">
              <h2 className="mb-2 font-display text-base font-bold text-navy">Account</h2>
              <ul className="space-y-1">
                <li><Link to="/login" className={footerLink}>Log In</Link></li>
                <li><Link to="/signup" className={footerLink}>Sign Up</Link></li>
              </ul>
            </nav>
            <div>
              <h2 className="mb-2 font-display text-base font-bold text-navy">Contact</h2>
              <p className="flex min-h-9 items-start gap-2 pt-1.5">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                Banting, Selangor, Malaysia
              </p>
            </div>
          </div>
        </div>
        <div className="mx-auto max-w-[81.25rem] px-4 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-1 border-t border-brand-200/70 py-4 text-sm text-slate-600">
            <span>&copy; {new Date().getFullYear()} WonderTutor. All rights reserved.</span>
            <span>Learn Today, Brighter Tomorrow.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
