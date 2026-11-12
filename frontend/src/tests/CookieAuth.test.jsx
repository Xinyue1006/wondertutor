import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import api, { clearCsrfToken } from '../api/client'
import { AuthProvider, useAuth } from '../context/AuthContext'
import ProtectedRoute from '../components/ProtectedRoute'

const originalAdapter = api.defaults.adapter
const userFor = role => ({ id: 1, role, fullName: 'Test User', email: 'user@example.test' })
const response = (config, data = {}) => ({ config, data, status: 200, statusText: 'OK', headers: {} })
const failure = (config, status, message = 'Please log in') => Promise.reject(new AxiosError('Request failed', undefined, config, undefined, { config, status, data: { message }, headers: {} }))
function Probe() {
  const auth = useAuth()
  const [error, setError] = useState('')
  return <div>
    <p>{auth.loading ? 'Checking session' : auth.user?.role || 'Anonymous'}</p>
    <p>{auth.notice}</p>
    <button onClick={() => auth.login('user@example.test', 'Test1234', true, '', 'ADMIN').catch(e => setError(e.message))}>Remembered login</button>
    <button onClick={() => auth.login('user@example.test', 'Test1234', false, '').catch(e => setError(e.message))}>Session login</button>
    <button onClick={() => auth.googleLogin('google-credential', 'TUTOR', true).catch(e => setError(e.message))}>Google login</button>
    <button onClick={() => auth.logout().catch(e => setError(e.message))}>Logout</button>
    <button onClick={() => api.get('/parent/profile').catch(() => {})}>Protected request</button>
    {error && <p role="alert">{error}</p>}
  </div>
}
const open = () => render(<AuthProvider><Probe /></AuthProvider>)
beforeEach(() => { clearCsrfToken(); localStorage.clear(); sessionStorage.clear() })
afterEach(() => { api.defaults.adapter = originalAdapter; clearCsrfToken() })

test.each(['PARENT', 'TUTOR', 'ADMIN'])('reload restores the %s cookie session without browser-stored credentials', async role => {
  localStorage.setItem('wt_token', 'legacy-token')
  sessionStorage.setItem('wt_token', 'legacy-session-token')
  const adapter = vi.fn(config => Promise.resolve(response(config, { user: userFor(role), csrfToken: 'session-proof' })))
  api.defaults.adapter = adapter
  open()
  expect(await screen.findByText(role)).toBeInTheDocument()
  expect(adapter).toHaveBeenCalledTimes(1)
  expect(adapter.mock.calls[0][0].url).toBe('/auth/me')
  expect(adapter.mock.calls[0][0].withCredentials).toBe(true)
  expect(localStorage.getItem('wt_token')).toBeNull()
  expect(sessionStorage.getItem('wt_token')).toBeNull()
})

test('an anonymous visitor is checked quietly and Remember Me is sent to the server', async () => {
  const writes = []
  api.defaults.adapter = config => {
    if (config.url === '/auth/me') return failure(config, 401)
    if (config.url === '/auth/csrf') return Promise.resolve(response(config, { csrfToken: 'anonymous' }))
    writes.push(config)
    return Promise.resolve(response(config, { user: userFor('ADMIN'), csrfToken: 'signed-in' }))
  }
  open()
  await screen.findByText('Anonymous')
  expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remembered login' }))
  await screen.findByText('ADMIN')
  expect(JSON.parse(writes[0].data)).toEqual({ email: 'user@example.test', password: 'Test1234', remember: true, portal: 'ADMIN' })
  fireEvent.click(screen.getByRole('button', { name: 'Session login' }))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(JSON.parse(writes[1].data).remember).toBe(false)
  expect(localStorage.length + sessionStorage.length).toBe(0)
})

test('Google sign-in adopts the cookie-session user and CSRF proof without a token response', async () => {
  let googleRequest
  api.defaults.adapter = config => {
    if (config.url === '/auth/me') return failure(config, 401)
    if (config.url === '/auth/csrf') return Promise.resolve(response(config, { csrfToken: 'anonymous' }))
    googleRequest = config
    return Promise.resolve(response(config, { user: userFor('TUTOR'), csrfToken: 'google-session-proof' }))
  }
  open()
  await screen.findByText('Anonymous')
  fireEvent.click(screen.getByRole('button', { name: 'Google login' }))
  await screen.findByText('TUTOR')
  expect(googleRequest.url).toBe('/auth/google')
  expect(JSON.parse(googleRequest.data)).toEqual({ credential: 'google-credential', role: 'TUTOR', acceptedPrivacy: true })
  expect(localStorage.length + sessionStorage.length).toBe(0)
})

test('logout keeps the current user until the server confirms revocation, and failures remain visible', async () => {
  let rejectLogout, resolveLogout
  let attempts = 0
  api.defaults.adapter = config => {
    if (config.url === '/auth/me') return Promise.resolve(response(config, { user: userFor('PARENT'), csrfToken: 'proof' }))
    attempts += 1
    return new Promise((resolve, reject) => {
      rejectLogout = () => reject(new AxiosError('Network Error', 'ERR_NETWORK', config))
      resolveLogout = () => resolve(response(config, { csrfToken: 'after-logout' }))
    })
  }
  open()
  await screen.findByText('PARENT')
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
  await waitFor(() => expect(rejectLogout).toBeTypeOf('function'))
  expect(screen.getByText('PARENT')).toBeInTheDocument()
  rejectLogout()
  await screen.findByRole('alert')
  expect(screen.getByText('PARENT')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
  await waitFor(() => expect(attempts).toBe(2))
  resolveLogout()
  expect(await screen.findByText('Anonymous')).toBeInTheDocument()
})

test('an expired protected request ends the local view while a connection failure does not', async () => {
  let expired = false
  api.defaults.adapter = config => config.url === '/auth/me'
    ? Promise.resolve(response(config, { user: userFor('PARENT'), csrfToken: 'proof' }))
    : expired ? failure(config, 401, 'Session expired') : Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config))
  open()
  await screen.findByText('PARENT')
  fireEvent.click(screen.getByRole('button', { name: 'Protected request' }))
  await waitFor(() => expect(screen.getByText('PARENT')).toBeInTheDocument())
  expired = true
  fireEvent.click(screen.getByRole('button', { name: 'Protected request' }))
  expect(await screen.findByText('Anonymous')).toBeInTheDocument()
  expect(screen.getByText('Your session has expired. Please log in again.')).toBeInTheDocument()
})

test('a temporary startup failure shows retry instead of sending a valid cookie session to login', async () => {
  let first = true
  api.defaults.adapter = config => {
    if (first) { first = false; return Promise.reject(new AxiosError('Network Error', 'ERR_NETWORK', config)) }
    return Promise.resolve(response(config, { user: userFor('PARENT'), csrfToken: 'proof' }))
  }
  render(<MemoryRouter initialEntries={['/parent']}><AuthProvider><Routes>
    <Route element={<ProtectedRoute roles={['PARENT']} />}><Route path="/parent" element={<div>Parent dashboard</div>} /></Route>
    <Route path="/login" element={<div>Login page</div>} />
  </Routes></AuthProvider></MemoryRouter>)
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach WonderTutor')
  expect(screen.queryByText('Login page')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Parent dashboard')).toBeInTheDocument()
})

test.each([200, 401])('a stale startup response (%s) cannot replace a newer login or its CSRF proof', async status => {
  let finishStartup, logoutProof
  api.defaults.adapter = config => {
    if (config.url === '/auth/me') return new Promise((resolve, reject) => {
      finishStartup = () => status === 200 ? resolve(response(config, { user: userFor('PARENT'), csrfToken: 'old-session' }))
        : reject(new AxiosError('Expired', undefined, config, undefined, { status: 401, config, data: { message: 'Session expired' } }))
    })
    if (config.url === '/auth/csrf') return Promise.resolve(response(config, { csrfToken: 'anonymous' }))
    if (config.url === '/auth/login') return Promise.resolve(response(config, { user: userFor('ADMIN'), csrfToken: 'new-session' }))
    logoutProof = config.headers.get('X-CSRF-Token')
    return Promise.resolve(response(config, { csrfToken: 'logged-out' }))
  }
  open()
  await waitFor(() => expect(finishStartup).toBeTypeOf('function'))
  fireEvent.click(screen.getByRole('button', { name: 'Remembered login' }))
  await screen.findByText('ADMIN')
  await act(async () => finishStartup())
  expect(screen.getByText('ADMIN')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Logout' }))
  await screen.findByText('Anonymous')
  expect(logoutProof).toBe('new-session')
})

test('an earlier protected request cannot expire a different session signed in while it was pending', async () => {
  let endOldRequest
  api.defaults.adapter = config => {
    if (config.url === '/auth/me') return Promise.resolve(response(config, { user: userFor('PARENT'), csrfToken: 'old-session' }))
    if (config.url === '/auth/login') return Promise.resolve(response(config, { user: userFor('ADMIN'), csrfToken: 'new-session' }))
    return new Promise((resolve, reject) => { endOldRequest = () => reject(new AxiosError('Expired', undefined, config, undefined, { status: 401, config, data: { message: 'Session expired' } })) })
  }
  open()
  await screen.findByText('PARENT')
  fireEvent.click(screen.getByRole('button', { name: 'Protected request' }))
  await waitFor(() => expect(endOldRequest).toBeTypeOf('function'))
  fireEvent.click(screen.getByRole('button', { name: 'Remembered login' }))
  await screen.findByText('ADMIN')
  await act(async () => endOldRequest())
  expect(screen.getByText('ADMIN')).toBeInTheDocument()
  expect(screen.queryByText(/session has expired/i)).not.toBeInTheDocument()
})
