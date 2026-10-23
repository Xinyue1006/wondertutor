import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({
  default: { post: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))

import api from '../api/client'
import ChangeEmail from '../components/ChangeEmail'

const fail = (message, status = 400) => Object.assign(new Error('Request failed'), { response: { status, data: { message } } })
const renderCard = (props = {}) => {
  const onChanged = vi.fn()
  render(<ChangeEmail email="old@example.com" hasPassword onChanged={onChanged} {...props} />)
  return onChanged
}

beforeEach(() => vi.clearAllMocks())

describe('changing the login email', () => {
  test('a Google account is told its email is managed by Google, with no form', () => {
    renderCard({ hasPassword: false })
    expect(screen.getByText(/managed by your Google account/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/New email address/)).not.toBeInTheDocument()
  })

  test('checks the new address and the password before asking the server', async () => {
    renderCard()
    await userEvent.click(screen.getByRole('button', { name: 'Send code to new email' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/email/i)
    await userEvent.type(screen.getByLabelText('New email address'), 'old@example.com')
    await userEvent.type(screen.getByLabelText('Your password'), 'Secret1234')
    await userEvent.click(screen.getByRole('button', { name: 'Send code to new email' }))
    expect(screen.getByRole('alert')).toHaveTextContent('That is already your email address')
    expect(api.post).not.toHaveBeenCalled()
  })

  test('sends the code, then confirms it, and reports the new email', async () => {
    api.post.mockResolvedValueOnce({ data: { message: 'We sent a 6-digit code to new@example.com.' } })
    api.post.mockResolvedValueOnce({ data: { message: 'Your email has been changed.', user: { email: 'new@example.com' } } })
    const onChanged = renderCard()

    await userEvent.type(screen.getByLabelText('New email address'), ' New@Example.com ')
    await userEvent.type(screen.getByLabelText('Your password'), 'Secret1234')
    await userEvent.click(screen.getByRole('button', { name: 'Send code to new email' }))
    expect(api.post).toHaveBeenCalledWith('/auth/change-email/request', { newEmail: 'new@example.com', password: 'Secret1234' })

    await userEvent.type(await screen.findByLabelText('6-digit code'), '12ab3456')
    expect(screen.getByLabelText('6-digit code')).toHaveValue('123456') // only digits are kept
    await userEvent.click(screen.getByRole('button', { name: 'Confirm new email' }))
    expect(api.post).toHaveBeenLastCalledWith('/auth/change-email/confirm', { newEmail: 'new@example.com', code: '123456' })
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('new@example.com'))
    expect(screen.getByText('Your email has been changed.')).toBeInTheDocument()
  })

  test('shows the server message for a wrong password or taken address, and keeps the form', async () => {
    api.post.mockRejectedValueOnce(fail('Incorrect password'))
    renderCard()
    await userEvent.type(screen.getByLabelText('New email address'), 'new@example.com')
    await userEvent.type(screen.getByLabelText('Your password'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Send code to new email' }))
    expect(await screen.findByText('Incorrect password')).toBeInTheDocument()
    expect(screen.getByLabelText('New email address')).toHaveValue('new@example.com')
  })

  test('a wrong code is explained and can be retried, or another address chosen', async () => {
    api.post.mockResolvedValueOnce({ data: { message: 'Code sent.' } })
    api.post.mockRejectedValueOnce(fail('Incorrect code'))
    renderCard()
    await userEvent.type(screen.getByLabelText('New email address'), 'new@example.com')
    await userEvent.type(screen.getByLabelText('Your password'), 'Secret1234')
    await userEvent.click(screen.getByRole('button', { name: 'Send code to new email' }))
    await userEvent.type(await screen.findByLabelText('6-digit code'), '111111')
    await userEvent.click(screen.getByRole('button', { name: 'Confirm new email' }))
    expect(await screen.findByText('Incorrect code')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Use a different email' }))
    expect(screen.getByLabelText('New email address')).toHaveValue('')
  })
})
