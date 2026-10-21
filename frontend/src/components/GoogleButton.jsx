import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { errorMessage } from '../api/client'
import { afterLogin } from './ProtectedRoute'
import { loadScript } from '../lib/loadScript'

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

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

// "Continue with Google". Uses Google's own button when VITE_GOOGLE_CLIENT_ID is set; the credential is verified
// by the backend (POST /api/auth/google). Without a client id it shows the same-looking button with a friendly message.
// `role` is only needed when Google creates a brand-new account (signup page). `text` picks Google's wording
// ("continue_with" or "signup_with") and `label` is the same wording on the stand-in button.
// `onNeedsRole(credential)`: on the login page a new Google user has no role yet, so the page can ask for one
// and finish sign-up with the same Google credential instead of showing a dead-end error.
export default function GoogleButton({ role, onError, onNeedsRole, acceptedPrivacy = false, text = 'continue_with', label = 'Continue with Google' }) {
  const { googleLogin } = useAuth()
  const navigate = useNavigate()
  const from = useLocation().state?.from
  const box = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return
    let cancelled = false
    loadScript('https://accounts.google.com/gsi/client').then(() => {
      if (cancelled || !box.current) return
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          try {
            const user = await googleLogin(credential, role, acceptedPrivacy)
            navigate(afterLogin(user, from))
          } catch (err) {
            const m = errorMessage(err)
            if (m.includes('choose Parent or Tutor') && onNeedsRole) return onNeedsRole(credential)
            onError?.(m.includes('choose Parent or Tutor') ? 'No WonderTutor account uses this Google email yet. Please sign up first.' : m)
          }
        },
      })
      window.google.accounts.id.renderButton(box.current, { theme: 'outline', size: 'large', text, shape: 'rectangular', width: box.current.offsetWidth })
      setReady(true)
    }).catch(() => onError?.('Could not load Google sign-in. Check your internet connection.'))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, acceptedPrivacy])

  if (!GOOGLE_CLIENT_ID)
    return (
      <button type="button" onClick={() => onError?.('Google sign-in is not configured yet. Please use your email and password.')}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-navy hover:bg-slate-50">
        <GoogleG /> {label}
      </button>
    )
  // Google's button does not tell the page when its window is closed or the site address is not allowed,
  // so the likely fixes are written under it
  return (
    <div>
      <div ref={box} className={`flex min-h-[44px] w-full justify-center ${ready ? '' : 'opacity-50'}`} />
      <p className="mt-1 text-center text-xs text-slate-500">If the Google window closes without signing you in, allow pop-ups for this site and try again.</p>
    </div>
  )
}
