import { createContext, useContext, useEffect, useState } from 'react'
import api from '../api/client'

const AuthContext = createContext(null)

// Login-related calls answer 401 for a wrong password; that is not an expired session
const AUTH_CALL = /\/auth\/(login|google|register|verify-otp|resend-otp|forgot-password|reset-password)/

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  // Why the user was sent back to Log In (expired session, deactivated account); shown once on the login page
  const [notice, setNotice] = useState('')

  // If the server stops accepting the saved login (it expired, or Admin deactivated the account while it was open),
  // end the session everywhere at once. The protected pages then send the user to Log In with the reason,
  // instead of every page showing its own error while the app still looks logged in.
  useEffect(() => {
    const id = api.interceptors.response.use(undefined, (err) => {
      const status = err?.response?.status
      const message = err?.response?.data?.message || ''
      const hadSession = Boolean(err?.config?.headers?.Authorization)
      const ended = status === 401 || (status === 403 && /deactivated/i.test(message))
      if (hadSession && ended && !AUTH_CALL.test(err.config.url || '')) {
        clearToken()
        setUser(null)
        setNotice(status === 401 ? 'Your session has expired. Please log in again.' : message)
      }
      return Promise.reject(err)
    })
    return () => api.interceptors.response.eject(id)
  }, [])

  // On first load, if a token exists, fetch the current user
  useEffect(() => {
    const token = localStorage.getItem('wt_token') || sessionStorage.getItem('wt_token')
    if (!token) return setLoading(false)
    api.get('/auth/me')
      .then((res) => setUser(res.data.user))
      .catch(() => clearToken())
      .finally(() => setLoading(false))
  }, [])

  function saveSession(token, user, remember) {
    clearToken()
    ;(remember ? localStorage : sessionStorage).setItem('wt_token', token)
    setUser(user)
  }

  function clearToken() {
    localStorage.removeItem('wt_token')
    sessionStorage.removeItem('wt_token')
  }

  async function login(email, password, remember, recaptchaToken) {
    setNotice('')
    const res = await api.post('/auth/login', { email, password, recaptchaToken: recaptchaToken || undefined })
    saveSession(res.data.token, res.data.user, remember)
    return res.data.user
  }

  async function googleLogin(credential, role) {
    setNotice('')
    const res = await api.post('/auth/google', { credential, role })
    saveSession(res.data.token, res.data.user, true)
    return res.data.user
  }

  function logout() {
    clearToken()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, googleLogin, logout, saveSession, notice }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
