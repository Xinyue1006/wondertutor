import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import Avatar from '../components/ui/Avatar'
import Icon from '../components/ui/Icon'
import { useClickOutside } from '../components/ui/Common'
import { useAuth } from '../context/AuthContext'
import api from '../api/client'
import { timeAgo } from '../lib/format'
import { MatchingProvider } from '../assistant/MatchingContext'
import AssistantWidget from '../assistant/AssistantWidget'

// Top nav items per role (matches the UI_v1 mockups)
const NAV = {
  PARENT: [
    ['/parent', 'Dashboard'],
    ['/parent/find-tutor', 'Find a Tutor'],
    ['/parent/bookings', 'My Bookings'],
    ['/parent/children', 'My Children'],
    ['/parent/payments', 'Payments'],
  ],
  TUTOR: [
    ['/tutor', 'Dashboard'],
    ['/tutor/availability', 'Availability'],
    ['/tutor/bookings', 'Bookings'],
    ['/tutor/students', 'Students'],
    ['/tutor/earnings', 'Earnings'],
  ],
  ADMIN: [
    ['/admin', 'Dashboard'],
    ['/admin/users', 'Users'],
    ['/admin/bookings', 'Bookings'],
    ['/admin/finance', 'Finance'],
    ['/admin/complaints', 'Complaints'],
    ['/admin/settings', 'Settings'],
  ],
}

// A tutor waiting for Admin verification only sees the onboarding pages (see VerifiedTutorRoute)
const TUTOR_ONBOARDING_NAV = [
  ['/tutor/verification', 'Verification status'],
  ['/tutor/setup', 'Profile setup'],
  ['/tutor/preview', 'Preview profile'],
]

export default function AppLayout() {
  const { user } = useAuth()
  const items = user.role === 'TUTOR' && user.tutorStatus !== 'VERIFIED' ? TUTOR_ONBOARDING_NAV : NAV[user.role] || []
  const isParent = user.role === 'PARENT'

  const shell = (
    <div className="flex min-h-screen flex-col">
      {/* Same bar as the public pages (landing, login, signup): flat, full width, white, yellow underline on the current page */}
      <header className="sticky top-0 z-30 w-full bg-white">
        <div className="mx-auto flex max-w-[81.25rem] items-center justify-between gap-3 px-4 py-2 md:px-8">
          <Link to={items[0]?.[0] || '/'} aria-label="WonderTutor dashboard" className="flex min-h-11 shrink-0 items-center"><Logo className="h-9" /></Link>
          <nav aria-label="Main" className="hidden items-center gap-4 text-sm font-medium text-navy lg:flex xl:gap-7">
            {items.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to.split('/').length === 2}
                className={({ isActive }) =>
                  `flex min-h-11 items-center whitespace-nowrap border-b-[3px] transition ${
                    isActive ? 'border-accent text-brand-500' : 'border-transparent hover:text-brand-500'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2 md:gap-4">
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
        {/* Phone: nav moves to a horizontal scroller */}
        <nav aria-label="Main" className="mx-auto flex max-w-[81.25rem] gap-2 overflow-x-auto px-4 pb-2 lg:hidden">
          {items.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to.split('/').length === 2}
              className={({ isActive }) =>
                `flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-medium ${isActive ? 'bg-brand-500 text-white' : 'bg-brand-50 text-navy'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[81.25rem] flex-1 px-3 pb-16 pt-6 md:px-6">
        <Outlet />
      </main>
      <AppFooter items={items} />
      {isParent && <AssistantWidget />}
    </div>
  )

  // The assistant + matching state only exists in the Parent Portal
  return isParent ? <MatchingProvider>{shell}</MatchingProvider> : shell
}

function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickOutside(ref, useCallback(() => setOpen(false), []))

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 rounded-xl px-1 py-1 hover:bg-brand-50">
        <Avatar src={user.profilePhotoUrl} name={user.fullName} className="h-10 w-10" />
        <span className="hidden text-left leading-tight sm:block lg:hidden xl:block">
          <span className="block text-sm font-semibold text-navy">{user.fullName}</span>
          <span className="block text-xs capitalize text-slate-500">{user.role.toLowerCase()}</span>
        </span>
        <Icon name="down" className="h-4 w-4 text-navy" />
      </button>
      {open && (
        <div className="pop-in absolute right-0 top-14 z-40 w-52 rounded-xl border border-brand-100 bg-white p-1.5 shadow-xl">
          {user.role === 'PARENT' && (
            <>
              <Link to="/parent/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-navy hover:bg-brand-50">
                <Icon name="settings" className="h-4 w-4" /> My Profile
              </Link>
              <Link to="/parent/children" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-navy hover:bg-brand-50">
                <Icon name="user" className="h-4 w-4" /> My Children
              </Link>
              <Link to="/parent/favourites" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-navy hover:bg-brand-50">
                <Icon name="heart" className="h-4 w-4" /> Saved Tutors
              </Link>
            </>
          )}
          {user.role === 'PARENT' && (
            <Link to="/parent/complaints" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-navy hover:bg-brand-50">
              <Icon name="shield" className="h-4 w-4" /> My Complaints
            </Link>
          )}
          <button
            onClick={() => { logout(); navigate('/login') }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            <Icon name="logout" className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
    </div>
  )
}

// Bell icon with unread dot + dropdown list (in-app notifications)
function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState({ unread: 0, notifications: [] })
  const ref = useRef(null)
  useClickOutside(ref, useCallback(() => setOpen(false), []))

  const load = useCallback(() => api.get('/notifications').then((r) => setData(r.data)).catch(() => {}), [])
  useEffect(() => {
    load()
    // Light polling so new booking replies show up without a refresh; skipped while the tab is in the background
    const t = setInterval(() => { if (!document.hidden) load() }, 60000)
    return () => clearInterval(t)
  }, [load])

  async function openItem(n) {
    setOpen(false)
    if (!n.isRead) await api.post(`/notifications/${n.id}/read`).catch(() => {})
    load()
    if (n.link) navigate(n.link)
  }

  return (
    <div className="relative" ref={ref} onKeyDown={(e) => { if (e.key === 'Escape' && open) setOpen(false) }}>
      <button
        onClick={() => { setOpen((o) => !o); if (!open) load() }}
        className="relative rounded-full p-2 text-brand-500 hover:bg-brand-50"
        aria-label={data.unread ? `Notifications, ${data.unread} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Icon name="bell" className="h-6 w-6" />
        {data.unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-none text-white ring-2 ring-white" aria-hidden="true">
            {data.unread > 9 ? '9+' : data.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="pop-in absolute right-0 top-12 z-40 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-brand-100 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="font-bold text-navy">Notifications</span>
            {data.unread > 0 && (
              <button
                className="text-xs font-semibold text-brand-500 hover:underline"
                onClick={() => api.post('/notifications/read-all').then(load).catch(() => {})}
              >
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data.notifications.length === 0 && <p className="p-6 text-center text-sm text-slate-500">You're all caught up.</p>}
            {data.notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={`flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-brand-50 ${n.isRead ? '' : 'bg-brand-25'}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.isRead ? 'bg-transparent' : 'bg-brand-500'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-navy">{n.title}</span>
                  <span className="line-clamp-3 block text-xs text-slate-600">{n.message}</span>
                  <span className="mt-0.5 block text-[11px] text-slate-400">{timeAgo(n.createdAt)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Footer for the signed-in portals. Different from the public footer: it is about using the portal
// (shortcuts, account, where to get help), not about marketing the platform.
const ACCOUNT_LINKS = {
  PARENT: [['/parent/profile', 'My Profile'], ['/parent/children', 'My Children'], ['/parent/favourites', 'Saved Tutors'], ['/parent/complaints', 'My Complaints']],
  TUTOR: [],
  ADMIN: [],
}
const HELP = {
  PARENT: { text: 'A problem with a booking, payment or tutor? Tell our admin team and track the reply.', to: '/parent/complaints', cta: 'Report an issue' },
  TUTOR: { text: 'Questions about bookings or payouts? The WonderTutor admin team can help.', to: null },
  ADMIN: { text: 'You are signed in as an administrator. Actions here affect parents and tutors.', to: null },
}

function AppFooter({ items }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const account = ACCOUNT_LINKS[user.role] || []
  const help = HELP[user.role]
  const link = 'inline-flex min-h-9 items-center text-slate-700 hover:text-brand-600 hover:underline'

  return (
    <footer className="mt-auto border-t border-brand-100 bg-brand-50 text-sm text-slate-700">
      <div className="mx-auto grid max-w-[81.25rem] gap-8 px-4 py-8 md:grid-cols-[1.3fr_1fr_1fr_1.4fr] md:px-8">
        <div>
          <Logo className="h-8" />
          <p className="mt-2 max-w-xs text-slate-600">Learn Today, Brighter Tomorrow.</p>
        </div>
        <nav aria-label="Portal shortcuts">
          <h2 className="mb-2 text-base font-bold text-navy">Quick Links</h2>
          <ul className="space-y-0.5">
            {items.map(([to, label]) => <li key={to}><Link to={to} className={link}>{label}</Link></li>)}
          </ul>
        </nav>
        <nav aria-label="Account">
          <h2 className="mb-2 text-base font-bold text-navy">Account</h2>
          <ul className="space-y-0.5">
            {account.map(([to, label]) => <li key={to}><Link to={to} className={link}>{label}</Link></li>)}
            <li>
              <button type="button" onClick={() => { logout(); navigate('/login') }} className={`${link} text-red-700 hover:text-red-800`}>Log out</button>
            </li>
          </ul>
        </nav>
        {help && (
          <div>
            <h2 className="mb-2 text-base font-bold text-navy">Need Help?</h2>
            <p className="text-slate-600">{help.text}</p>
            {help.to && <Link to={help.to} className="btn-outline mt-3 min-h-11">{help.cta}</Link>}
          </div>
        )}
      </div>
      <div className="mx-auto max-w-[81.25rem] px-4 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-brand-200/70 py-4 text-xs text-slate-600">
          <span>&copy; {new Date().getFullYear()} WonderTutor. All rights reserved.</span>
          <Link to="/privacy" className="inline-flex min-h-9 items-center font-semibold text-brand-700 hover:underline">Privacy Notice</Link>
          <span>Signed in as {user.fullName} ({user.role.charAt(0) + user.role.slice(1).toLowerCase()})</span>
        </div>
      </div>
    </footer>
  )
}
