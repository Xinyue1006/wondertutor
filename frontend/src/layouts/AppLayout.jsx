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

export default function AppLayout() {
  const { user } = useAuth()
  const items = NAV[user.role] || []
  const isParent = user.role === 'PARENT'

  const shell = (
    <div className="min-h-screen pb-24">
      <header className="sticky top-0 z-30 px-3 pt-3 md:px-6">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 rounded-2xl bg-white px-4 shadow-card md:px-6">
          <Link to={items[0]?.[0] || '/'} className="shrink-0 py-3"><Logo className="h-8" /></Link>
          <nav className="hidden items-stretch gap-1 self-stretch md:flex">
            {items.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to.split('/').length === 2}
                className={({ isActive }) =>
                  `flex items-center border-b-[3px] px-4 text-sm font-semibold transition ${
                    isActive ? 'border-brand-500 text-brand-500' : 'border-transparent text-navy hover:text-brand-500'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2 py-2 md:gap-4">
            <NotificationBell />
            <UserMenu />
          </div>
        </div>
        {/* Phone: nav moves to a horizontal scroller */}
        <nav className="mx-auto mt-2 flex max-w-[1400px] gap-2 overflow-x-auto md:hidden">
          {items.map(([to, label]) => (
            <NavLink
              key={to}
              to={to}
              end={to.split('/').length === 2}
              className={({ isActive }) =>
                `shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold ${isActive ? 'bg-brand-500 text-white' : 'bg-white text-navy'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-[1400px] px-3 py-6 md:px-6">
        <Outlet />
      </main>
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
        <span className="hidden text-left leading-tight sm:block">
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
    const t = setInterval(load, 60000) // light polling: new booking replies show up without a refresh
    return () => clearInterval(t)
  }, [load])

  async function openItem(n) {
    setOpen(false)
    if (!n.isRead) await api.post(`/notifications/${n.id}/read`).catch(() => {})
    load()
    if (n.link) navigate(n.link)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen((o) => !o); if (!open) load() }}
        className="relative rounded-full p-2 text-brand-500 hover:bg-brand-50"
        aria-label="Notifications"
      >
        <Icon name="bell" className="h-6 w-6" />
        {data.unread > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-white" />}
      </button>
      {open && (
        <div className="pop-in absolute right-0 top-12 z-40 w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-brand-100 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <span className="font-bold text-navy">Notifications</span>
            {data.unread > 0 && (
              <button
                className="text-xs font-semibold text-brand-500 hover:underline"
                onClick={() => api.post('/notifications/read-all').then(load)}
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
                  <span className="block truncate text-xs text-slate-500">{n.message}</span>
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
