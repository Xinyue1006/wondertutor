import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import BookingRequests from '../pages/tutor/BookingRequests'
import MyBookings from '../pages/parent/MyBookings'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: e => e.message }))
const startAt = new Date(Date.now() + 7 * 86400000).toISOString()
const b = { id: 14, subject: 'Mathematics', teachingMode: 'ONLINE', status: 'AWAITING_PAYMENT', startAt,
  endAt: new Date(Date.parse(startAt) + 3600000).toISOString(), updatedAt: startAt, payBy: startAt, parentName: 'Example Parent',
  child: { name: 'Example Student', grade: 4, educationLevel: 'PRIMARY' }, tutor: { id: 3, name: 'Example Tutor', rating: 5, reviewCount: 1 },
  proposedPrice: 40, agreedPrice: 40, totalAmount: 40 }
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  api.get.mockResolvedValue({ data: { bookings: [b] } })
})
afterEach(() => vi.restoreAllMocks())

test('tutor opens a linked lesson and saves its classroom URL', async () => {
  const url = 'https://example.org/class'
  api.post.mockResolvedValue({ data: { booking: { ...b, meetingLink: url } } })
  render(<MemoryRouter initialEntries={['/tutor/bookings?booking=14']}><BookingRequests /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Add class link' }))
  fireEvent.change(screen.getByLabelText('Class link (HTTPS)'), { target: { value: url } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(await screen.findByRole('link', { name: 'Open class link' })).toHaveAttribute('href', url)
  expect(api.post).toHaveBeenCalledWith('/tutor/bookings/14', { action: 'link', version: b.updatedAt, url })
})

test('parent sees the payment deadline on an accepted booking', async () => {
  render(<MemoryRouter><MyBookings /></MemoryRouter>)
  expect(await screen.findByText(/Pay by .*Malaysia time/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Join online class' })).toBeNull()
})
