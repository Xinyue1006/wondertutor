import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import api from '../api/client'
import MyBookings from '../pages/parent/MyBookings'
import LessonDetails from '../components/LessonDetails'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn() }, errorMessage: e => e.message }))
const publicId = '75b978b5-fe71-4707-aeb7-1fb1996231bd'
const booking = {
  id: 14, publicId, subject: 'Mathematics', teachingMode: 'PHYSICAL', status: 'CONFIRMED',
  startAt: '2027-01-13T08:00:00Z', endAt: '2027-01-13T09:00:00Z', createdAt: '2026-11-12T09:00:00Z', updatedAt: '2026-11-13T01:00:00Z',
  child: { name: 'Example Student', grade: 4, educationLevel: 'PRIMARY' }, tutor: { id: 3, name: 'Example Tutor', rating: 5, reviewCount: 1 },
  proposedPrice: 40, agreedPrice: 40, hourlyPrice: 40, totalAmount: 40,
  location: 'Kepong, Kuala Lumpur', latitude: 3.2, longitude: 101.6, locationConfirmedAt: null, locationCanBeEdited: true,
}
const exact = { address: '17 Jalan Demo, 52000 Kuala Lumpur', latitude: 3.154, longitude: 101.671, confirmed: true }
const saved = { ...booking, location: exact.address, latitude: exact.latitude, longitude: exact.longitude, locationConfirmedAt: '2026-11-13T02:00:00Z', locationCanBeEdited: false }
function show(row = booking) {
  api.get.mockResolvedValue({ data: { bookings: [row] } })
  render(<MemoryRouter initialEntries={['/parent/bookings?tab=all']}><MyBookings /></MemoryRouter>)
}
async function open(row = booking) {
  show(row)
  fireEvent.click(await screen.findByRole('button', { name: /^View (Lesson )?Details$/ }))
  fireEvent.click(await screen.findByRole('button', { name: row.locationConfirmedAt ? 'Edit lesson address' : 'Confirm lesson address' }))
  return within(screen.getByRole('dialog'))
}
function fill(form) {
  fireEvent.change(form.getByLabelText('Full lesson address'), { target: { value: exact.address } })
  fireEvent.click(form.getByText('Enter coordinates instead (if the map is unavailable)'))
  fireEvent.change(form.getByLabelText('Latitude (−90 to 90)'), { target: { value: String(exact.latitude) } })
  fireEvent.change(form.getByLabelText('Longitude (−180 to 180)'), { target: { value: String(exact.longitude) } })
  fireEvent.click(form.getByRole('checkbox', { name: /I confirm the address and pin/ }))
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

test('an accepted legacy booking starts with no precise pin and saves the confirmed venue using its public ID and version', async () => {
  api.put.mockResolvedValue({ data: { booking: saved } })
  const form = await open()
  expect(form.getByLabelText('Full lesson address')).toHaveValue('')
  expect(form.getByText('No lesson pin selected yet.')).toBeInTheDocument()
  expect(form.getByText(/Previous area: Kepong/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'View lesson map' })).not.toBeInTheDocument()
  fireEvent.click(form.getByRole('button', { name: 'Save lesson address' }))
  expect(api.put).not.toHaveBeenCalled()
  fill(form)
  fireEvent.click(form.getByRole('button', { name: 'Save lesson address' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/parent/bookings/' + publicId + '/location', { ...exact, version: booking.updatedAt }))
  expect(await screen.findByText('Lesson address saved. Your tutor has been notified.')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^View (Lesson )?Details$/ }))
  expect(screen.getByRole('link', { name: 'View lesson map' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=3.154%2C101.671')
  expect(screen.queryByRole('button', { name: 'Edit lesson address' })).not.toBeInTheDocument()
})

test('a failed save preserves the full venue draft and allows an intentional retry', async () => {
  api.put.mockRejectedValueOnce(new Error('Connection interrupted.')).mockResolvedValue({ data: { booking: saved } })
  const form = await open()
  fill(form)
  fireEvent.click(form.getByRole('button', { name: 'Save lesson address' }))
  expect(await form.findByText('Connection interrupted.')).toBeInTheDocument()
  expect(form.getByLabelText('Full lesson address')).toHaveValue(exact.address)
  expect(form.getByRole('checkbox')).toBeChecked()
  expect(form.getByRole('button', { name: 'Save lesson address' })).toBeEnabled()
  fireEvent.click(form.getByRole('button', { name: 'Save lesson address' }))
  expect(await screen.findByText('Lesson address saved. Your tutor has been notified.')).toBeInTheDocument()
  expect(api.put).toHaveBeenCalledTimes(2)
})

test('a check-in race requires refreshing and keeps the draft without replaying a location update', async () => {
  api.put.mockRejectedValueOnce(Object.assign(new Error('Attendance already started. Refresh the booking.'), { response: { status: 409 } }))
  const form = await open()
  fill(form)
  fireEvent.click(form.getByRole('button', { name: 'Save lesson address' }))
  expect(await form.findByText('Attendance already started. Refresh the booking.')).toBeInTheDocument()
  expect(form.getByRole('button', { name: 'Save lesson address' })).toBeDisabled()
  api.get.mockResolvedValue({ data: { bookings: [{ ...saved, attendance: { checkInAt: booking.startAt }, updatedAt: '2026-11-13T03:00:00Z' }] } })
  fireEvent.click(form.getByRole('button', { name: 'Refresh booking and review' }))
  expect(await form.findByText(/Your draft has been kept/)).toBeInTheDocument()
  expect(form.getByLabelText('Full lesson address')).toHaveValue(exact.address)
  expect(form.getByRole('checkbox')).not.toBeChecked()
  expect(form.getByLabelText('Full lesson address')).toBeDisabled()
  expect(form.getByRole('button', { name: 'Save lesson address' })).toBeDisabled()
  expect(api.put).toHaveBeenCalledTimes(1)
})

test('a changed but still editable booking uses the refreshed version only after the parent reconfirms', async () => {
  const pending = { ...booking, status: 'PENDING' }
  const newer = { ...pending, updatedAt: '2026-11-13T03:00:00Z' }
  api.put.mockRejectedValueOnce(Object.assign(new Error('Booking changed.'), { response: { status: 409 } }))
    .mockResolvedValue({ data: { booking: { ...saved, status: 'PENDING', locationCanBeEdited: true } } })
  const form = await open(pending)
  fill(form)
  fireEvent.click(form.getByRole('button', { name: 'Save lesson address' }))
  await form.findByText('Booking changed.')
  api.get.mockResolvedValue({ data: { bookings: [newer] } })
  fireEvent.click(form.getByRole('button', { name: 'Refresh booking and review' }))
  await form.findByText(/Your draft has been kept/)
  expect(api.put).toHaveBeenCalledTimes(1)
  expect(form.getByRole('checkbox')).not.toBeChecked()
  fireEvent.click(form.getByRole('checkbox'))
  fireEvent.click(form.getByRole('button', { name: 'Save lesson address' }))
  await waitFor(() => expect(api.put).toHaveBeenLastCalledWith('/parent/bookings/' + publicId + '/location', { ...exact, version: newer.updatedAt }))
})

test('editing a precise counter-offer venue requires reconfirmation and explains the return to tutor review', async () => {
  const counter = { ...saved, status: 'COUNTER_OFFERED', locationCanBeEdited: true, counterPrice: 45 }
  api.put.mockResolvedValue({ data: { booking: { ...saved, status: 'PENDING', counterPrice: null, locationCanBeEdited: true } } })
  const form = await open(counter)
  expect(form.getByLabelText('Full lesson address')).toHaveValue(exact.address)
  expect(form.getByRole('checkbox')).not.toBeChecked()
  fireEvent.click(form.getByRole('button', { name: 'Save lesson address' }))
  expect(api.put).not.toHaveBeenCalled()
  fireEvent.click(form.getByRole('checkbox'))
  fireEvent.click(form.getByRole('button', { name: 'Save lesson address' }))
  expect(await screen.findByText(/The counter-offer was cleared so the tutor can review/)).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Pending Requests' })).toBeInTheDocument()
})

test.each([
  { ...saved, attendance: { checkInAt: booking.startAt } },
  { ...saved, status: 'AWAITING_PAYMENT' },
  { ...saved, status: 'CONFIRMED' },
  { ...booking, locationCanBeEdited: false },
])('the parent cannot edit a locked or accepted confirmed venue', async row => {
  show(row)
  fireEvent.click(await screen.findByRole('button', { name: /^View (Lesson )?Details$/ }))
  expect(screen.queryByRole('button', { name: /^(Edit|Confirm) lesson address$/ })).not.toBeInTheDocument()
})

test('lesson details never turn a legacy area centre into a directions link', () => {
  render(<MemoryRouter><LessonDetails booking={booking} onClose={() => {}} /></MemoryRouter>)
  expect(screen.getByText(/The previous area is not a GPS attendance point/)).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'View lesson map' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Confirm or review address in My Bookings' })).toHaveAttribute('href', '/parent/bookings?booking=' + publicId)
})
