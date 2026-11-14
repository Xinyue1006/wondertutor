import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import Earnings from '../pages/tutor/Earnings'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, errorMessage: (e) => e.message }))

const bank = { id: 4, bankName: 'Example Bank', accountName: 'Example Tutor', lastFour: '7890' }
const view = { available: '45.00', totalEarned: 90, pending: 0, held: 0, withdrawn: 45, rate: 12, baseRate: 15, version: 'v1',
  bank, bankAuth: 'password', withdrawals: [], transactions: [] }
const row = (id, date, extra = {}) => ({ id, bookingId: 100 + id, date, subject: 'Mathematics', student: 'Sarah', fee: '100.00', commission: '12.00',
  originalCommission: '12.00', refunded: '0', rate: '12', net: '88.00', state: 'Earned', ...extra })
const show = (data = view) => {
  api.get.mockResolvedValue({ data })
  return render(<MemoryRouter><Earnings /></MemoryRouter>)
}

beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

test('shows the four balance cards with the tutor and base commission rates', async () => {
  show()
  expect(await screen.findByText('Available to withdraw')).toBeInTheDocument()
  expect(screen.getByText('Total earned: RM 90.00')).toBeInTheDocument()
  expect(screen.getByText('12%')).toBeInTheDocument()
  expect(screen.getByText('Platform base rate: 15%')).toBeInTheDocument()
  expect(screen.getByText('Total approved: RM 45.00')).toBeInTheDocument()
})

test('a new tutor sees empty states and cannot request a withdrawal without a bank', async () => {
  show({ ...view, available: '0.00', bank: null })
  expect(await screen.findByText('Add a bank account below to withdraw.')).toBeInTheDocument()
  expect(screen.getByText('No lesson payments for this period.')).toBeInTheDocument()
  expect(screen.getByText('No withdrawals yet.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Request withdrawal' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Add bank account' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Remove account' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled()
})

test('the withdraw button stays off until an amount is typed', async () => {
  show()
  const button = await screen.findByRole('button', { name: 'Request withdrawal' })
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Amount (RM)'), { target: { value: '5' } })
  expect(button).toBeEnabled()
  expect(screen.getByLabelText('Amount (RM)')).toHaveAttribute('max', '45')
})

test('a refused withdrawal shows the reason and reloads the balance', async () => {
  show()
  api.post.mockRejectedValue(new Error('Your balance changed. Refresh and check your withdrawal history.'))
  fireEvent.change(await screen.findByLabelText('Amount (RM)'), { target: { value: '5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Request withdrawal' }))
  expect(await screen.findByText(/Your balance changed/)).toBeInTheDocument()
  expect(api.get).toHaveBeenCalledTimes(2)
})

test('a lesson with a refund shows the refund and the original commission', async () => {
  show({ ...view, transactions: [row(1, new Date().toISOString(), { refunded: '33.33', commission: '8.00', net: '58.67' })] })
  const item = (await screen.findByText('Mathematics · Sarah')).closest('li')
  expect(within(item).getByText('Refund')).toBeInTheDocument()
  expect(within(item).getByText('RM 33.33')).toBeInTheDocument()
  expect(within(item).getByText('Original commission')).toBeInTheDocument()
  expect(within(item).getByText('RM 58.67')).toBeInTheDocument()
  expect(within(item).getByText(/Booking #101/)).toBeInTheDocument()
})

test('a lesson without a refund hides the refund lines', async () => {
  show({ ...view, transactions: [row(1, new Date().toISOString())] })
  const item = (await screen.findByText('Mathematics · Sarah')).closest('li')
  expect(within(item).queryByText('Refund')).toBeNull()
  expect(within(item).getByText('Commission (12%)')).toBeInTheDocument()
})

test('This month hides payments from earlier months', async () => {
  show({ ...view, transactions: [row(1, new Date().toISOString(), { student: 'Now' }), row(2, '2020-01-15T04:00:00.000Z', { student: 'Old' })] })
  await screen.findByText('Mathematics · Old')
  fireEvent.change(screen.getByLabelText('Transaction period'), { target: { value: 'month' } })
  expect(screen.getByText('Mathematics · Now')).toBeInTheDocument()
  expect(screen.queryByText('Mathematics · Old')).toBeNull()
})

test('Export CSV downloads the shown payments', async () => {
  const create = vi.fn(() => 'blob:x')
  Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() })
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  show({ ...view, transactions: [row(1, new Date().toISOString())] })
  fireEvent.click(await screen.findByRole('button', { name: 'Export CSV' }))
  expect(click).toHaveBeenCalled()
  const text = await create.mock.calls[0][0].text()
  expect(text).toContain('"Date","Booking","Student"')
  expect(text).toContain('"Sarah","Mathematics","100.00"')
})

test('withdrawal history shows each status and the rejection reason', async () => {
  show({ ...view, withdrawals: [
    { id: 1, date: '2026-11-01T02:00:00.000Z', amount: '20', status: 'REJECTED', reason: 'Name does not match', bank },
    { id: 2, date: '2026-11-02T02:00:00.000Z', amount: '10', status: 'APPROVED', bank },
    { id: 3, date: '2026-11-03T02:00:00.000Z', amount: '5', status: 'ESCALATED', bank },
  ] })
  expect(await screen.findByText('RM 20.00 · Rejected')).toBeInTheDocument()
  expect(screen.getByText('Reason: Name does not match')).toBeInTheDocument()
  expect(screen.getByText('RM 10.00 · Approved')).toBeInTheDocument()
  expect(screen.getByText('RM 5.00 · Bank change under review')).toBeInTheDocument()
})

test('removing the bank account sends no details and confirms', async () => {
  show()
  api.put.mockResolvedValue({ data: { message: 'Bank details saved.' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Remove account' }))
  expect(screen.queryByLabelText('Account number')).toBeNull()
  fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value: 'SyntheticPassword' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))
  expect(await screen.findByText('Bank account removed.')).toBeInTheDocument()
  expect(api.put).toHaveBeenCalledWith('/tutor/earnings/bank', { currentBankId: 4, details: null, confirmation: 'SyntheticPassword' })
})

test('a wrong password keeps the form open with the error', async () => {
  show()
  api.put.mockRejectedValue(Object.assign(new Error('Incorrect password.'), { response: { status: 403 } }))
  fireEvent.click(await screen.findByRole('button', { name: 'Edit account' }))
  fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '1234567890' } })
  fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value: 'wrong' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))
  expect(await screen.findByText('Incorrect password.')).toBeInTheDocument()
  expect(screen.getByLabelText('Account number')).toBeInTheDocument()
})

test('a Google sign-in tutor asks for an email code instead of a password', async () => {
  show({ ...view, bankAuth: 'code' })
  api.post.mockResolvedValue({ data: { message: 'Check your email for the code.' } })
  fireEvent.click(await screen.findByRole('button', { name: 'Edit account' }))
  expect(screen.queryByLabelText('Confirm your password')).toBeNull()
  expect(screen.getByLabelText('Email code')).toHaveAttribute('type', 'text')
  fireEvent.click(screen.getByRole('button', { name: 'Email confirmation code' }))
  expect(await screen.findByText('Check your email for the confirmation code.')).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith('/tutor/earnings/bank-code')
})

test('a failed page load can be retried', async () => {
  api.get.mockRejectedValueOnce(new Error('Network error')).mockResolvedValue({ data: view })
  render(<MemoryRouter><Earnings /></MemoryRouter>)
  expect(await screen.findByText('Network error')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
  await waitFor(() => expect(screen.getByText('Available to withdraw')).toBeInTheDocument())
})
