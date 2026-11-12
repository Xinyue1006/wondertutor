import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import api from '../api/client'
import LessonSession from '../pages/tutor/LessonSession'
import { uploadImage } from '../components/PhotoPicker'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: e => e.message }))
vi.mock('../components/PhotoPicker', () => ({ uploadImage: vi.fn(), uploadError: e => e.message }))
const time = '2026-11-13T06:00:00.000Z'
const data = { id: 3, mode: 'PHYSICAL', radius: 150, latitude: 3, longitude: 101, address: 'Lesson address',
  student: 'Example student', subject: 'Mathematics', status: 'CONFIRMED', serverTime: time,
  startAt: '2026-11-13T05:45:00Z', endAt: '2026-11-13T06:45:00Z' }
function show(session) {
  api.get.mockResolvedValue({ data: session })
  render(<MemoryRouter initialEntries={['/tutor/bookings/3/session']}><Routes><Route path="/tutor/bookings/:id/session" element={<LessonSession />} /></Routes></MemoryRouter>)
}
beforeEach(() => { vi.resetAllMocks(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

test('physical check-in needs an in-range GPS reading and a photo, and reads GPS again at submit', async () => {
  const read = vi.fn().mockImplementationOnce(ok => ok({ coords: { latitude: 3.01, longitude: 101, accuracy: 10 } }))
    .mockImplementation(ok => ok({ coords: { latitude: 3.001, longitude: 101, accuracy: 10 } }))
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition: read } }))
  const photo = { url: 'https://example.org/checkin.jpg', version: 1, signature: 'receipt' }
  uploadImage.mockResolvedValue(photo)
  api.post.mockResolvedValue({ data: { ...data, attendance: { checkInAt: time, distance: 111 } } })
  show(data)
  const check = await screen.findByRole('button', { name: 'Check in', exact: true })
  expect(check).toBeDisabled()
  fireEvent.click(screen.getByText('Check my location'))
  expect(await screen.findByText(/Outside the check-in area/)).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Check-in photo'), { target: { files: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] } })
  await screen.findByText('Photo ready for check-in.')
  expect(check).toBeDisabled()
  fireEvent.click(screen.getByText('Refresh my location'))
  await waitFor(() => expect(check).toBeEnabled())
  fireEvent.click(check)
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tutor/bookings/3/session', { action: 'check-in', coords: { lat: 3.001, lng: 101 }, photo }))
  expect(read).toHaveBeenCalledTimes(3)
  expect(screen.getByRole('button', { name: 'Check out' })).toBeDisabled()
})

test('both report fields are required after checkout', async () => {
  show({ ...data, mode: 'ONLINE', attendance: { checkInAt: time, checkOutAt: time } })
  const button = await screen.findByRole('button', { name: 'Submit report and complete session' })
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText('What was covered'), { target: { value: 'Fractions' } })
  expect(button).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Student progress'), { target: { value: 'Can simplify fractions.' } })
  expect(button).toBeEnabled()
  expect(screen.queryByText('Check my location')).toBeNull()
})
