import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import api from '../api/client'
import MyBookings from '../pages/parent/MyBookings'
import LessonDetails from '../components/LessonDetails'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, errorMessage: e => e.message }))
const serverTime = '2026-11-13T06:00:00Z'
const child = { name: 'Sarah', educationLevel: 'PRIMARY', grade: 5 }
function booking(id, changes = {}) {
  return {
    id, publicId: `bc1d7aa7-3a55-4bc0-8b84-${String(id).padStart(12, '0')}`,
    subject: 'Mathematics', child, tutor: { id: 4, name: `Tutor ${id}`, rating: 4.8, reviewCount: 7 },
    status: 'CONFIRMED', teachingMode: 'ONLINE', startAt: '2027-01-05T09:00:00Z', endAt: '2027-01-05T10:00:00Z',
    createdAt: serverTime, updatedAt: serverTime, hourlyPrice: 50, agreedPrice: 50, proposedPrice: 45, hours: 1, totalAmount: 50,
    ...changes,
  }
}
function LocationSnapshot() {
  const location = useLocation()
  return <output data-testid="location">{location.pathname + location.search}</output>
}
function open(rows, url = '/parent/bookings') {
  api.get.mockResolvedValue({ data: { bookings: rows, serverTime } })
  render(<MemoryRouter initialEntries={[url]}><MyBookings /><LocationSnapshot /></MemoryRouter>)
}
const row = id => screen.getByRole('article', { name: `Mathematics with Tutor ${id} for Sarah` })
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

test('Upcoming is the default, sorted soonest first, with compact summaries and one details entry per booking', async () => {
  open([booking(1, { startAt: '2027-01-06T09:00:00Z', endAt: '2027-01-06T10:00:00Z' }), booking(2), booking(3, { status: 'REJECTED', rejectionReason: 'Not available on this date' }), booking(4, { status: 'PENDING' })])
  await screen.findByRole('article', { name: /Tutor 2/ })
  expect(screen.getByRole('button', { name: 'Upcoming (2)' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getAllByRole('article').map(article => within(article).getByRole('link', { name: /Tutor/ }).textContent)).toEqual(['Tutor 2', 'Tutor 1'])
  expect(within(row(2)).getByText(/Sarah/)).toBeInTheDocument()
  expect(within(row(2)).getByRole('button', { name: 'View Details', exact: true })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Tutor 3' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Cancel Booking' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Cancelled & declined (1)' }))
  expect(screen.getByRole('link', { name: 'Tutor 3' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Tutor 2' })).not.toBeInTheDocument()
  fireEvent.click(within(row(3)).getByRole('button', { name: 'View Details' }))
  expect(within(screen.getByRole('dialog')).getByText('Not available on this date')).toBeInTheDocument()
})

test('All is explicit, switching back to Upcoming does not leave an All URL, and invalid tabs recover to Upcoming', async () => {
  open([booking(1), booking(2, { status: 'CANCELLED' })], '/parent/bookings?tab=unknown')
  await screen.findByRole('article')
  expect(screen.getAllByRole('article')).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'All (2)' }))
  expect(screen.getAllByRole('article')).toHaveLength(2)
  expect(screen.getByTestId('location')).toHaveTextContent('/parent/bookings?tab=all')
  fireEvent.click(screen.getByRole('button', { name: 'Upcoming (1)' }))
  expect(screen.getAllByRole('article')).toHaveLength(1)
  expect(screen.getByTestId('location').textContent).toBe('/parent/bookings')
})

test('an empty Upcoming view points parents to their pending requests', async () => {
  open([booking(1, { status: 'PENDING' })])
  expect(await screen.findByText('No upcoming lessons')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View pending requests' })).toHaveAttribute('href', '/parent/bookings?tab=pending')
})

test('physical venue and management actions remain in details, and cancellation replaces the details dialog', async () => {
  const exact = booking(1, { teachingMode: 'PHYSICAL', location: '12 Example Street, 50000 Kuala Lumpur', latitude: 3.1412, longitude: 101.6123, locationConfirmedAt: serverTime, locationCanBeEdited: false })
  open([exact])
  fireEvent.click(await screen.findByRole('button', { name: 'View Details' }))
  expect(within(screen.getByRole('dialog')).getByText(exact.location)).toBeInTheDocument()
  expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'View lesson map' })).toHaveAttribute('href', expect.stringContaining('3.1412'))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel Booking' }))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('dialog', { name: 'Cancel this booking?' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

test('counter-offer errors stay visible in details and a successful retry updates the dialog to payment actions', async () => {
  const counter = booking(1, { status: 'COUNTER_OFFERED', counterPrice: 55, hourlyPrice: 55, totalAmount: 55 })
  const accepted = { ...counter, status: 'AWAITING_PAYMENT', agreedPrice: 55 }
  open([counter], '/parent/bookings?tab=pending')
  fireEvent.click(await screen.findByRole('button', { name: 'View Details' }))
  api.post.mockRejectedValueOnce(new Error('Could not save your decision. Try again.'))
    .mockImplementationOnce(async () => { api.get.mockResolvedValue({ data: { bookings: [accepted], serverTime } }); return { data: { booking: accepted } } })
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept Counter Offer' }))
  await within(screen.getByRole('dialog')).findByText('Could not save your decision. Try again.')
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept Counter Offer' }))
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Pay Now' })).toBeInTheDocument())
  expect(within(screen.getByRole('dialog')).queryByRole('button', { name: 'Accept Counter Offer' })).not.toBeInTheDocument()
  expect(api.post.mock.calls[1][0]).toBe(`/parent/bookings/${counter.publicId}/accept-counter`)
})

test('a non-upcoming UUID deep link opens its details and leaves the correct group visible after closing', async () => {
  const cancelled = booking(1, { status: 'CANCELLED', cancelReason: 'Parent no longer needs this lesson' })
  open([cancelled], '/parent/bookings?booking=' + cancelled.publicId)
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText(cancelled.cancelReason)).toBeInTheDocument()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close', exact: true }))
  expect(screen.getByRole('button', { name: 'Cancelled & declined (1)' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('article')).toBeInTheDocument()
})

test('a failed cancellation keeps the explanation and error in the cancellation dialog for an intentional retry', async () => {
  open([booking(1, { status: 'PENDING' })], '/parent/bookings?tab=pending')
  fireEvent.click(await screen.findByRole('button', { name: 'View Details' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel Request' }))
  const dialog = within(screen.getByRole('dialog', { name: 'Cancel this request?' }))
  const explanation = 'Our family is no longer available on this date.'
  fireEvent.change(dialog.getByLabelText('Reason (optional)'), { target: { value: explanation } })
  api.post.mockRejectedValueOnce(new Error('Connection interrupted. Please try again.'))
  fireEvent.click(dialog.getByRole('button', { name: 'Yes, cancel' }))
  await dialog.findByText('Connection interrupted. Please try again.')
  expect(dialog.getByLabelText('Reason (optional)')).toHaveValue(explanation)
  expect(dialog.getByRole('button', { name: 'Yes, cancel' })).toBeEnabled()
  expect(api.post).toHaveBeenCalledTimes(1)
})

const history = () => Array.from({ length: 12 }, (_, index) => booking(index + 1, {
  status: 'COMPLETED', startAt: new Date(Date.UTC(2026, 9, index + 1, 8)).toISOString(),
  endAt: new Date(Date.UTC(2026, 9, index + 1, 9)).toISOString(),
}))
const completedGroup = () => within(screen.getByRole('heading', { name: 'Completed Lessons' }).closest('section'))

test('All initially limits each group to five and keeps declined bookings reachable below recent completed records', async () => {
  open([...history(), booking(20, { status: 'REJECTED' })], '/parent/bookings?tab=all')
  await screen.findByRole('heading', { name: 'Completed Lessons' })
  const completed = completedGroup()
  expect(completed.getAllByRole('article')).toHaveLength(5)
  expect(completed.getAllByRole('article').map(article => within(article).getByRole('link', { name: /Tutor/ }).textContent)).toEqual(['Tutor 12', 'Tutor 11', 'Tutor 10', 'Tutor 9', 'Tutor 8'])
  expect(screen.getByRole('button', { name: 'Completed (12)' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Cancelled & Declined' })).toBeInTheDocument()
  expect(screen.getByRole('article', { name: /Tutor 20/ })).toBeInTheDocument()
  fireEvent.click(completed.getByRole('button', { name: /View 5 more/ }))
  expect(completed.getAllByRole('article')).toHaveLength(10)
  fireEvent.click(completed.getByRole('button', { name: /View.*more/ }))
  expect(completed.getAllByRole('article')).toHaveLength(12)
  fireEvent.click(completed.getByRole('button', { name: /Show fewer/ }))
  expect(completed.getAllByRole('article')).toHaveLength(5)
})

test('changing the sort resets expanded history while preserving total counts', async () => {
  open(history(), '/parent/bookings?tab=completed')
  await screen.findByRole('heading', { name: 'Completed Lessons' })
  fireEvent.click(completedGroup().getByRole('button', { name: /View 5 more/ }))
  expect(completedGroup().getAllByRole('article')).toHaveLength(10)
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort by:' }), { target: { value: 'old' } })
  expect(completedGroup().getAllByRole('article')).toHaveLength(5)
  expect(completedGroup().getAllByRole('article').map(article => within(article).getByRole('link', { name: /Tutor/ }).textContent)).toEqual(['Tutor 1', 'Tutor 2', 'Tutor 3', 'Tutor 4', 'Tutor 5'])
  expect(screen.getByRole('button', { name: 'Completed (12)' })).toBeInTheDocument()
})

test('an older booking deep link remains visible after details close even beyond the initial five', async () => {
  const rows = history()
  open(rows, '/parent/bookings?booking=' + rows[0].publicId)
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close', exact: true }))
  expect(screen.getByRole('article', { name: 'Mathematics with Tutor 1 for Sarah' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Completed (12)' })).toHaveAttribute('aria-pressed', 'true')
})

test('an escalated time change remains with admin review rather than offering another parent reschedule', async () => {
  open([booking(1, { reschedule: {
    id: 18, status: 'ESCALATED', requestedBy: 'TUTOR',
    newStartAt: '2027-01-06T09:00:00Z', newEndAt: '2027-01-06T10:00:00Z',
  } })])
  fireEvent.click(await screen.findByRole('button', { name: 'View Details' }))
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByText(/Our admin team is reviewing it/)).toBeInTheDocument()
  expect(dialog.queryByRole('button', { name: 'Reschedule', exact: true })).not.toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

test('a successful decision followed by a failed refresh blocks stale actions and recovers with GET without replaying the decision', async () => {
  const counter = booking(1, { status: 'COUNTER_OFFERED', counterPrice: 55, hourlyPrice: 55, totalAmount: 55 })
  const accepted = { ...counter, status: 'AWAITING_PAYMENT', agreedPrice: 55 }
  open([counter], '/parent/bookings?tab=pending')
  fireEvent.click(await screen.findByRole('button', { name: 'View Details' }))
  api.post.mockResolvedValueOnce({ data: { booking: accepted } })
  api.get.mockRejectedValueOnce(new Error('Could not load the latest booking.'))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Accept Counter Offer' }))
  const dialog = within(screen.getByRole('dialog'))
  await dialog.findByText('Could not load the latest booking.')
  expect(screen.getAllByText('Could not load the latest booking.')).toHaveLength(1)
  expect(dialog.queryByRole('button', { name: 'Accept Counter Offer' })).not.toBeInTheDocument()
  expect(dialog.queryByRole('link', { name: 'Pay Now' })).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
  api.get.mockResolvedValueOnce({ data: { bookings: [accepted], serverTime } })
  fireEvent.click(dialog.getByRole('button', { name: 'Refresh bookings' }))
  await dialog.findByRole('link', { name: 'Pay Now' })
  expect(dialog.queryByRole('button', { name: 'Accept Counter Offer' })).not.toBeInTheDocument()
  expect(dialog.queryByText('Could not load the latest booking.')).not.toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
})

test('stale detail records cannot start a refund or change a physical venue outside the action panel', () => {
  const onLocation = vi.fn()
  const active = booking(1, {
    teachingMode: 'PHYSICAL', startAt: '2026-11-13T05:30:00Z', endAt: '2026-11-13T06:30:00Z',
    location: 'Kepong', locationCanBeEdited: true, payment: { status: 'PAID', refunds: [] },
  })
  render(<MemoryRouter><LessonDetails booking={active} now={Date.parse(serverTime)} actionsDisabled onLocation={onLocation} onClose={() => {}} /></MemoryRouter>)
  const refund = screen.getByRole('button', { name: 'Request a refund' })
  const venue = screen.getByRole('button', { name: 'Confirm lesson address' })
  expect(refund).toBeDisabled()
  expect(venue).toBeDisabled()
  fireEvent.click(refund)
  fireEvent.click(venue)
  expect(onLocation).not.toHaveBeenCalled()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})
