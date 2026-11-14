import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import api from '../api/client'
import LessonSession from '../pages/tutor/LessonSession'
import { uploadImage } from '../components/PhotoPicker'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: e => e.message }))
vi.mock('../components/PhotoPicker', () => ({ uploadImage: vi.fn(), uploadError: e => e.message }))
const time = '2026-11-13T06:00:00.000Z'
const data = { id: 3, mode: 'PHYSICAL', radius: 150, latitude: 3, longitude: 101, address: 'Lesson address', locationConfirmedAt: time,
  student: 'Example student', subject: 'Mathematics', status: 'CONFIRMED', serverTime: time,
  startAt: '2026-11-13T05:45:00Z', endAt: '2026-11-13T06:45:00Z' }
function show(session, reference = String(session.id)) {
  api.get.mockResolvedValue({ data: session })
  render(<MemoryRouter initialEntries={['/tutor/bookings/' + reference + '/session']}><Routes><Route path="/tutor/bookings/:id/session" element={<LessonSession />} /></Routes></MemoryRouter>)
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

test('an owned UUID session loads, retains the public link, and submits homework with the report', async () => {
  const publicId = 'e15970e1-b3e5-4883-8b5e-4cdd93e9f7ac'
  const session = { ...data, publicId, mode: 'ONLINE', attendance: { checkInAt: time, checkOutAt: time } }
  const report = { content: 'Fractions', progressNote: 'Can simplify fractions.', homework: 'Practise questions 1 to 5.' }
  api.post.mockResolvedValue({ data: { ...session, status: 'COMPLETED', report } })
  show(session, publicId)
  expect(await screen.findByRole('link', { name: 'Back to my bookings' })).toHaveAttribute('href', '/tutor/bookings?booking=' + publicId)
  fireEvent.change(screen.getByLabelText('What was covered'), { target: { value: report.content } })
  fireEvent.change(screen.getByLabelText('Student progress'), { target: { value: report.progressNote } })
  fireEvent.change(screen.getByLabelText('Homework / follow-up (optional)'), { target: { value: report.homework } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit report and complete session' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tutor/bookings/' + publicId + '/session', { action: 'report', ...report, recommendations: '' }))
  expect(await screen.findByText(report.homework)).toBeInTheDocument()
})

test('an online check-in conflict can refresh the current attendance without replaying the action', async () => {
  show({ ...data, mode: 'ONLINE' })
  const checkIn = await screen.findByRole('button', { name: 'Check in', exact: true })
  expect(checkIn).toBeEnabled()
  api.post.mockRejectedValueOnce(Object.assign(new Error('You have already checked in.'), { response: { status: 409 } }))
  api.get.mockRejectedValueOnce(new Error('The connection failed while refreshing.'))
    .mockResolvedValue({ data: { ...data, mode: 'ONLINE', attendance: { checkInAt: time } } })
  fireEvent.click(checkIn)
  expect(await screen.findByRole('button', { name: 'Refresh session' })).toBeEnabled()
  expect(checkIn).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }))
  expect(await screen.findByText('The connection failed while refreshing.')).toBeInTheDocument()
  expect(checkIn).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }))
  expect(await screen.findByText(/Checked in at/)).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(api.post).toHaveBeenCalledWith('/tutor/bookings/3/session', { action: 'check-in' })
})

test('a legacy area point cannot collect GPS or photos; refreshing uses the newly confirmed entrance', async () => {
  const publicId = '37847bb9-aea5-435a-9417-fdd59e952ddd'
  const legacy = { ...data, publicId, locationConfirmedAt: null, locationNeedsConfirmation: true }
  const exact = { ...data, publicId, latitude: 3.02, address: '17 Jalan Demo, 52000 Kuala Lumpur' }
  const read = vi.fn().mockImplementationOnce(ok => ok({ coords: { latitude: 3, longitude: 101, accuracy: 10 } }))
    .mockImplementation(ok => ok({ coords: { latitude: 3.02, longitude: 101, accuracy: 10 } }))
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition: read } }))
  show(legacy, publicId)
  expect(await screen.findByText(/An area centre cannot be used/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Check my location' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Check in', exact: true })).toBeDisabled()
  expect(screen.getByLabelText('Check-in photo')).toBeDisabled()
  expect(screen.queryByRole('link', { name: 'View lesson map' })).not.toBeInTheDocument()
  expect(read).not.toHaveBeenCalled()
  api.get.mockRejectedValueOnce(new Error('Refresh connection failed.')).mockResolvedValue({ data: exact })
  fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }))
  expect(await screen.findByText('Refresh connection failed.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Check my location' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh session' }))
  expect(await screen.findByText('Lesson address: ' + exact.address)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'View lesson map' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=3.02%2C101')
  fireEvent.click(screen.getByRole('button', { name: 'Check my location' }))
  expect(await screen.findByText(/Outside the check-in area/)).toBeInTheDocument()
  expect(screen.getByText(/2224 m from the address/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh my location' }))
  expect(await screen.findByText(/Within range · 0 m from the address/)).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

test('a legacy check-in keeps its historical record and can check out and report without retroactive venue confirmation', async () => {
  const legacy = { ...data, locationConfirmedAt: null, locationNeedsConfirmation: true, endAt: '2026-11-13T05:59:00Z', attendance: { checkInAt: data.startAt } }
  api.post.mockResolvedValue({ data: { ...legacy, attendance: { ...legacy.attendance, checkOutAt: time } } })
  show(legacy)
  expect(await screen.findByText(/Existing attendance and session reports are kept/)).toBeInTheDocument()
  expect(screen.queryByText(/Ask the parent to confirm/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Refresh session' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'View lesson map' })).not.toBeInTheDocument()
  const checkOut = screen.getByRole('button', { name: 'Check out' })
  expect(checkOut).toBeEnabled()
  fireEvent.click(checkOut)
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tutor/bookings/3/session', { action: 'check-out' }))
  await screen.findByText(/Checked out at/)
  fireEvent.change(screen.getByLabelText('What was covered'), { target: { value: 'Fractions' } })
  fireEvent.change(screen.getByLabelText('Student progress'), { target: { value: 'Improved.' } })
  expect(screen.getByRole('button', { name: 'Submit report and complete session' })).toBeEnabled()
})

test('a tutor can explain a missed check-in and see the submitted review', async () => {
  const ended = { ...data, serverTime: data.endAt }
  const reason = 'My phone lost power.'
  api.post.mockResolvedValue({ data: { ...ended, review: { status: 'OPEN', description: reason } } })
  show(ended)
  const submit = await screen.findByRole('button', { name: 'Request admin review' })
  expect(submit).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Why did you miss check-in?'), { target: { value: reason } })
  const receipt = { url: 'private-image', version: 1, signature: 'receipt' }
  uploadImage.mockResolvedValue(receipt)
  fireEvent.change(screen.getByLabelText(/Supporting photo/), { target: { files: [new File(['proof'], 'lesson.png', { type: 'image/png' })] } })
  await screen.findByText('Proof ready to submit.')
  fireEvent.click(submit)
  expect(await screen.findByText(/Missed check-in review.*Submitted/)).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith('/tutor/bookings/3/session', { action: 'request-review', reason, photo: receipt })
  expect(screen.queryByRole('button', { name: 'Request admin review' })).toBeNull()
})

test('a tutor can provide new written evidence after an unverified decision', async () => {
  const session = { ...data, serverTime: data.endAt, review: { status: 'DISMISSED', attendanceOutcome: 'UNVERIFIED' } }
  show(session)
  expect(await screen.findByText('Attendance could not be verified')).toBeInTheDocument()
  const reason = 'The parent found our dated worksheet.'
  api.post.mockResolvedValue({ data: { ...session, review: { status: 'IN_PROGRESS', attendanceOutcome: 'RECONSIDERATION' } } })
  fireEvent.change(screen.getByLabelText('Describe your new evidence'), { target: { value: reason } })
  fireEvent.click(screen.getByRole('button', { name: 'Request reconsideration' }))
  expect(await screen.findByText('Reconsideration requested')).toBeInTheDocument()
  expect(api.post).toHaveBeenCalledWith('/tutor/bookings/3/session', { action: 'reconsider', reason })
})

test('tutor sees the refund review and the attendance finding together', async () => {
  show({ ...data, serverTime: data.endAt, review: { status: 'DISMISSED', attendanceOutcome: 'NOT_HELD', attendanceRefund: { status: 'PENDING' } } })
  expect(await screen.findByText('Lesson did not take place')).toBeInTheDocument()
  expect(screen.getByText('Refund review: Awaiting admin decision')).toBeInTheDocument()
})

test('tutor sees the approved refund is paused during their appeal', async () => {
  show({ ...data, serverTime: data.endAt, review: { status: 'IN_PROGRESS', attendanceOutcome: 'RECONSIDERATION', attendanceRefund: { status: 'APPROVED', attendanceRefundState: 'ON_HOLD' } } })
  expect(await screen.findByText(/Refund on hold/)).toBeVisible()
})
