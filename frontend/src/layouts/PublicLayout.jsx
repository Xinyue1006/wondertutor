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
    <div className="min-h-screen pb-10">
      {/* Plain full-width bar (no box or border), like the landing mockup */}
      <header className="w-full bg-white">
        <div className="mx-auto flex max-w-[1300px] items-center justify-between gap-4 px-4 py-3 md:px-8">
          <Link to="/"><Logo className="h-9" /></Link>
          <nav className="hidden items-center gap-8 text-[13px] font-medium text-navy lg:flex">
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
      <main className="mx-auto max-w-[1300px] px-3 md:px-6">
        <Outlet />
      </main>
      <footer id="about" className="mx-auto mt-14 max-w-[1300px] px-3 md:px-6 scroll-mt-24 border-t border-brand-100 pt-8 text-xs text-slate-500">
        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo className="h-8" />
            <p className="mt-3 max-w-xs">A trusted tutoring platform connecting parents and tutors for a brighter tomorrow. Built with Wonderland Learning Materials &amp; Tuition Centre, Banting.</p>
          </div>
          <div>
            <div className="mb-2 font-bold text-navy">Platform</div>
            <ul className="space-y-1.5">
              <li><Link to="/login" className="hover:text-brand-500">Find a Tutor</Link></li>
              <li><a href="/#how-it-works" className="hover:text-brand-500">How It Works</a></li>
              <li><a href="/#for-parents" className="hover:text-brand-500">For Parents</a></li>
              <li><a href="/#for-tutors" className="hover:text-brand-500">For Tutors</a></li>
            </ul>
          </div>
          <div>
            <div className="mb-2 font-bold text-navy">Account</div>
            <ul className="space-y-1.5">
              <li><Link to="/login" className="hover:text-brand-500">Log In</Link></li>
              <li><Link to="/signup" className="hover:text-brand-500">Sign Up</Link></li>
            </ul>
          </div>
          <div>
            <div className="mb-2 font-bold text-navy">Contact</div>
            <ul className="space-y-1.5"><li>Banting, Selangor, Malaysia</li></ul>
          </div>
        </div>
        <div className="mt-8 border-t border-brand-100 py-4 text-center">&copy; {new Date().getFullYear()} WonderTutor. All rights reserved.</div>
      </footer>
    </div>
  )
}
