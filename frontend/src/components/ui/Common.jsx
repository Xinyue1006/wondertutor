import { useEffect, useId, useRef, useState } from 'react'
import Icon from './Icon'

// ───────────── small display pieces ─────────────

export function Stars({ value = 0, size = 'h-4 w-4' }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" fill className={`${size} ${i <= Math.round(value) ? 'text-accent' : 'text-slate-200'}`} strokeWidth={1.5} />
      ))}
    </span>
  )
}

export function VerifiedTick({ className = 'h-[18px] w-[18px]' }) {
  return (
    <span title="Verified tutor" className={`inline-flex items-center justify-center rounded-full bg-brand-500 text-white ${className}`}>
      <Icon name="check" className="h-3 w-3" strokeWidth={3.5} />
    </span>
  )
}

export function ModePills({ online, physical }) {
  return (
    <div className="flex gap-2">
      {online && <span className="pill bg-sky-100 text-sky-700">Online</span>}
      {physical && <span className="pill bg-emerald-100 text-emerald-700">Physical</span>}
    </div>
  )
}

// Booking / payment status badges (colours follow the mockups)
const STATUS = {
  PENDING: ['Pending Tutor Response', 'bg-accent-100 text-amber-700', 'clock'],
  COUNTER_OFFERED: ['Tutor Sent a Counter Offer', 'bg-accent-100 text-amber-700', 'refresh'],
  AWAITING_PAYMENT: ['Payment Pending', 'bg-accent-100 text-amber-700', 'clock'],
  CONFIRMED: ['Confirmed', 'bg-ok-50 text-ok', 'check-circle'],
  COMPLETED: ['Completed', 'bg-slate-100 text-slate-600', 'check-circle'],
  REJECTED: ['Declined by Tutor', 'bg-red-50 text-red-600', 'x'],
  CANCELLED: ['Cancelled', 'bg-red-50 text-red-600', 'x'],
  DISPUTED: ['Under Review', 'bg-orange-50 text-orange-600', 'info'],
  PAID: ['Paid', 'bg-ok-50 text-ok', 'check-circle'],
  REFUNDED: ['Refunded', 'bg-sky-50 text-sky-700', 'refresh'],
  PARTIALLY_REFUNDED: ['Partly Refunded', 'bg-sky-50 text-sky-700', 'refresh'],
  FAILED: ['Failed', 'bg-red-50 text-red-600', 'x'],
}

export function StatusPill({ status, label }) {
  const [text, cls, icon] = STATUS[status] || [status, 'bg-slate-100 text-slate-600', 'info']
  return (
    <span className={`pill px-3 py-1.5 ${cls}`}>
      <Icon name={icon} className="h-3.5 w-3.5" strokeWidth={2.5} />
      {label || text}
    </span>
  )
}

export function Spinner({ className = '' }) {
  return (
    <div className={`flex items-center justify-center p-10 ${className}`}>
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-brand-100 border-t-brand-500" />
    </div>
  )
}

// role="alert": screen readers read the problem out as soon as it appears
export function ErrorBox({ children, className = '' }) {
  if (!children) return null
  return <div role="alert" className={`rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 ${className}`}>{children}</div>
}

// Shown instead of an endless spinner when a page's data could not be loaded (server down, no internet)
export function LoadError({ message, onRetry }) {
  return (
    <div role="alert" className="card mx-auto my-6 flex max-w-md flex-col items-center gap-3 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-600"><Icon name="info" className="h-7 w-7" /></span>
      <div className="font-bold text-navy">We couldn't load this page</div>
      <p className="text-sm text-slate-600">{message || 'Please check your internet connection and try again.'}</p>
      {onRetry && <button onClick={onRetry} className="btn-primary mt-1 px-6"><Icon name="refresh" className="h-4 w-4" /> Try again</button>}
    </div>
  )
}

export function PageTitle({ title, subtitle, icon, right, sparkle = true }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon && <Icon name={icon} className="mt-1 h-9 w-9 text-navy" strokeWidth={1.75} />}
        <div>
          <h1 className="text-3xl font-bold text-navy md:text-[2rem]">
            {title}
            {sparkle && <Icon name="sparkle" fill className="mb-3 ml-1.5 inline h-5 w-5 text-accent" />}
          </h1>
          {subtitle && <p className="mt-1 text-slate-600">{subtitle}</p>}
        </div>
      </div>
      {right}
    </div>
  )
}

export function SectionCard({ title, icon, action, children, className = '' }) {
  return (
    <section className={`card p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-bold text-navy">
            {icon && <Icon name={icon} className="h-5 w-5 text-brand-500" />}
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

// ───────────── form controls ─────────────

// Native <select> with a leading icon and a chevron, like the mockup's filter bar
export function SelectBox({ icon, value, onChange, children, className = '', disabled, ...rest }) {
  return (
    <div className={`relative ${className}`}>
      {icon && <Icon name={icon} className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-brand-500" />}
      <select
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={`input h-11 appearance-none pr-9 ${icon ? 'pl-10' : ''} font-medium text-navy`}
        {...rest}
      >
        {children}
      </select>
      <Icon name="down" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    </div>
  )
}

export function useClickOutside(ref, handler) {
  useEffect(() => {
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && handler()
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ref, handler])
}

// The "Price ▾ / Rating ▾ / Availability ▾ ..." chips under the search bar
export function FilterDropdown({ label, active, children, width = 'w-64' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickOutside(ref, () => setOpen(false))
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-medium transition hover:border-brand-500 ${
          active ? 'border-brand-500 text-brand-500' : 'border-slate-200 text-navy'
        }`}
      >
        {label}
        <Icon name="down" className="h-4 w-4 text-slate-500" />
      </button>
      {open && (
        <div className={`pop-in absolute left-0 top-12 z-30 ${width} rounded-xl border border-brand-100 bg-white p-3 shadow-xl`}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  )
}

// ───────────── modal ─────────────

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Accessible dialog: announced as a dialog with its title, keyboard focus moves into it and stays inside
// (Tab cycles), Escape closes it, focus returns to the button that opened it, and the page behind does not scroll.
export function Modal({ open, onClose, title, children, width = 'max-w-lg', footer }) {
  const titleId = useId()
  const box = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    const first = box.current?.querySelector(`${FOCUSABLE}:not([aria-label="Close"])`) || box.current
    first?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    const onKey = (e) => {
      if (e.key === 'Escape') return closeRef.current()
      if (e.key !== 'Tab' || !box.current) return
      const items = [...box.current.querySelectorAll(FOCUSABLE)]
      if (!items.length) return
      const [head, tail] = [items[0], items[items.length - 1]]
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus() }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      opener?.focus?.()
    }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`pop-in max-h-[90vh] w-full ${width} overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl outline-none`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-bold text-navy">{title}</h2>
          <button onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        {children}
        {footer && <div className="mt-5 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>
  )
}

export function EmptyState({ icon = 'calendar', title, children, action }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500">
        <Icon name={icon} className="h-7 w-7" />
      </span>
      <div className="font-semibold text-navy">{title}</div>
      {children && <p className="max-w-sm text-sm text-slate-500">{children}</p>}
      {action}
    </div>
  )
}
