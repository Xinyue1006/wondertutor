import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import AdminLogin from '../pages/auth/AdminLogin'
import ProtectedRoute from '../components/ProtectedRoute'
import ForgotPassword from '../pages/auth/ForgotPassword'

const auth = vi.hoisted(() => ({ user: null, loading: false, login: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../api/client', () => ({ default: { post: vi.fn() }, errorMessage: (err) => err.message }))
vi.mock('../components/Recaptcha', () => ({ RECAPTCHA_SITE_KEY: '', resetRecaptcha: vi.fn(), default: () => null }))

beforeEach(() => { auth.user = null; auth.login.mockReset() })
function open(path = '/admin/login') {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/admin/login" element={<AdminLogin />} />
    <Route path="/forgot-password" element={<ForgotPassword />} />
    <Route element={<ProtectedRoute roles={['ADMIN']} />}>
      <Route path="/admin" element={<div>ADMIN HOME</div>} />
      <Route path="/admin/users" element={<div>ADMIN USERS</div>} />
    </Route>
  </Routes></MemoryRouter>)
}
const fill = () => {
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'admin@example.test' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Test1234' } })
  fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
}

test('admin login has no signup or Google creation controls', () => {
  open()
  expect(screen.getByRole('heading', { name: 'Admin login' })).toBeInTheDocument()
  expect(screen.queryByText(/Continue with Google/)).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument()
})

test('a protected admin page uses admin login and preserves the original destination', async () => {
  auth.login.mockImplementation(async () => { auth.user = { role: 'ADMIN' }; return auth.user })
  open('/admin/users?status=ACTIVE')
  fill()
  await screen.findByText('ADMIN USERS')
  expect(auth.login).toHaveBeenCalledWith('admin@example.test', 'Test1234', true, '', 'ADMIN')
})

test('a rejected non-admin login stays on the admin login page', async () => {
  auth.login.mockRejectedValue(new Error('Please use an administrator account to log in here.'))
  open()
  fill()
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('administrator account'))
  expect(screen.queryByText('ADMIN HOME')).not.toBeInTheDocument()
})

test('password reset returns administrators to the admin login page', () => {
  open()
  fireEvent.click(screen.getByRole('link', { name: 'Forgot password?' }))
  expect(screen.getByRole('link', { name: /Back to log\s?in/i })).toHaveAttribute('href', '/admin/login')
})
