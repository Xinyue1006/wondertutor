import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import AdminComplaints from '../pages/admin/AdminComplaints'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() }, errorMessage: (e) => e.message }))
vi.mock('../components/ComplaintsReport', () => ({ default: () => null }))
vi.mock('../components/WarnUser', () => ({ default: () => null }))
const report = {
  id: 7, category: 'Review content', description: 'Personal information in the attached photo', status: 'OPEN', createdAt: '2026-11-11',
  filedBy: { id: 1, name: 'Parent A', email: 'a@example.test' }, against: { id: 2, name: 'Parent B' },
  review: { id: 9, rating: 1, comment: 'Late for the lesson.', isHidden: false },
}
beforeEach(() => {
  api.get.mockReset(); api.patch.mockReset()
  api.get.mockImplementation(async (url) => ({ data: url === '/admin/complaints'
    ? { counts: { OPEN: 1, IN_PROGRESS: 0, RESOLVED: 0, DISMISSED: 0 }, complaints: [report] }
    : { investigation: { booking: null, otherComplaints: [], warnings: [] } } }))
})

test('admin must explain a hide decision, then can restore the review without closing the complaint', async () => {
  render(<MemoryRouter><AdminComplaints /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
  await screen.findByRole('region', { name: 'Review moderation' })
  fireEvent.click(screen.getByRole('button', { name: 'Hide review' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Explain the moderation decision')
  expect(api.patch).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Reason for this decision'), { target: { value: 'The photo exposes personal information.' } })
  api.patch.mockResolvedValueOnce({ data: { review: { id: 9, isHidden: true, moderationReason: 'The photo exposes personal information.' } } })
  fireEvent.click(screen.getByRole('button', { name: 'Hide review' }))
  await screen.findByRole('button', { name: 'Restore review' })
  expect(api.patch).toHaveBeenLastCalledWith('/admin/reviews/9/moderation', { isHidden: true, expectedHidden: false, reason: 'The photo exposes personal information.' })
  expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Reason for this decision'), { target: { value: 'The evidence is safe after investigation.' } })
  api.patch.mockResolvedValueOnce({ data: { review: { id: 9, isHidden: false, moderationReason: 'The evidence is safe after investigation.' } } })
  fireEvent.click(screen.getByRole('button', { name: 'Restore review' }))
  await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith('/admin/reviews/9/moderation', { isHidden: false, expectedHidden: true, reason: 'The evidence is safe after investigation.' }))
})
