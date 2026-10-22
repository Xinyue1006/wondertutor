import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

const logout = vi.fn()
const navigate = vi.fn()
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ logout }) }))
vi.mock('react-router-dom', async (orig) => ({ ...(await orig()), useNavigate: () => navigate }))
vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))
vi.mock('../lib/download', () => ({ downloadFile: vi.fn() }))

import api from '../api/client'
import { downloadFile } from '../lib/download'
import PrivacyAccountCard from '../components/PrivacyAccountCard'

const EMAIL = 'miki@example.com'
const renderCard = (props = {}) =>
  render(<MemoryRouter><PrivacyAccountCard emailReminders privacyAcceptedAt="2026-10-01T00:00:00Z" email={EMAIL} {...props} /></MemoryRouter>)

const fail = (message, status = 409) => Object.assign(new Error('Request failed'), { response: { status, data: { message } } })
const canDelete = (extra = {}) => ({ data: { canDelete: true, hasPassword: true, blockers: { bookings: 0, refunds: 0, complaints: 0 }, ...extra } })

beforeEach(() => vi.clearAllMocks())

describe('reminder emails switch', () => {
  test('is on, can be switched off, and says what that means', async () => {
    api.put.mockResolvedValue({ data: { emailReminders: false } })
    renderCard()
    const sw = screen.getByRole('switch', { name: 'Reminder emails' })
    expect(sw).toBeChecked()
    await userEvent.click(sw)
    expect(api.put).toHaveBeenCalledWith('/parent/account/email-reminders', { enabled: false })
    expect(await screen.findByText(/You still get reminders in the app/)).toBeInTheDocument()
    expect(sw).not.toBeChecked()
  })

  test('shows when the Privacy Notice was accepted and links to it', () => {
    renderCard()
    expect(screen.getByText(/you accepted it on/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Privacy Notice' })).toHaveAttribute('href', '/privacy')
  })
})

describe('download my data', () => {
  test('saves the file', async () => {
    downloadFile.mockResolvedValue('')
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: /Download my data/ }))
    expect(downloadFile).toHaveBeenCalledWith('/parent/account/export', 'wondertutor-my-data.json')
    expect(await screen.findByText(/downloaded/)).toBeInTheDocument()
  })

  test('shows the reason when it fails', async () => {
    downloadFile.mockResolvedValue('Please log in')
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: /Download my data/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Please log in')
  })
})

describe('delete my account', () => {
  test('says what is still open and does not offer the delete form', async () => {
    api.get.mockResolvedValue({ data: { canDelete: false, hasPassword: true, blockers: { bookings: 2, refunds: 1, complaints: 0 } } })
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: /Delete my account…/ }))
    expect(await screen.findByText(/booking/, { selector: 'li' })).toHaveTextContent('2 bookings')
    expect(screen.getByText(/refund request/, { selector: 'li' })).toHaveTextContent('1 refund request')
    expect(screen.queryByRole('button', { name: /Delete my account permanently/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'My Bookings' })).toHaveAttribute('href', '/parent/bookings')
  })

  test('needs the email typed and the password before the button works, then goes to Log In and logs out', async () => {
    api.get.mockResolvedValue(canDelete())
    api.post.mockResolvedValue({ data: { message: 'deleted' } })
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: /Delete my account…/ }))
    const del = await screen.findByRole('button', { name: 'Delete my account permanently' })
    expect(screen.getByText('Will be removed')).toBeInTheDocument()
    expect(screen.getByText(/Will stay, without your name/)).toBeInTheDocument()
    expect(del).toBeDisabled()

    const emailBox = screen.getByLabelText(/Type your email to confirm/)
    await userEvent.type(emailBox, 'wrong@example.com')
    await userEvent.type(screen.getByLabelText('Your password'), 'Secret1234')
    expect(del).toBeDisabled() // the email does not match

    await userEvent.clear(emailBox)
    await userEvent.type(emailBox, EMAIL.toUpperCase())
    expect(del).toBeEnabled()
    await userEvent.click(del)

    expect(api.post).toHaveBeenCalledWith('/parent/account/delete', { confirmEmail: EMAIL.toUpperCase(), password: 'Secret1234' })
    await waitFor(() => expect(logout).toHaveBeenCalled())
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true, state: { deleted: true } })
  })

  test('a Google account has no password box', async () => {
    api.get.mockResolvedValue(canDelete({ hasPassword: false }))
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: /Delete my account…/ }))
    await screen.findByRole('button', { name: 'Delete my account permanently' })
    expect(screen.queryByLabelText('Your password')).not.toBeInTheDocument()
  })

  test('a wrong password is shown and the person stays logged in', async () => {
    api.get.mockResolvedValue(canDelete())
    api.post.mockRejectedValue(fail('Incorrect password', 400))
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: /Delete my account…/ }))
    await userEvent.type(await screen.findByLabelText(/Type your email to confirm/), EMAIL)
    await userEvent.type(screen.getByLabelText('Your password'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account permanently' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect password')
    expect(logout).not.toHaveBeenCalled()
  })
})
