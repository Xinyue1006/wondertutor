import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import { ErrorBox } from '../../components/ui/Common'
import OtpInput from '../../components/OtpInput'
import PasswordHint from '../../components/PasswordHint'
import { OTP_MINUTES, OTP_TRIES, checkEmail, checkPassword } from '../../lib/validation'

// Two steps: 1) email -> a 6-digit code is emailed, 2) code + new password.
// The first answer is the same whether or not the email has an account, so the page cannot be used to probe emails.
// (A code, not a link: the same otp.service as sign-up, so the same expiry and number of tries.)
function StepBadge({ children }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
      <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-hidden="true" /> {children}
    </span>
  )
}

export default function ForgotPassword() {
  const { state } = useLocation()
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState(state?.email || '')
  const [code, setCode] = useState('')
  const [pw, setPw] = useState({ password: '', confirm: '' })
  const [show, setShow] = useState(false)
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function sendCode(e) {
    e?.preventDefault()
    setError('')
    const bad = checkEmail(email)
    if (bad) return setError(bad)
    setBusy(true)
    try {
      const r = await api.post('/auth/forgot-password', { email: email.trim() })
      setInfo(r.data.message)
      setCode('')
      setStep(2)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function reset(e) {
    e.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code from the email.')
    const weak = checkPassword(pw.password)
    if (weak) return setError(weak)
    if (pw.password !== pw.confirm) return setError('Passwords do not match.')
    setBusy(true)
    try {
      await api.post('/auth/reset-password', { email: email.trim(), code, newPassword: pw.password })
      setDone(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-[30rem] py-10">
      <div className="rounded-2xl border border-brand-100 bg-white p-6 shadow-card md:p-8">
        {done ? (
          <div className="space-y-4 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok-50 text-ok"><Icon name="check-circle" className="h-6 w-6" /></span>
            <h1 className="font-display text-2xl font-bold text-navy">Password reset</h1>
            <p className="text-slate-700">Your password has been changed. Log in with your new password.</p>
            <Link to="/login" state={{ email }} className="btn-primary h-11 w-full">Go to Log in</Link>
          </div>
        ) : step === 1 ? (
          <form onSubmit={sendCode} noValidate className="space-y-4">
            <StepBadge>Step 1 · Request code</StepBadge>
            <h1 className="font-display text-2xl font-bold text-navy">Forgot your password?</h1>
            <p className="text-sm text-slate-600">Enter the email you registered with. We'll send a 6-digit code that works for {OTP_MINUTES} minutes ({OTP_TRIES} tries).</p>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-navy">Email address</span>
              <input type="email" autoComplete="email" className="input h-11" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <ErrorBox>{error}</ErrorBox>
            <button disabled={busy} className="btn-primary h-11 w-full">{busy ? 'Sending…' : 'Send code'}</button>
          </form>
        ) : (
          <form onSubmit={reset} noValidate className="space-y-4">
            <StepBadge>Step 2 · Enter code</StepBadge>
            <h1 className="font-display text-2xl font-bold text-navy">Set a new password</h1>
            {/* Same wording whether or not the email has an account, so nobody can use this page to check who is registered */}
            <p role="status" className="rounded-lg bg-ok-50 px-3 py-2.5 text-sm text-green-900">{info} We show this message either way, so nobody can check who has an account. Check your spam folder too.</p>
            <div>
              <span className="mb-1.5 block text-sm font-semibold text-navy">6-digit code</span>
              <OtpInput value={code} onChange={setCode} label="6-digit code" />
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-navy">New password</span>
              <div className="relative">
                <input type={show ? 'text' : 'password'} autoComplete="new-password" className="input h-11 pr-16" placeholder="At least 8 characters" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show} className="absolute right-0 top-1/2 flex h-11 min-w-14 -translate-y-1/2 items-center justify-center px-3 text-sm font-semibold text-brand-600">
                  {show ? 'Hide' : 'Show'}
                </button>
              </div>
            </label>
            <PasswordHint value={pw.password} />
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-navy">Confirm new password</span>
              <input type={show ? 'text' : 'password'} autoComplete="new-password" className="input h-11" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </label>
            <ErrorBox>{error}</ErrorBox>
            <button disabled={busy} className="btn-primary h-11 w-full">{busy ? 'Saving…' : 'Update password'}</button>
            <button type="button" onClick={sendCode} disabled={busy} className="min-h-11 w-full text-sm font-semibold text-brand-600 hover:underline">Send a new code</button>
          </form>
        )}

        {!done && (
          <Link to="/login" className="mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline">
            <Icon name="arrow-left" className="h-4 w-4" /> Back to login
          </Link>
        )}
      </div>
    </section>
  )
}
