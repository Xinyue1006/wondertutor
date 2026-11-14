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

test('finance shows the attendance finding alongside an existing refund reason', async () => {
  const { default: Finance } = await import('../pages/admin/Finance')
  api.get.mockImplementation(async path => ({ data: { rows: path === '/admin/refunds' ? [
    { id: 9, bookingId: 17, attendanceOutcome: 'NOT_HELD', parent: 'Parent', amount: 80, paid: 80, status: 'PENDING', reason: 'Parent requested review' },
  ] : [] } }))
  render(<Finance />)
  fireEvent.click(screen.getByRole('button', { name: 'Refunds' }))
  fireEvent.click(await screen.findByText(/#17/))
  expect(screen.getByText('Attendance review: Lesson did not take place')).toBeVisible()
  expect(screen.getByText(/Reason: Parent requested review/)).toBeVisible()
})

test.each(['PENDING', 'APPROVED'])('finance cannot act on a held %s refund', async status => {
  const { default: Finance } = await import('../pages/admin/Finance')
  api.get.mockImplementation(async path => ({ data: { rows: path === '/admin/refunds' ? [
    { id: 9, bookingId: 17, parent: 'Parent', paid: 80, amount: 80, status, attendanceOutcome: 'MORE_INFO', attendanceRefundState: 'ON_HOLD' },
  ] : [] } }))
  render(<Finance />)
  fireEvent.click(screen.getByRole('button', { name: 'Refunds' }))
  fireEvent.click(await screen.findByText(/#17/))
  expect(screen.getByText(/Refund on hold/)).toBeVisible()
  expect(screen.queryByRole('button', { name: /Save refund decision|Record completed transfer/ })).toBeNull()
})
