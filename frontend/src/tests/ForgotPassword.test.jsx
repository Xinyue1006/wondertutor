import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({
  default: { post: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))

import api from '../api/client'
import ForgotPassword from '../pages/auth/ForgotPassword'

const renderPage = () => render(<MemoryRouter><ForgotPassword /></MemoryRouter>)

beforeEach(() => vi.clearAllMocks())

describe('forgot password', () => {
  test('asks for the email, then for the code and a new password', async () => {
    api.post.mockResolvedValue({ data: { message: 'If an account uses this email, we have sent a 6-digit code to it.' } })
    renderPage()
    await userEvent.type(screen.getByLabelText('Email Address'), 'miki@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send Code' }))
    expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'miki@example.com' })
    expect(await screen.findByLabelText('6-digit Code')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('6-digit Code'), '123456')
    await userEvent.type(screen.getByLabelText('New Password'), 'NewPass123')
    await userEvent.type(screen.getByLabelText('Confirm New Password'), 'NewPass123')
    await userEvent.click(screen.getByRole('button', { name: 'Reset Password' }))
    expect(api.post).toHaveBeenLastCalledWith('/auth/reset-password', { email: 'miki@example.com', code: '123456', newPassword: 'NewPass123' })
    expect(await screen.findByText('Password reset')).toBeInTheDocument()
  })

  test('checks the new password before sending it', async () => {
    api.post.mockResolvedValue({ data: { message: 'sent' } })
    renderPage()
    await userEvent.type(screen.getByLabelText('Email Address'), 'miki@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send Code' }))
    await userEvent.type(await screen.findByLabelText('6-digit Code'), '123456')
    await userEvent.type(screen.getByLabelText('New Password'), 'NewPass123')
    await userEvent.type(screen.getByLabelText('Confirm New Password'), 'Different123')
    await userEvent.click(screen.getByRole('button', { name: 'Reset Password' }))
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledTimes(1) // only the "send code" call
  })

  test('shows the server message for a wrong code', async () => {
    api.post.mockResolvedValueOnce({ data: { message: 'sent' } })
    api.post.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { data: { message: 'Incorrect code' } } }))
    renderPage()
    await userEvent.type(screen.getByLabelText('Email Address'), 'miki@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Send Code' }))
    await userEvent.type(await screen.findByLabelText('6-digit Code'), '999999')
    await userEvent.type(screen.getByLabelText('New Password'), 'NewPass123')
    await userEvent.type(screen.getByLabelText('Confirm New Password'), 'NewPass123')
    await userEvent.click(screen.getByRole('button', { name: 'Reset Password' }))
    expect(await screen.findByText('Incorrect code')).toBeInTheDocument()
  })
})
