import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { errorMessage } from '../../api/client'
import { homeFor } from '../../components/ProtectedRoute'
import Logo from '../../components/Logo'
import GoogleButton from '../../components/GoogleButton'
import Icon from '../../components/ui/Icon'
import { ErrorBox } from '../../components/ui/Common'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '', remember: true })
  const [show, setShow] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const user = await login(form.email, form.password, form.remember)
      navigate(homeFor(user.role))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    // Same pattern as the landing hero: a light-blue band with the photo anchored on one side and fading into it,
    // so the photo is never stretched or cropped hard on wide screens. The blank wall in the photo holds the headline.
    <section className="relative left-1/2 -mt-4 w-screen -translate-x-1/2 overflow-x-clip bg-gradient-to-r from-brand-50 via-brand-50 to-brand-25">
      <img
        src="/img/art/login-bg.jpg"
        alt=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-0 hidden h-full w-[64%] object-cover object-[left_bottom] lg:block"
        style={{ maskImage: 'linear-gradient(to right, #000 55%, transparent)', WebkitMaskImage: 'linear-gradient(to right, #000 55%, transparent)' }}
      />

      <div className="relative mx-auto grid max-w-[81.25rem] items-center gap-8 px-4 py-10 md:px-8 md:py-14 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
        <div className="order-2 lg:order-1 lg:self-start lg:pl-14 lg:pt-6">
          <div className="eyebrow">Parent and tutor portal</div>
          <h1 className="mt-2 font-display text-4xl font-bold leading-[1.12] text-navy md:text-[2.75rem]">
            Learn Today,<br />
            <span className="relative inline-block text-brand-500">
              Brighter Tomorrow.
              <span className="absolute -bottom-1 left-0 h-1 w-full rounded-full bg-accent" aria-hidden="true" />
            </span>
            <Icon name="sparkle" fill className="ml-2 inline h-6 w-6 -translate-y-3 text-accent" />
          </h1>
          <p className="mt-4 max-w-md text-base text-slate-700">
            Connecting passionate tutors with motivated learners for a brighter future.
          </p>
          <ul className="mt-6 flex flex-wrap gap-x-8 gap-y-4">
            {[
              ['cap', 'Trusted Tutors', 'Verified profiles'],
              ['calendar', 'Flexible Booking', 'Learn at your time'],
              ['shield', 'Safe & Secure', 'Protected payments'],
            ].map(([icon, title, sub]) => (
              <li key={title} className="text-center">
                <Icon name={icon} className="mx-auto h-9 w-9 text-brand-500" strokeWidth={1.5} />
                <div className="mt-1 text-sm font-bold text-navy">{title}</div>
                <div className="text-sm text-slate-600">{sub}</div>
              </li>
            ))}
          </ul>
          <img src="/img/art/login-bg.jpg" alt="" aria-hidden="true" className="mt-6 h-40 w-full rounded-2xl object-cover object-[center_bottom] lg:hidden" />
        </div>

        <form onSubmit={onSubmit} aria-label="Log in" className="order-1 mx-auto w-full max-w-[28rem] space-y-4 rounded-2xl bg-white p-6 shadow-card md:p-8 lg:order-2 lg:ml-auto">
          <div className="text-center">
            <Logo className="mx-auto h-8" />
            <h2 className="mt-3 font-display text-3xl font-bold text-navy">Welcome Back</h2>
            <p className="mt-1 text-sm text-slate-600">Log in to continue your learning journey.</p>
          </div>
          <ErrorBox>{error}</ErrorBox>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-navy">Email Address</span>
            <div className="relative">
              <Icon name="mail" className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-brand-500" />
              <input type="email" required className="input h-12 pl-10" placeholder="you@example.com"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-navy">Password</span>
            <div className="relative">
              <Icon name="lock" className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-brand-500" />
              <input type={show ? 'text' : 'password'} required className="input h-12 pl-10 pr-12" placeholder="Enter your password"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center text-navy">
                <Icon name={show ? 'eye-off' : 'eye'} className="h-[18px] w-[18px]" />
              </button>
            </div>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <label className="flex min-h-10 cursor-pointer items-center gap-2 text-navy">
              <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={form.remember}
                onChange={(e) => setForm({ ...form, remember: e.target.checked })} />
              Remember me
            </label>
            <button type="button" className="min-h-10 font-semibold text-brand-600 hover:underline"
              onClick={() => setError('Password reset is not available yet. Please contact Admin if you are locked out.')}>
              Forgot password?
            </button>
          </div>
          <button disabled={busy} className="btn-accent h-12 w-full text-base">{busy ? 'Logging in…' : 'Log In'}</button>

          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
          </div>
          <GoogleButton onError={setError} />
          <p className="pt-1 text-center text-sm text-slate-600">
            Don't have an account? <Link to="/signup" className="font-semibold text-brand-600 hover:underline">Sign Up</Link>
          </p>
        </form>
      </div>
    </section>
  )
}
