import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import api, { clearCsrfToken, errorMessage, isCurrentSessionRequest, setCsrfToken } from '../api/client'

const AuthContext = createContext(null)

// Login-related calls answer 401 for a wrong password; that is not an expired session
const AUTH_CALL = /\/auth\/(login|google|register|verify-otp|resend-otp|forgot-password|reset-password)/

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sessionError, setSessionError] = useState('')
  const userRef = useRef(null)
  const request = useRef(0)
  // Why the user was sent back to Log In (expired session, deactivated account); shown once on the login page
  const [notice, setNotice] = useState('')

  // If the server stops accepting the saved login (it expired, or Admin deactivated the account while it was open),
  // end the session everywhere at once. The protected pages then send the user to Log In with the reason,
  // instead of every page showing its own error while the app still looks logged in.
  useEffect(() => {
    const id = api.interceptors.response.use(undefined, (err) => {
      const status = err?.response?.status
      const message = err?.response?.data?.message || ''
      const ended = status === 401 || (status === 403 && /deactivated/i.test(message))
      if (userRef.current && ended && isCurrentSessionRequest(err.config) && err.config?.url !== '/auth/me' && !AUTH_CALL.test(err.config?.url || '')) {
        clearCsrfToken()
        userRef.current = null
        setUser(null)
        setSessionError('')
        setNotice(status === 401 ? 'Your session has expired. Please log in again.' : message)
      }
      return Promise.reject(err)
    })
    return () => api.interceptors.response.eject(id)
  }, [])

  // Cookies are intentionally unreadable, so ask the server on every reload.
  // A temporary outage is not evidence that the person has been logged out.
  const refreshSession = useCallback(async () => {
    const current = ++request.current
    setLoading(true)
    setSessionError('')
    try {
      const res = await api.get('/auth/me')
      if (current !== request.current) return
      userRef.current = res.data.user
      setUser(res.data.user)
      if (res.data.csrfToken) setCsrfToken(res.data.csrfToken)
    } catch (err) {
      if (current !== request.current) return
      if (err.response?.status === 401 || (err.response?.status === 403 && /deactivated/i.test(err.response.data?.message || ''))) {
        userRef.current = null
        setUser(null)
        clearCsrfToken()
        if (err.response.status === 403) setNotice(err.response.data.message)
      } else setSessionError(errorMessage(err))
    } finally {
      if (current === request.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Remove credentials left by versions of the app predating cookie sessions.
    try { localStorage.removeItem('wt_token'); sessionStorage.removeItem('wt_token') } catch { /* Storage may be disabled; cookies still work. */ }
    refreshSession()
    return () => { ++request.current }
  }, [refreshSession])

  function saveSession(user, csrfToken) {
    ++request.current
    userRef.current = user
    setUser(user)
    setSessionError('')
    setLoading(false)
    if (csrfToken) setCsrfToken(csrfToken)
  }

  async function login(email, password, remember, recaptchaToken, portal) {
    setNotice('')
    const res = await api.post('/auth/login', { email, password, remember: Boolean(remember), recaptchaToken: recaptchaToken || undefined, ...(portal === 'ADMIN' && { portal }) })
    saveSession(res.data.user, res.data.csrfToken)
    return res.data.user
  }

  // acceptedPrivacy is only sent by screens that show the Privacy Notice next to the button (new accounts need it)
  async function googleLogin(credential, role, acceptedPrivacy = false) {
    setNotice('')
    const res = await api.post('/auth/google', { credential, role, ...(acceptedPrivacy && { acceptedPrivacy: true }) })
    saveSession(res.data.user, res.data.csrfToken)
    return res.data.user
  }

  async function logout(message) {
    await api.post('/auth/logout')
    ++request.current
    userRef.current = null
    setUser(null)
    setSessionError('')
    setLoading(false)
    setNotice(typeof message === 'string' ? message : '')
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, sessionError, refreshSession, login, googleLogin, logout, saveSession, notice }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
