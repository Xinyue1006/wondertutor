import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

let auth = { user: null }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))

import TutorStatusBanner from '../components/TutorStatusBanner'

const renderAt = (path, tutorStatus) => {
  auth = { user: { role: 'TUTOR', tutorStatus } }
  return render(<MemoryRouter initialEntries={[path]}><TutorStatusBanner /></MemoryRouter>)
}

describe('tutor status banner', () => {
  test('a tutor who has not submitted is asked to complete the profile', () => {
    renderAt('/tutor', 'NOT_SUBMITTED')
    expect(screen.getByRole('status')).toHaveTextContent(/verified badge and appear higher in search/)
    expect(screen.getByRole('link', { name: 'Complete profile' })).toHaveAttribute('href', '/tutor/setup')
  })

  test('a tutor under review is told what verification will give them', () => {
    renderAt('/tutor/earnings', 'UNDER_REVIEW')
    expect(screen.getByRole('link', { name: 'View status' })).toHaveAttribute('href', '/tutor/verification')
  })

  test('nothing is shown to a verified tutor, or on the setup and status pages', () => {
    renderAt('/tutor', 'VERIFIED')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    renderAt('/tutor/setup', 'NOT_SUBMITTED')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
