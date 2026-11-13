import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import TutorRates from '../pages/admin/TutorRates'
import Reports from '../pages/admin/Reports'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() }, errorMessage: e => e.message }))
beforeEach(() => vi.resetAllMocks())

test('a commission decision sends the displayed rate and the admin reason', async () => {
  api.get.mockResolvedValue({ data: { base: 12, tutors: [{ id: 8, name: 'Tutor A', hourly: 50, commission: 12, history: [] }] } })
  api.patch.mockResolvedValue({})
  render(<TutorRates />)
  const rate = await screen.findByLabelText('New commission (%)')
  fireEvent.change(rate, { target: { value: '10' } })
  fireEvent.change(screen.getAllByLabelText('Reason')[0], { target: { value: 'Annual review' } })
  fireEvent.submit(rate.closest('form'))
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/rates/8', { kind: 'COMMISSION', previous: 12, rate: 10, reason: 'Annual review' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Rate saved')
})

test('the report date controls request the selected period', async () => {
  api.get.mockResolvedValue({ data: { gross: 100, refunded: 0, netCollected: 100, commission: 12, bookings: 2, transactionCount: 1, months: [], statuses: {}, performance: [] } })
  render(<Reports />)
  expect(await screen.findByText('Net collected')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } })
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-30' } })
  fireEvent.click(screen.getByText('Apply dates'))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/reports?from=2026-11-01&to=2026-11-30', expect.anything()))
})
