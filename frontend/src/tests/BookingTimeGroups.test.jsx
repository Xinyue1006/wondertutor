import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import api from '../api/client'
import MyBookings from '../pages/parent/MyBookings'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, errorMessage: e => e.message }))
const serverTime = '2026-11-13T06:00:00.000Z'
const baseline = {
  status: 'CONFIRMED', subject: 'Mathematics', teachingMode: 'ONLINE',
  createdAt: '2026-10-01T01:00:00Z', updatedAt: '2026-10-01T01:00:00Z',
  child: { name: 'Example Student', grade: 4, educationLevel: 'PRIMARY' },
  proposedPrice: 40, agreedPrice: 40, hourlyPrice: 40, totalAmount: 40, hours: 1,
  payment: { status: 'PAID', amount: 40, method: 'FPX', gatewayRef: 'example', refunds: [] },
  meetingLink: 'https://example.org/class',
}
function booking(id, name, startAt, endAt, changes = {}) {
  return { ...baseline, id, publicId: `bc1d7aa7-3a55-4bc0-8b84-${String(id).padStart(12, '0')}`, tutor: { id, name, rating: 5, reviewCount: 1 }, startAt, endAt, ...changes }
}
const past = booking(1, 'October tutor', '2026-10-13T05:00:00Z', '2026-10-13T06:00:00Z')
const current = booking(2, 'Current tutor', '2026-11-13T05:30:00Z', '2026-11-13T06:30:00Z')
const future = booking(3, 'Future tutor', '2026-11-14T05:00:00Z', '2026-11-14T06:00:00Z')
function show(rows, data = {}) {
  api.get.mockResolvedValue({ data: { bookings: rows, serverTime, ...data } })
  render(<MemoryRouter initialEntries={['/parent/bookings?tab=all']}><MyBookings /></MemoryRouter>)
}
const section = name => within(screen.getByRole('heading', { name }).closest('section'))
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

test('ended confirmed paid lessons need attention while current and future lessons remain upcoming', async () => {
  show([past, current, future])
  await screen.findByRole('heading', { name: 'Needs attention' })
  const attention = section('Needs attention')
  const upcoming = section('Upcoming Lessons')
  expect(attention.getByRole('link', { name: 'October tutor' })).toBeInTheDocument()
  expect(attention.queryByRole('link', { name: 'Join online class' })).not.toBeInTheDocument()
  expect(attention.queryByRole('button', { name: 'Cancel Booking' })).not.toBeInTheDocument()
  expect(attention.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument()
  expect(attention.getByText('Confirmed')).toBeInTheDocument()
  expect(upcoming.getByRole('link', { name: 'Current tutor' })).toBeInTheDocument()
  expect(upcoming.getByRole('link', { name: 'Future tutor' })).toBeInTheDocument()
  expect(upcoming.getAllByRole('link', { name: 'Join online class' })).toHaveLength(2)
  expect(upcoming.getByText('Lesson in progress', { exact: true })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Needs attention (1)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Upcoming (2)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Completed (0)' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.click(attention.getByRole('button', { name: 'View Details', exact: true }))
  const details = within(screen.getByRole('dialog'))
  expect(details.getByText('Confirmed')).toBeInTheDocument()
  expect(details.getByText('Paid')).toBeInTheDocument()
  expect(details.getByText(/Your payment is still recorded as paid/)).toBeInTheDocument()
  expect(details.getByRole('link', { name: 'Report a problem with this lesson', exact: true })).toHaveAttribute('href', '/parent/complaints?booking=' + past.publicId)
  expect(details.queryByRole('button', { name: 'Cancel Booking' })).not.toBeInTheDocument()
  expect(details.queryByRole('button', { name: 'Reschedule' })).not.toBeInTheDocument()
  expect(details.getByRole('button', { name: 'Request a refund' })).toBeInTheDocument()
})

test('Needs attention and Upcoming filters show only their own time groups without changing records', async () => {
  show([past, current, future])
  fireEvent.click(await screen.findByRole('button', { name: 'Needs attention (1)' }))
  expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Upcoming Lessons' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Join online class' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Upcoming (2)' }))
  expect(screen.getByRole('heading', { name: 'Upcoming Lessons' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'October tutor' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

test('grouping uses server time even when the device clock is several years ahead', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2031-01-01T00:00:00Z'))
  show([past, current, future])
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('button', { name: 'Needs attention (1)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Upcoming (2)' })).toBeInTheDocument()
  expect(section('Upcoming Lessons').getByText('Lesson in progress', { exact: true })).toBeInTheDocument()
})

test('a lesson moves to Needs attention at its end while the page stays open, with no automatic refund or completion', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(serverTime))
  const ending = booking(4, 'Ending tutor', '2026-11-13T05:00:00Z', '2026-11-13T06:00:01Z')
  show([ending])
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('heading', { name: 'Upcoming Lessons' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Join online class' })).toBeInTheDocument()
  await act(async () => { vi.advanceTimersByTime(1000) })
  expect(screen.queryByRole('heading', { name: 'Upcoming Lessons' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Join online class' })).not.toBeInTheDocument()
  expect(section('Needs attention').getByText('Confirmed')).toBeInTheDocument()
  fireEvent.click(section('Needs attention').getByRole('button', { name: 'View Details', exact: true }))
  const details = within(screen.getByRole('dialog'))
  expect(details.getByText(/Your payment is still recorded as paid/)).toBeInTheDocument()
  expect(details.queryByRole('link', { name: 'Join online class' })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

test('the fallback clock still groups legacy mock responses without serverTime and does not offer an empty calendar export for an ongoing lesson', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(serverTime))
  show([past, current], { serverTime: undefined })
  await act(async () => { await Promise.resolve() })
  expect(screen.getByRole('button', { name: 'Needs attention (1)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Upcoming (1)' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add all upcoming lessons to my calendar' })).not.toBeInTheDocument()
})
