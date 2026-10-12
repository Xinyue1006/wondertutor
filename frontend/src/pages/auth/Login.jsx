import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { errorMessage } from '../../api/client'
import { homeFor } from '../../components/ProtectedRoute'
import Hero from '../../components/Hero'
import Logo from '../../components/Logo'
import Icon from '../../components/ui/Icon'
import { ErrorBox } from '../../components/ui/Common'

function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  )
}

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

  // TODO (later): wire Google sign-in with @react-oauth/google once VITE_GOOGLE_CLIENT_ID is set.
  // The backend endpoint POST /api/auth/google is already in place.
  function onGoogle() {
    setError(
      import.meta.env.VITE_GOOGLE_CLIENT_ID
        ? 'Google sign-in is being connected. Please log in with your email for now.'
        : 'Google sign-in is not configured yet. Please log in with your email and password.',
    )
  }

  return (
    <div className="grid items-center gap-8 pt-8 lg:grid-cols-[1.1fr_1fr] lg:pt-12">
      <div className="relative order-2 lg:order-1">
        <Hero />
        <img
          src="/img/art/login-desk.jpg"
          alt=""
          className="pointer-events-none mt-8 hidden w-full max-w-[460px] rounded-2xl object-cover opacity-90 [mask-image:linear-gradient(to_bottom,transparent,black_30%)] lg:block"
        />
      </div>

      <form onSubmit={onSubmit} className="card order-1 mx-auto w-full max-w-[440px] p-8 lg:order-2 lg:mr-6">
        <div className="text-center">
          <Logo className="mx-auto h-8" />
          <h2 className="mt-3 text-3xl font-extrabold text-navy">Welcome Back</h2>
          <p className="mt-1 text-sm text-slate-500">Log in to continue your learning journey.</p>
        </div>

        <div className="mt-6 space-y-4">
          <ErrorBox>{error}</ErrorBox>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-navy">Email Address</span>
            <div className="relative">
              <Icon name="mail" className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-navy" />
              <input type="email" required className="input h-12 pl-10" placeholder="you@example.com"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-navy">Password</span>
            <div className="relative">
              <Icon name="lock" className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-navy" />
              <input type={show ? 'text' : 'password'} required className="input h-12 pl-10 pr-11" placeholder="Enter your password"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-navy">
                <Icon name={show ? 'eye-off' : 'eye'} className="h-[18px] w-[18px]" />
              </button>
            </div>
          </label>
          <div className="flex items-center justify-between text-sm">
            <label className="flex cursor-pointer items-center gap-2 text-navy">
              <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={form.remember}
                onChange={(e) => setForm({ ...form, remember: e.target.checked })} />
              Remember me
            </label>
            <button type="button" className="font-semibold text-brand-500 hover:underline"
              onClick={() => setError('Password reset is not available yet. Please contact Admin if you are locked out.')}>
              Forgot password?
            </button>
          </div>
          <button disabled={busy} className="btn-primary h-12 w-full text-base">{busy ? 'Logging in…' : 'Log In'}</button>

          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
          </div>
          <button type="button" onClick={onGoogle}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-navy hover:bg-slate-50">
            <GoogleG /> Continue with Google
          </button>
          <p className="pt-1 text-center text-sm text-slate-500">
            Don't have an account? <Link to="/signup" className="font-semibold text-brand-500 hover:underline">Sign Up</Link>
          </p>
        </div>
      </form>
    </div>
  )
}
