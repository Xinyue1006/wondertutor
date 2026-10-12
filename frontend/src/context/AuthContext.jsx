import { createContext, useContext, useEffect, useState } from 'react'
import api from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

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

  async function login(email, password, remember) {
    const res = await api.post('/auth/login', { email, password })
    saveSession(res.data.token, res.data.user, remember)
    return res.data.user
  }

  async function googleLogin(credential, role) {
    const res = await api.post('/auth/google', { credential, role })
    saveSession(res.data.token, res.data.user, true)
    return res.data.user
  }

  function logout() {
    clearToken()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, googleLogin, logout, saveSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
