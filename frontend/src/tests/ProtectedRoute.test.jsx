import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

let auth = { user: null, loading: false }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

import ProtectedRoute, { homeFor } from '../components/ProtectedRoute'

const renderAt = (path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
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
    expect(screen.getByText('LOGIN PAGE')).toBeInTheDocument()
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

  test('homeFor maps each role to its portal', () => {
    expect([homeFor('PARENT'), homeFor('TUTOR'), homeFor('ADMIN')]).toEqual(['/parent', '/tutor', '/admin'])
  })
})
