import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { vi } from 'vitest'

let auth = { user: null, loading: false }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

import ProtectedRoute, { afterLogin, homeFor, VerifiedTutorRoute } from '../components/ProtectedRoute'

// Shows where the login page was asked to return to
function LoginStub() {
  return <div>LOGIN PAGE {useLocation().state?.from}</div>
}

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginStub />} />
        <Route path="/parent" element={<div>PARENT HOME</div>} />
        <Route path="/admin" element={<div>ADMIN HOME</div>} />
        <Route element={<ProtectedRoute roles={['ADMIN']} />}>
          <Route path="/admin/users" element={<div>ADMIN USERS</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

describe('role-based route protection', () => {
  test('visitors are sent to the login page', () => {
    auth = { user: null, loading: false }
    renderAt('/admin/users')
    expect(screen.getByText(/^LOGIN PAGE/)).toBeInTheDocument()
  })

  test('a parent cannot open an admin page; they are sent to their own home', () => {
    auth = { user: { role: 'PARENT' }, loading: false }
    renderAt('/admin/users')
    expect(screen.getByText('PARENT HOME')).toBeInTheDocument()
    expect(screen.queryByText('ADMIN USERS')).not.toBeInTheDocument()
  })

  test('an admin can open the admin page', () => {
    auth = { user: { role: 'ADMIN' }, loading: false }
    renderAt('/admin/users')
    expect(screen.getByText('ADMIN USERS')).toBeInTheDocument()
  })

  test('while the session is loading nothing is decided yet', () => {
    auth = { user: null, loading: true }
    renderAt('/admin/users')
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  test('the login page is told which page the visitor was trying to open', () => {
    auth = { user: null, loading: false }
    renderAt('/admin/users?status=ACTIVE')
    expect(screen.getByText('LOGIN PAGE /admin/users?status=ACTIVE')).toBeInTheDocument()
  })

  test('after login the user returns to that page, but only inside their own portal', () => {
    expect(afterLogin({ role: 'PARENT' }, '/parent/bookings?booking=12')).toBe('/parent/bookings?booking=12')
    expect(afterLogin({ role: 'PARENT' }, '/admin/users')).toBe('/parent')
    expect(afterLogin({ role: 'PARENT' }, '/parentfake')).toBe('/parent')
    expect(afterLogin({ role: 'PARENT' }, '//evil.example.com')).toBe('/parent')
    expect(afterLogin({ role: 'ADMIN' }, undefined)).toBe('/admin')
  })

  test('homeFor maps each role to its portal', () => {
    expect([homeFor('PARENT'), homeFor('TUTOR'), homeFor('ADMIN')]).toEqual(['/parent', '/tutor', '/admin'])
  })
})

describe('tutor verification gate', () => {
  const renderTutorAt = (path) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ProtectedRoute roles={['TUTOR']} />}>
            <Route path="/tutor/verification" element={<div>VERIFICATION STATUS</div>} />
            <Route path="/tutor/setup" element={<div>PROFILE SETUP</div>} />
            <Route element={<VerifiedTutorRoute />}>
              <Route path="/tutor" element={<div>TUTOR DASHBOARD</div>} />
              <Route path="/tutor/earnings" element={<div>EARNINGS</div>} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>,
    )

  test('an unverified tutor is sent from a teaching page to the verification status page', () => {
    auth = { user: { role: 'TUTOR', tutorStatus: 'UNDER_REVIEW' }, loading: false }
    renderTutorAt('/tutor/earnings')
    expect(screen.getByText('VERIFICATION STATUS')).toBeInTheDocument()
    expect(screen.queryByText('EARNINGS')).not.toBeInTheDocument()
  })

  test('an unverified tutor can still open the setup', () => {
    auth = { user: { role: 'TUTOR', tutorStatus: 'NOT_SUBMITTED' }, loading: false }
    renderTutorAt('/tutor/setup')
    expect(screen.getByText('PROFILE SETUP')).toBeInTheDocument()
  })

  test('a verified tutor reaches the dashboard', () => {
    auth = { user: { role: 'TUTOR', tutorStatus: 'VERIFIED' }, loading: false }
    renderTutorAt('/tutor')
    expect(screen.getByText('TUTOR DASHBOARD')).toBeInTheDocument()
  })

  test('after login a tutor goes to setup, status or dashboard depending on verification', () => {
    expect(afterLogin({ role: 'TUTOR', tutorStatus: 'NOT_SUBMITTED' })).toBe('/tutor/setup')
    expect(afterLogin({ role: 'TUTOR', tutorStatus: 'UNDER_REVIEW' })).toBe('/tutor/verification')
    expect(afterLogin({ role: 'TUTOR', tutorStatus: 'CHANGES_REQUESTED' }, '/tutor/earnings')).toBe('/tutor/verification')
    expect(afterLogin({ role: 'TUTOR', tutorStatus: 'UNDER_REVIEW' }, '/tutor/preview')).toBe('/tutor/preview')
    expect(afterLogin({ role: 'TUTOR', tutorStatus: 'VERIFIED' })).toBe('/tutor')
  })
})
