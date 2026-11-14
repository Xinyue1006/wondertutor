import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import AdminComplaints from '../pages/admin/AdminComplaints'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() }, errorMessage: e => e.message }))
vi.mock('../components/ComplaintsReport', () => ({ default: () => null }))

test('admin reads the tutor proof and parent reply before approving attendance', async () => {
  const review = { id: 1, category: 'Missed check-in', description: 'Power outage', status: 'OPEN', filedBy: { name: 'Tutor' }, createdAt: '2026-11-01' }
  const evidence = { parentAnswer: null, proof: 'https://example.org/proof', reviewedAt: '2026-11-01T06:00:00.000Z' }
  api.get.mockImplementation(async path => ({ data: path === '/admin/complaints'
    ? { complaints: [review], counts: { OPEN: 1 } }
    : { complaint: review, investigation: { attendanceReview: { ...evidence }, otherComplaints: [], warnings: [] } } }))
  api.patch.mockResolvedValue({})
  render(<MemoryRouter><AdminComplaints /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
  expect(await screen.findByRole('link', { name: 'View tutor proof' })).toHaveAttribute('href', evidence.proof)
  expect(screen.getByRole('button', { name: 'Approve attendance' })).toBeDisabled()
  Object.assign(evidence, { parentAnswer: 'YES', parentNote: 'I was there.' })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh evidence' }))
  await screen.findByText('I was there.')
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Attendance verified.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Approve attendance' }))
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/complaints/1', { status: 'RESOLVED', adminResponse: 'Attendance verified.', reviewedAt: evidence.reviewedAt }))
})
