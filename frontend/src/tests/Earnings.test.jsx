import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import Earnings from '../pages/tutor/Earnings'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, errorMessage: e => e.message }))
const bank = { id: 4, bankName: 'Example Bank', accountName: 'Example Tutor', lastFour: '7890' }
const view = { available: '80.20', totalEarned: 90, pending: 12, held: 9.8, withdrawn: 0, rate: 10, baseRate: 15, version: 'initial',
  bank, bankAuth: 'password', withdrawals: [], transactions: [] }
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())
test('a small withdrawal uses the displayed balance version and refreshes the hold and history', async () => {
  api.get.mockResolvedValueOnce({ data: view }).mockResolvedValue({ data: { ...view, available: '80.19', held: '9.81', withdrawals: [
    { id: 3, date: '2026-11-13', amount: '0.01', status: 'PENDING', bank },
  ] } })
  api.post.mockResolvedValue({ data: { id: 3 } })
  render(<MemoryRouter><Earnings /></MemoryRouter>)
  fireEvent.change(await screen.findByLabelText('Amount (RM)'), { target: { value: '0.01' } })
  fireEvent.click(screen.getByRole('button', { name: 'Request withdrawal' }))
  expect(await screen.findByText(/RM 0.01 · In review/)).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith('/tutor/earnings/withdrawals', { amount: '0.01', bankId: 4, version: 'initial' })
  expect(screen.getByText('RM 80.19')).toBeInTheDocument()
})
test('bank details are masked and replacement asks for confirmation', async () => {
  api.get.mockResolvedValue({ data: view })
  render(<MemoryRouter><Earnings /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit account' }))
  expect(screen.getByLabelText('Account number')).toHaveValue('')
  expect(screen.getByLabelText('Confirm your password')).toHaveAttribute('type', 'password')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByLabelText('Account number')).toBeNull())
  expect(api.put).not.toHaveBeenCalled()
})

test('a bank conflict refreshes the destination and requires a fresh confirmation form', async () => {
  const latest = { ...bank, id: 5, bankName: 'New Bank', lastFour: '4321' }
  api.get.mockResolvedValueOnce({ data: view }).mockResolvedValue({ data: { ...view, bank: latest } })
  api.put.mockRejectedValueOnce(Object.assign(new Error('Bank details changed. Refresh and try again.'), { response: { status: 409 } }))
  render(<MemoryRouter><Earnings /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Edit account' }))
  fireEvent.change(screen.getByLabelText('Account number'), { target: { value: '1234567890' } })
  fireEvent.change(screen.getByLabelText('Confirm your password'), { target: { value: 'SyntheticPassword' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save account' }))
  expect(await screen.findByText('Review the latest bank account, then start again if you still want to change it.')).toBeInTheDocument()
  expect(screen.queryByLabelText('Confirm your password')).not.toBeInTheDocument()
  expect(api.put).toHaveBeenCalledTimes(1)
  expect(screen.getByText('Pay to New Bank ••4321')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Edit account' }))
  expect(screen.getByLabelText('Confirm your password')).toHaveValue('')
  expect(screen.getByLabelText('Bank', { exact: true })).toHaveValue('New Bank')
})
