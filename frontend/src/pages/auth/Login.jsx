import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { errorMessage } from '../../api/client'
import { homeFor } from '../../components/ProtectedRoute'
import Hero from '../../components/Hero'
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
          <GoogleButton onError={setError} />
          <p className="pt-1 text-center text-sm text-slate-500">
            Don't have an account? <Link to="/signup" className="font-semibold text-brand-500 hover:underline">Sign Up</Link>
          </p>
        </div>
      </form>
    </div>
  )
}
