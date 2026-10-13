import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

// A plain function (not vi.fn): Vitest's spy wrapper reports rejected promises from spies as unhandled errors
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
        <Route path="/admin" element={<div>ADMIN HOME</div>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => { loginCalls.length = 0; loginImpl = async () => ({ role: 'PARENT' }) })

describe('Login page', () => {
  test('shows the form and the mockup headline', () => {
    renderLogin()
    expect(screen.getByText('Welcome Back')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log In' })).toBeInTheDocument()
  })

  test('logs in and sends a parent to the parent portal', async () => {
    loginImpl = async () => ({ role: 'PARENT' })
    renderLogin()
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'parent@wondertutor.local')
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'Parent1234')
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }))
    expect(loginCalls).toEqual([['parent@wondertutor.local', 'Parent1234', true]])
    expect(await screen.findByText('PARENT HOME')).toBeInTheDocument()
  })

  test('an admin lands on the admin dashboard (role based redirect)', async () => {
    loginImpl = async () => ({ role: 'ADMIN' })
    renderLogin()
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'admin@wondertutor.local')
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'Admin1234')
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }))
    expect(await screen.findByText('ADMIN HOME')).toBeInTheDocument()
  })

  test('shows the server error for a wrong password and stays on the page', async () => {
    loginImpl = async () => { throw Object.assign(new Error('Request failed'), { response: { data: { message: 'Incorrect email or password' } } }) }
    renderLogin()
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'a@b.com')
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }))
    expect(await screen.findByText('Incorrect email or password')).toBeInTheDocument()
    expect(screen.queryByText('PARENT HOME')).not.toBeInTheDocument()
  })

  test('the password can be shown and hidden', async () => {
    renderLogin()
    const input = screen.getByPlaceholderText('Enter your password')
    expect(input).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')
  })

  test('Google sign-in explains itself when no client id is configured', async () => {
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))
    expect(await screen.findByText(/not configured yet/i)).toBeInTheDocument()
  })

  test('nothing is sent when the form is empty', async () => {
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }))
    await waitFor(() => expect(loginCalls).toHaveLength(0))
  })

  test('each problem is shown next to its own field and nothing is sent', async () => {
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }))
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('you@example.com')).toHaveAttribute('aria-invalid', 'true')
    expect(loginCalls).toHaveLength(0)
  })

  test('keyboard focus moves to the first field that needs fixing', async () => {
    renderLogin()
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }))
    expect(screen.getByPlaceholderText('you@example.com')).toHaveFocus()
  })

  test('a badly formed email is explained and the error clears once the visitor edits it', async () => {
    renderLogin()
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'not-an-email')
    await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'secret')
    await userEvent.click(screen.getByRole('button', { name: 'Log In' }))
    expect(await screen.findByText(/Enter a valid email/)).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'x')
    expect(screen.queryByText(/Enter a valid email/)).not.toBeInTheDocument()
  })
})
