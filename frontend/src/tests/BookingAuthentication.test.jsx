import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
import api from '../api/client'
import Login from '../pages/auth/Login'
import Signup from '../pages/auth/Signup'

const auth = vi.hoisted(() => ({ login: vi.fn(), saveSession: vi.fn(), googleLogin: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ ...auth, user: null, loading: false }) }))
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: error => error.message }))

const booking = '/parent/tutors/7/book'
function LocationProbe() {
  const location = useLocation()
  return <output data-testid="booking-return">{location.state?.from || ''}</output>
}
function setup(pathname, state) {
  render(<MemoryRouter initialEntries={[{ pathname, state }]}>
    <LocationProbe />
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path={booking} element={<div>REQUESTED BOOKING</div>} />
      <Route path="/parent" element={<div>PARENT DASHBOARD</div>} />
    </Routes>
  </MemoryRouter>)
}
beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  auth.login.mockResolvedValue({ id: 1, role: 'PARENT' })
  api.get.mockResolvedValue({ data: { subjects: [], tutors: [], locations: [] } })
  api.post.mockResolvedValue({ data: { user: { id: 1, role: 'PARENT' }, csrfToken: 'test-csrf' } })
})

test('parent login resumes the tutor booking chosen while browsing as a guest', async () => {
  setup('/login', { from: booking })
  await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'parent@example.test')
  await userEvent.type(screen.getByPlaceholderText('Enter your password'), 'Parent1234')
  await userEvent.click(screen.getByRole('button', { name: 'Log in', exact: true }))
  expect(await screen.findByText('REQUESTED BOOKING')).toBeInTheDocument()
})

test('switching between login and signup keeps the booking destination', async () => {
  setup('/login', { from: booking })
  await userEvent.click(screen.getByRole('link', { name: 'Create an account' }))
  expect(screen.getByTestId('booking-return')).toHaveTextContent(booking)
  await userEvent.click(screen.getByRole('link', { name: 'Log in', exact: true }))
  expect(screen.getByTestId('booking-return')).toHaveTextContent(booking)
  expect(screen.getByRole('button', { name: 'Log in', exact: true })).toBeEnabled()
})

test('email verification resumes the requested booking for a new parent', async () => {
  setup('/signup', { verifyEmail: 'parent@example.test', from: booking })
  fireEvent.change(screen.getByLabelText('Digit 1 of 6'), { target: { value: '123456' } })
  await userEvent.click(screen.getByRole('button', { name: 'Verify and continue' }))
  expect(await screen.findByText('REQUESTED BOOKING')).toBeInTheDocument()
  expect(auth.saveSession).toHaveBeenCalledWith({ id: 1, role: 'PARENT' }, 'test-csrf')
})

test.each(['https://outside.example/path', '//outside.example/path', '/admin/users'])('verification rejects the unsafe or wrong-role return path %s', async from => {
  setup('/signup', { verifyEmail: 'parent@example.test', from })
  fireEvent.change(screen.getByLabelText('Digit 1 of 6'), { target: { value: '123456' } })
  await userEvent.click(screen.getByRole('button', { name: 'Verify and continue' }))
  expect(await screen.findByText('PARENT DASHBOARD')).toBeInTheDocument()
})
