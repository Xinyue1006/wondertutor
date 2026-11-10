import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

// Login with a reCAPTCHA site key configured. The real widget needs Google's script, so a stand-in checkbox
// reports a token the same way (onToken).
vi.mock('../components/Recaptcha', () => ({
  RECAPTCHA_SITE_KEY: 'test-site-key',
  resetRecaptcha: vi.fn(),
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

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))
vi.mock('../lib/loadScript', () => ({ loadScript: () => Promise.resolve() }))

import api from '../api/client'
import { resetRecaptcha } from '../components/Recaptcha'
import Login from '../pages/auth/Login'
import Signup from '../pages/auth/Signup'

const renderLogin = () =>
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/parent" element={<div>PARENT HOME</div>} />
        <Route path="/tutor" element={<div>TUTOR HOME</div>} />
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

  test('a tutor who is not verified yet still goes to the tutor portal after logging in', async () => {
    loginImpl = async () => ({ role: 'TUTOR', tutorStatus: 'NOT_SUBMITTED' })
    renderLogin()
    await fill()
    await userEvent.click(screen.getByRole('checkbox', { name: /I'm not a robot/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByText('TUTOR HOME')).toBeInTheDocument()
  })
})

describe('Sign up with reCAPTCHA', () => {
  const create = () => userEvent.click(screen.getByRole('button', { name: 'Create account and send code' }))

  test('a failed Create Account clears the token and asks for a new tick', async () => {
    sessionStorage.clear()
    vi.clearAllMocks()
    api.get.mockResolvedValue({ data: { subjects: [], locations: [], tutors: [] } })
    api.post.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { data: { message: 'An account with this email already exists' } } }))
    render(<MemoryRouter><Signup /></MemoryRouter>)

    await userEvent.click(screen.getByRole('radio', { name: /I'm a Tutor/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Continue as Tutor/ }))
    await userEvent.type(screen.getByLabelText(/Full name/), 'Daniel Tan')
    await userEvent.type(screen.getByLabelText(/Email address/), 'daniel@example.com')
    await userEvent.type(screen.getByLabelText(/Phone number/), '0123456789')
    await userEvent.type(screen.getByLabelText(/^Password/), 'Tutor1234')
    await userEvent.type(screen.getByLabelText(/Confirm password/), 'Tutor1234')
    await userEvent.click(screen.getByRole('checkbox', { name: /Terms of Use/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /I'm not a robot/ }))

    await create()
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/)
    expect(api.post.mock.calls[0][1].recaptchaToken).toBe('captcha-token')
    expect(resetRecaptcha).toHaveBeenCalledTimes(1)

    await create()
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a robot/)
    expect(api.post).toHaveBeenCalledTimes(1) // the used token was not sent again
  })
})

describe('Recaptcha widget', () => {
  test('a new widget clears any old token, and reset goes to the current widget', async () => {
    vi.stubEnv('VITE_RECAPTCHA_SITE_KEY', 'test-site-key')
    window.grecaptcha = { ready: (fn) => fn(), render: vi.fn(() => 7), reset: vi.fn() }
    const { default: RealRecaptcha, resetRecaptcha: realReset } = await vi.importActual('../components/Recaptcha')
    const onToken = vi.fn()
    render(<RealRecaptcha onToken={onToken} />)
    await waitFor(() => expect(onToken).toHaveBeenCalledWith(''))
    realReset()
    expect(window.grecaptcha.reset).toHaveBeenCalledWith(7)
    vi.unstubAllEnvs()
    delete window.grecaptcha
  })
})
