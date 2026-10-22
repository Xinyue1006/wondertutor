import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

let auth = { user: null }
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
import Privacy from '../pages/Privacy'

const renderPage = () => render(<MemoryRouter><Privacy /></MemoryRouter>)
beforeEach(() => { auth = { user: null } })

describe('Privacy Notice page', () => {
  test('has the sections a parent looks for, in plain language', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Notice' })).toBeInTheDocument()
    for (const title of ['Who we are', 'What we collect', 'Why we use it', 'Who can see it', 'Children’s information', 'How long we keep it', 'Your rights', 'Keeping it safe', 'Using WonderTutor']) {
      expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument()
    }
    expect(screen.getByText(/Last updated/)).toBeInTheDocument()
  })

  test('says where to download, correct and delete the data', () => {
    renderPage()
    expect(screen.getByText(/Download my data/)).toBeInTheDocument()
    expect(screen.getByText(/Delete my account/)).toBeInTheDocument()
  })
})

describe('going back from the Privacy Notice', () => {
  test('a visitor goes back to the landing page', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /Back to WonderTutor/ })).toHaveAttribute('href', '/')
  })

  test('a logged-in parent, tutor or admin goes back to their own dashboard', () => {
    for (const [role, home] of [['PARENT', '/parent'], ['TUTOR', '/tutor'], ['ADMIN', '/admin']]) {
      auth = { user: { role } }
      const { unmount } = renderPage()
      expect(screen.getByRole('link', { name: /Back to my dashboard/ })).toHaveAttribute('href', home)
      unmount()
    }
  })
})
