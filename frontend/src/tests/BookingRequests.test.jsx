import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import BookingRequests from '../pages/tutor/BookingRequests'
import MyBookings from '../pages/parent/MyBookings'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: e => e.message }))
const startAt = new Date(Date.now() + 7 * 86400000).toISOString()
const b = { id: 14, subject: 'Mathematics', teachingMode: 'ONLINE', status: 'AWAITING_PAYMENT', startAt,
  endAt: new Date(Date.parse(startAt) + 3600000).toISOString(), createdAt: new Date(Date.parse(startAt) - 86400000).toISOString(), updatedAt: startAt, payBy: startAt, parentName: 'Example Parent',
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
  render(<MemoryRouter initialEntries={['/parent/bookings?tab=pending']}><MyBookings /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: /^View (Lesson )?Details$/ }))
  expect(await within(screen.getByRole('dialog')).findByText(/Pay by .*Malaysia time/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Join online class' })).toBeNull()
})

test('tutor notification and action use the booking public ID when provided', async () => {
  const publicId = 'a47fe8e9-e595-44bd-a028-88390bb13447'
  api.get.mockResolvedValue({ data: { bookings: [{ ...b, publicId }] } })
  api.post.mockResolvedValue({ data: { booking: { ...b, publicId } } })
  render(<MemoryRouter initialEntries={['/tutor/bookings?booking=' + publicId]}><BookingRequests /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Add class link' }))
  fireEvent.change(screen.getByLabelText('Class link (HTTPS)'), { target: { value: 'https://example.org/new-class' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(await screen.findByText('Class link saved.')).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith('/tutor/bookings/' + publicId, expect.objectContaining({ action: 'link' }))
})

test('a changed booking can be refreshed before another response is submitted', async () => {
  const pending = { ...b, status: 'PENDING' }
  api.get.mockResolvedValueOnce({ data: { bookings: [pending] } })
  api.post.mockRejectedValueOnce(Object.assign(new Error('This booking changed. Refresh before responding.'), { response: { status: 409 } }))
  render(<MemoryRouter><BookingRequests /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Accept request' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('This booking changed.')
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh booking' }))
  expect(await screen.findByText('Booking refreshed. Check the latest details before responding.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Add class link' })).toBeEnabled()
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
})

test('the tutor opens a confirmed session using its public booking ID', async () => {
  const publicId = '43baea58-27c9-4665-9fa2-12c49eb3a982'
  api.get.mockResolvedValue({ data: { bookings: [{ ...b, publicId, status: 'CONFIRMED' }] } })
  render(<MemoryRouter initialEntries={['/tutor/bookings?booking=' + publicId]}><BookingRequests /></MemoryRouter>)
  expect(await screen.findByRole('link', { name: 'Open session' })).toHaveAttribute('href', '/tutor/bookings/' + publicId + '/session')
})

test('a historical physical booking explains its missing exact venue without requesting an impossible confirmation', async () => {
  api.get.mockResolvedValue({ data: { bookings: [{ ...b, teachingMode: 'PHYSICAL', status: 'COMPLETED', location: 'Old area', locationConfirmedAt: null }] } })
  render(<MemoryRouter initialEntries={['/tutor/bookings?booking=14']}><BookingRequests /></MemoryRouter>)
  expect(await screen.findByText(/Existing attendance and reports are kept/)).toBeInTheDocument()
  expect(screen.queryByText(/ask the parent to confirm/)).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'View lesson map' })).not.toBeInTheDocument()
})

test('list rows identify who must reply and keep payment deadlines visible during time changes', async () => {
  const deadline = '2027-01-05T08:00:00Z'
  const row = (id, status, reschedule) => ({ ...b, id, status, child: { ...b.child, name: 'Student ' + id }, payBy: deadline, reschedule })
  const change = { status: 'PENDING', startAt: b.startAt, mine: false }
  api.get.mockResolvedValue({ data: { bookings: [
    row(1, 'PENDING'), row(2, 'COUNTER_OFFERED'), row(3, 'CONFIRMED', change),
    row(4, 'CONFIRMED', { ...change, mine: true }), row(5, 'AWAITING_PAYMENT', { ...change, status: 'ESCALATED' }),
    row(6, 'CONFIRMED', { ...change, status: 'APPROVED' }), row(7, 'COMPLETED', change),
  ] } })
  render(<MemoryRouter><BookingRequests /></MemoryRouter>)
  const item = id => screen.getByRole('button', { name: new RegExp('Student ' + id) })
  await screen.findByText('Your reply needed')
  expect(item(1)).toHaveTextContent('Your reply needed')
  expect(item(2)).toHaveTextContent('Waiting for parent to reply to your offer')
  fireEvent.click(screen.getByRole('button', { name: 'Lessons (4)' }))
  expect(item(3)).toHaveTextContent('Your reply needed on time change')
  expect(item(4)).toHaveTextContent('Waiting for parent to reply to time change')
  expect(item(5)).toHaveTextContent('Admin reviewing time change')
  expect(item(5)).toHaveTextContent(/Payment due .*5 Jan 2027, 4:00 PM \(MYT\)/)
  expect(item(6)).toHaveTextContent('Confirmed')
  fireEvent.click(screen.getByRole('button', { name: 'History (1)' }))
  expect(item(7)).toHaveTextContent('Completed')
  expect(item(7)).not.toHaveTextContent(/reply|Payment due|time change/)
})
