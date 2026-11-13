import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AxiosError } from 'axios'
import { afterEach, beforeEach, expect, test } from 'vitest'
import api, { clearCsrfToken } from '../api/client'
import { AuthProvider, useAuth } from '../context/AuthContext'
import ProtectedRoute from '../components/ProtectedRoute'
import { LogoutButton } from '../layouts/AppLayout'
import Login from '../pages/auth/Login'

const originalAdapter = api.defaults.adapter
const reply = (config, data) => Promise.resolve({ config, data, status: 200, statusText: 'OK', headers: {} })
const unauthenticated = config => Promise.reject(new AxiosError('Session expired', undefined, config, undefined, { config, status: 401, data: { message: 'Session expired' }, headers: {} }))
const account = (id, role) => ({ id, role, fullName: `Account ${id}`, email: `account${id}@example.test` })
let signedIn, nextAccount
const loginState = () => JSON.parse(screen.getByTestId('login-return').textContent)

beforeEach(() => {
  clearCsrfToken()
  signedIn = null
  api.defaults.adapter = config => {
    if (config.url === '/auth/me') return signedIn ? reply(config, { user: signedIn, csrfToken: `proof-${signedIn.id}` }) : unauthenticated(config)
    if (config.url === '/auth/csrf') return reply(config, { csrfToken: 'anonymous' })
    if (config.url === '/auth/logout') { signedIn = null; return reply(config, { csrfToken: 'anonymous' }) }
    if (config.url === '/auth/login') { signedIn = nextAccount; return reply(config, { user: signedIn, csrfToken: `proof-${signedIn.id}` }) }
    return unauthenticated(config)
  }
})
afterEach(() => { api.defaults.adapter = originalAdapter; clearCsrfToken() })

function LoginPage({ admin }) {
  const { state } = useLocation()
  return <><output hidden data-testid="login-return">{JSON.stringify(state || null)}</output><Login admin={admin} /></>
}
function PrivatePage() {
  const { user } = useAuth()
  const location = useLocation()
  return <div>
    <p>Private page for account {user.id}</p>
    <p>{location.pathname + location.search}</p>
    <LogoutButton />
    <button onClick={() => api.get('/expired-private-request').catch(() => {})}>Expire session</button>
  </div>
}
function Dashboard() {
  const { user } = useAuth()
  return <p>Dashboard for account {user.id}</p>
}
function open(role, page) {
  const portal = role.toLowerCase()
  render(<MemoryRouter initialEntries={[page]}><AuthProvider><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/admin/login" element={<LoginPage admin />} />
    <Route element={<ProtectedRoute roles={[role]} />}>
      <Route path={`/${portal}`} element={<Dashboard />} />
      <Route path={`/${portal}/payments`} element={<PrivatePage />} />
    </Route>
  </Routes></AuthProvider></MemoryRouter>)
}
async function login() {
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: nextAccount.email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Test1234' } })
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

test.each(['PARENT', 'TUTOR', 'ADMIN'])('explicit %s logout never carries the previous private page into the next account', async role => {
  signedIn = account(1, role)
  nextAccount = account(2, role)
  open(role, `/${role.toLowerCase()}/payments?receipt=old-account`)
  await screen.findByText('Private page for account 1')
  fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
  await screen.findByRole('button', { name: 'Log in' })
  expect(loginState()?.from).toBeUndefined()
  await login()
  expect(await screen.findByText('Dashboard for account 2')).toBeInTheDocument()
  expect(screen.queryByText('Private page for account 2')).not.toBeInTheDocument()
})

test('a fresh anonymous deep link still resumes its intended page after login', async () => {
  nextAccount = account(2, 'PARENT')
  open('PARENT', '/parent/payments?receipt=new-account')
  await screen.findByRole('button', { name: 'Log in' })
  expect(loginState()).toEqual({ from: '/parent/payments?receipt=new-account' })
  await login()
  expect(await screen.findByText('Private page for account 2')).toBeInTheDocument()
  expect(screen.getByText('/parent/payments?receipt=new-account')).toBeInTheDocument()
})

test.each([1, 2])('an expired-session destination is tied to its original account when account %s logs in', async nextId => {
  signedIn = account(1, 'PARENT')
  nextAccount = account(nextId, 'PARENT')
  open('PARENT', '/parent/payments?receipt=account-one')
  await screen.findByText('Private page for account 1')
  fireEvent.click(screen.getByRole('button', { name: 'Expire session' }))
  await screen.findByRole('button', { name: 'Log in' })
  expect(loginState()).toEqual({ from: '/parent/payments?receipt=account-one', fromUserId: 1 })
  await login()
  expect(await screen.findByText(nextId === 1 ? 'Private page for account 1' : 'Dashboard for account 2')).toBeInTheDocument()
})
