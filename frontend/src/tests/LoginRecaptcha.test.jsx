import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

// Login with a reCAPTCHA site key configured. The real widget needs Google's script, so a stand-in checkbox
// reports a token the same way (onToken).
vi.mock('../components/Recaptcha', () => ({
  RECAPTCHA_SITE_KEY: 'test-site-key',
  default: ({ onToken }) => (
    <label>
      <input type="checkbox" onChange={(e) => onToken(e.target.checked ? 'captcha-token' : '')} /> I'm not a robot
    </label>
  ),
}))

let loginImpl = async () => ({ role: 'PARENT' })
const loginCalls = []
const login = (...args) => { loginCalls.push(args); return loginImpl(...args) }
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ login, googleLogin: () => {}, user: null, loading: false }) }))

import Login from '../pages/auth/Login'

const renderLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/parent" element={<div>PARENT HOME</div>} />
        <Route path="/tutor/setup" element={<div>TUTOR SETUP</div>} />
      </Routes>
    </MemoryRouter>,
  )

async function fill() {
  await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'parent@wondertutor.local')
  await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'Parent1234')
}

beforeEach(() => { loginCalls.length = 0; loginImpl = async () => ({ role: 'PARENT' }) })

describe('Login with reCAPTCHA', () => {
  test('shows the reCAPTCHA and does not send the form until it is ticked', async () => {
    renderLogin()
    expect(screen.getByRole('checkbox', { name: /I'm not a robot/ })).toBeInTheDocument()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a robot/)
    expect(loginCalls).toHaveLength(0)
  })

  test('sends the reCAPTCHA token with the login and keeps the remember-me choice', async () => {
    renderLogin()
    await fill()
    await userEvent.click(screen.getByRole('checkbox', { name: /Remember me on this device/ })) // untick: session only
    await userEvent.click(screen.getByRole('checkbox', { name: /I'm not a robot/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(loginCalls).toEqual([['parent@wondertutor.local', 'Parent1234', false, 'captcha-token']])
    expect(await screen.findByText('PARENT HOME')).toBeInTheDocument()
  })

  test('a tutor who has not finished the setup is taken to it after logging in', async () => {
    loginImpl = async () => ({ role: 'TUTOR', tutorStatus: 'NOT_SUBMITTED' })
    renderLogin()
    await fill()
    await userEvent.click(screen.getByRole('checkbox', { name: /I'm not a robot/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('TUTOR SETUP')).toBeInTheDocument()
  })
})
