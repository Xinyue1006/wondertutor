import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import api, { errorMessage } from '../../api/client'
import Icon from '../../components/ui/Icon'
import { ErrorBox } from '../../components/ui/Common'
import { checkEmail, checkPassword } from '../../lib/validation'

// Two steps: 1) email -> a 6-digit code is emailed, 2) code + new password.
// The first answer is the same whether or not the email has an account, so the page cannot be used to probe emails.
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
    <section className="mx-auto w-full max-w-[28rem] py-10">
      <div className="rounded-2xl border border-brand-100 bg-white p-6 shadow-card md:p-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-500"><Icon name="lock" className="h-6 w-6" /></span>
        <h1 className="mt-3 text-center text-3xl font-bold text-navy">{done ? 'Password reset' : 'Forgot your password?'}</h1>

        {done ? (
          <div className="mt-4 space-y-4 text-center">
            <p className="text-slate-700">Your password has been changed. You can now log in with the new password.</p>
            <Link to="/login" state={{ email }} className="btn-primary h-11 w-full">Go to Log In</Link>
          </div>
        ) : step === 1 ? (
          <form onSubmit={sendCode} noValidate className="mt-4 space-y-4">
            <p className="text-center text-sm text-slate-600">Enter the email you signed up with and we will send you a 6-digit code.</p>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-navy">Email Address</span>
              <input type="email" autoComplete="email" className="input h-11" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <ErrorBox>{error}</ErrorBox>
            <button disabled={busy} className="btn-primary h-11 w-full">{busy ? 'Sending…' : 'Send Code'}</button>
          </form>
        ) : (
          <form onSubmit={reset} noValidate className="mt-4 space-y-4">
            <p role="status" className="rounded-lg bg-brand-50 px-3 py-2.5 text-sm text-slate-700">{info} It may take a minute. Check your spam folder too.</p>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-navy">6-digit Code</span>
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input h-11 tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-navy">New Password</span>
              <div className="relative">
                <input type={show ? 'text' : 'password'} autoComplete="new-password" className="input h-11 pr-12" placeholder="At least 8 characters" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-navy">
                  <Icon name={show ? 'eye-off' : 'eye'} className="h-[18px] w-[18px]" />
                </button>
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-semibold text-navy">Confirm New Password</span>
              <input type={show ? 'text' : 'password'} autoComplete="new-password" className="input h-11" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            </label>
            <ErrorBox>{error}</ErrorBox>
            <button disabled={busy} className="btn-primary h-11 w-full">{busy ? 'Saving…' : 'Reset Password'}</button>
            <button type="button" onClick={sendCode} disabled={busy} className="w-full text-sm font-semibold text-brand-600 hover:underline">Send a new code</button>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-slate-600">
          Remembered it? <Link to="/login" className="font-semibold text-brand-600 hover:underline">Back to Log In</Link>
        </p>
      </div>
    </section>
  )
}
