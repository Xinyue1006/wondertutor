import { useState } from 'react'
import api, { errorMessage } from '../api/client'
import { ErrorBox } from './ui/Common'
import Icon from './ui/Icon'
import { checkEmail } from '../lib/validation'

// Change the login email in two steps: (1) the new address and the current password, a code is sent to the NEW address;
// (2) the code. Nothing changes until the code is entered, so a typo in the address cannot lock anybody out.
export default function ChangeEmail({ email, hasPassword, onChanged }) {
  const [step, setStep] = useState('idle') // idle -> code -> done
  const [form, setForm] = useState({ newEmail: '', password: '', code: '' })
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPw, setShowPw] = useState(false)

  const reset = () => { setStep('idle'); setForm({ newEmail: '', password: '', code: '' }); setError(''); setInfo('') }

  async function send(e) {
    e?.preventDefault()
    if (busy) return
    const newEmail = form.newEmail.trim().toLowerCase()
    const problem = checkEmail(newEmail) || (newEmail === email && 'That is already your email address') || (!form.password && 'Enter your password to continue')
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      const r = await api.post('/auth/change-email/request', { newEmail, password: form.password })
      setForm((f) => ({ ...f, newEmail, password: '', code: '' }))
      setInfo(r.data.message)
      setStep('code')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function confirm(e) {
    e.preventDefault()
    if (busy) return
    if (!/^\d{6}$/.test(form.code.trim())) return setError('Enter the 6-digit code we sent to your new email.')
    setBusy(true)
    setError('')
    try {
      const r = await api.post('/auth/change-email/confirm', { newEmail: form.newEmail, code: form.code.trim() })
      onChanged(r.data.user.email)
      setInfo(r.data.message)
      setStep('done')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card space-y-4 p-6" aria-labelledby="change-email-title">
      <div>
        <h2 id="change-email-title" className="text-xl font-extrabold text-navy">Login email</h2>
        <p className="mt-1 text-sm text-slate-600">You log in with <b className="text-navy">{email}</b>. If you change it, we send a code to the new address first, and tell your old address afterwards.</p>
      </div>

      {!hasPassword ? (
        <p className="flex items-start gap-2 rounded-lg bg-brand-25 p-3 text-sm text-slate-700"><Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /> This account signs in with Google, so its email is managed by your Google account.</p>
      ) : step === 'done' ? (
        <div role="status" className="flex items-start gap-2 rounded-lg bg-ok-50 p-3 text-sm text-ok"><Icon name="check-circle" className="mt-0.5 h-4 w-4 shrink-0" /> <span>{info}</span></div>
      ) : step === 'idle' ? (
        <form onSubmit={send} noValidate className="space-y-4">
          <ErrorBox>{error}</ErrorBox>
          <label className="block text-sm font-semibold text-navy">New email address
            <input type="email" autoComplete="email" className="input mt-1.5 h-11" value={form.newEmail} onChange={(e) => setForm({ ...form, newEmail: e.target.value })} />
          </label>
          <label className="block text-sm font-semibold text-navy">Your password
            <input type={showPw ? 'text' : 'password'} autoComplete="current-password" className="input mt-1.5 h-11" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-navy">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} /> Show password
          </label>
          <div className="flex justify-end border-t border-slate-100 pt-4"><button disabled={busy} className="btn-primary h-11 px-8">{busy ? 'Sending…' : 'Send code to new email'}</button></div>
        </form>
      ) : (
        <form onSubmit={confirm} noValidate className="space-y-4">
          <ErrorBox>{error}</ErrorBox>
          <p role="status" className="rounded-lg bg-brand-25 p-3 text-sm text-slate-700">{info}</p>
          <label className="block text-sm font-semibold text-navy">6-digit code
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input mt-1.5 h-11 tracking-[0.4em]" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })} />
          </label>
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className="btn-outline h-11 px-6" onClick={reset}>Use a different email</button>
            <button disabled={busy} className="btn-primary h-11 px-8">{busy ? 'Checking…' : 'Confirm new email'}</button>
          </div>
        </form>
      )}
    </section>
  )
}
