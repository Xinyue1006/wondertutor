import { useId, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { errorMessage } from '../../api/client'
import { afterLogin } from '../../components/ProtectedRoute'
import GoogleButton from '../../components/GoogleButton'
import Recaptcha, { RECAPTCHA_SITE_KEY } from '../../components/Recaptcha'
import Icon from '../../components/ui/Icon'
import { ErrorBox } from '../../components/ui/Common'

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// One labelled field with its own error line directly under it (icon + words, not colour alone).
// `action` sits on the right of the label row (the "Forgot password?" link).
function LoginField({ label, icon, error, action, children }) {
  const id = useId()
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-semibold text-navy">{label}</label>
        {action}
      </div>
      <div className="relative">
        <Icon name={icon} className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-brand-500" />
        {children(id, error ? `${id}-error` : undefined)}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-1 flex items-center gap-1.5 text-sm font-medium text-red-700">
          <Icon name="info" className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}
    </div>
  )
}

export default function Login() {
  const { login, googleLogin, notice } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation()
  const [form, setForm] = useState({ email: state?.email || '', password: '', remember: true })
  const [show, setShow] = useState(false)
  const [captcha, setCaptcha] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)
  // Set when someone uses "Continue with Google" without an account: we ask Parent or Tutor, then create it
  const [newGoogle, setNewGoogle] = useState(null)

  async function finishGoogleSignup(role) {
    setBusy(true)
    setError('')
    try {
      const user = await googleLogin(newGoogle, role)
      navigate(afterLogin(user, state?.from))
    } catch (err) {
      // Google's credential is short-lived; if it has expired the person simply clicks the Google button again
      setNewGoogle(null)
      setError(`${errorMessage(err)} Please click “Continue with Google” again.`)
    } finally {
      setBusy(false)
    }
  }

  const set = (field) => (e) => {
    setForm({ ...form, [field]: e.target.value })
    setFieldErrors((f) => ({ ...f, [field]: undefined }))
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    // Check the fields first so each problem is shown next to the field it belongs to
    const found = {}
    if (!form.email.trim()) found.email = 'Enter your email address.'
    else if (!EMAIL_OK.test(form.email.trim())) found.email = 'Enter a valid email, like you@example.com.'
    if (!form.password) found.password = 'Enter your password.'
    setFieldErrors(found)
    if (found.email || found.password) {
      // keyboard users land on the first field that needs fixing
      e.currentTarget.querySelector(`[data-field="${found.email ? 'email' : 'password'}"]`)?.focus()
      return
    }
    // The server checks the reCAPTCHA too; asking here saves a round trip that would only fail
    if (RECAPTCHA_SITE_KEY && !captcha) return setError('Please tick “I’m not a robot” to continue.')
    setBusy(true)
    try {
      const user = await login(form.email, form.password, form.remember, captcha)
      navigate(afterLogin(user, state?.from))
    } catch (err) {
      setError(errorMessage(err))
      // A reCAPTCHA token works once, so a failed attempt needs a fresh tick
      if (RECAPTCHA_SITE_KEY) {
        window.grecaptcha?.reset()
        setCaptcha('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="relative left-1/2 -mt-4 flex w-screen flex-1 -translate-x-1/2 items-center overflow-x-clip bg-gradient-to-b from-brand-50 to-brand-25">
      <div className="relative mx-auto grid w-full max-w-[81.25rem] items-center gap-6 px-4 py-8 md:px-8 lg:grid-cols-[1.15fr_1fr] lg:gap-12">
        {/* On phones this is a compact brand block under the form */}
        <div className="order-2 lg:order-1 lg:pl-6">
          <h1 className="font-display text-3xl font-extrabold leading-[1.1] text-navy md:text-4xl lg:text-[3.25rem]">
            Learn Today.<br />
            <span className="text-brand-500">Brighter Tomorrow.</span>
          </h1>
          <p className="mt-4 max-w-md text-base text-slate-700">
            Connecting passionate tutors with ambitious learners across Malaysia. Find a verified tutor, book a lesson and pay securely in one place.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2 text-xs font-semibold" aria-label="Why WonderTutor">
            {[
              ['bg-brand-100 text-brand-700', 'bg-brand-500', 'Verified tutors'],
              ['bg-ok-50 text-green-800', 'bg-ok', 'Secure payment'],
              ['bg-accent-100 text-amber-900', 'bg-accent-600', 'GPS-checked sessions'],
            ].map(([pill, dot, label]) => (
              <li key={label} className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 ${pill}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" /> {label}
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={onSubmit} noValidate aria-label="Log in" className="order-1 mx-auto w-full max-w-[28rem] space-y-3 rounded-2xl border border-brand-100 bg-white p-6 shadow-card md:p-8 lg:order-2 lg:ml-auto">
          <div>
            <h2 className="font-display text-2xl font-bold text-navy">Welcome back</h2>
            <p className="mt-1 text-sm text-slate-600">Log in to continue to your account</p>
          </div>
          {/* Why the user is here again (expired session, deactivated account) */}
          {notice && <p role="status" className="flex gap-2 rounded-lg bg-accent-50 px-3 py-2.5 text-sm text-amber-900"><Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" /> {notice}</p>}

          <LoginField label="Email address" icon="mail" error={fieldErrors.email}>
            {(id, err) => (
              <input id={id} type="email" autoComplete="email" className="input h-11 pl-10" placeholder="you@example.com"
                aria-invalid={err ? true : undefined} aria-describedby={err}
                value={form.email} onChange={set('email')} data-field="email" />
            )}
          </LoginField>
          <LoginField
            label="Password" icon="lock" error={fieldErrors.password}
            action={<Link to="/forgot-password" state={{ email: form.email }} className="text-xs font-semibold text-brand-600 hover:underline">Forgot password?</Link>}
          >
            {(id, err) => (
              <>
                <input id={id} type={show ? 'text' : 'password'} autoComplete="current-password" className="input h-11 pl-10 pr-16" placeholder="Enter your password"
                  aria-invalid={err ? true : undefined} aria-describedby={err}
                  value={form.password} onChange={set('password')} data-field="password" />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
                  className="absolute right-0 top-1/2 flex h-11 min-w-14 -translate-y-1/2 items-center justify-center px-3 text-sm font-semibold text-brand-600">
                  {show ? 'Hide' : 'Show'}
                </button>
              </>
            )}
          </LoginField>

          {/* Remember me: the session is kept in localStorage instead of sessionStorage (see AuthContext) */}
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-navy">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={form.remember}
              onChange={(e) => setForm({ ...form, remember: e.target.checked })} />
            Remember me on this device
          </label>

          <Recaptcha onToken={setCaptcha} />

          {/* Server answers (wrong password, deactivated account...) sit right above the button that caused them */}
          <ErrorBox>{error}</ErrorBox>
          <button disabled={busy} className="btn-primary h-11 w-full text-base">{busy ? 'Logging in…' : 'Log in'}</button>

          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
          </div>
          {newGoogle ? (
            <div role="group" aria-labelledby="new-google-title" className="rounded-xl border border-brand-100 bg-brand-25 p-4 text-center">
              <p id="new-google-title" className="text-sm font-semibold text-navy">No WonderTutor account uses this Google email yet.</p>
              <p className="mt-0.5 text-sm text-slate-600">Create one now. Which describes you?</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" disabled={busy} onClick={() => finishGoogleSignup('PARENT')} className="btn-primary h-11">I'm a Parent</button>
                <button type="button" disabled={busy} onClick={() => finishGoogleSignup('TUTOR')} className="btn-primary h-11">I'm a Tutor</button>
              </div>
              <button type="button" onClick={() => setNewGoogle(null)} className="mt-2 min-h-10 text-sm font-semibold text-brand-600 hover:underline">Cancel</button>
            </div>
          ) : (
            <GoogleButton onError={setError} onNeedsRole={(credential) => { setError(''); setNewGoogle(credential) }} />
          )}
          <p className="text-center text-sm text-slate-600">
            New to WonderTutor? <Link to="/signup" className="inline-flex min-h-11 items-center font-semibold text-brand-600 hover:underline">Create an account</Link>
          </p>
        </form>
      </div>
    </section>
  )
}
