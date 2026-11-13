import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import api from '../api/client'
import MyChildren from '../pages/parent/MyChildren'
import MyBookings from '../pages/parent/MyBookings'
import Complaints from '../pages/parent/Complaints'
import Payments from '../pages/parent/Payments'
import AdminComplaints from '../pages/admin/AdminComplaints'
import { matchesRecordRef, recordRef, referenceInput } from '../lib/recordRef'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() }, errorMessage: e => e.message }))
vi.mock('../assistant/MatchingContext', () => ({ useMatching: () => ({ catalog: { subjects: ['Mathematics'], subjectLevels: { Mathematics: ['PRIMARY'] } }, refreshChildren: async () => {}, applyChild: () => {} }) }))
vi.mock('../components/PhotoPicker', () => ({ default: () => null, pickImage: vi.fn() }))
vi.mock('../components/LessonDetails', () => ({ default: ({ booking, footer, children, actions }) => booking ? <div data-testid="lesson-details">{booking.publicId || booking.id}{footer}{children}{actions}</div> : null }))
vi.mock('../components/ComplaintsReport', () => ({ default: () => null }))
vi.mock('../components/WarnUser', () => ({ default: () => null }))

const child = { id: 1, publicId: 'bbeb101f-87b2-4ddb-9625-799f01ea005d', name: 'Sarah', educationLevel: 'PRIMARY', grade: 5, subjects: ['Mathematics'], bookingCount: 0 }
const booking = {
  id: 7, publicId: '822299af-7798-4e30-984d-3dbe931bfb2f', status: 'COUNTER_OFFERED', subject: 'Mathematics',
  startAt: '2027-01-02T09:00:00Z', endAt: '2027-01-02T10:00:00Z', createdAt: '2026-11-11T09:00:00Z',
  teachingMode: 'ONLINE', child, tutor: { id: 2, name: 'Ms Tan', rating: 4.5, reviewCount: 2 },
  proposedPrice: 50, counterPrice: 55, hourlyPrice: 55, totalAmount: 55, hours: 1,
}
const paymentId = '92c3e39c-c0f0-477c-a530-e4abec35e899'
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.post.mockResolvedValue({ data: {} })
  api.put.mockResolvedValue({ data: {} })
  api.patch.mockResolvedValue({ data: {} })
})

test('record references support both public IDs and old numeric links', () => {
  expect(recordRef(child)).toBe(child.publicId)
  expect(recordRef({ id: 1 })).toBe(1)
  expect(matchesRecordRef(child, child.publicId)).toBe(true)
  expect(matchesRecordRef(child, '1')).toBe(true)
  expect(matchesRecordRef(child, '2')).toBe(false)
  expect(matchesRecordRef(undefined, 'undefined')).toBe(false)
  expect(referenceInput(child.publicId)).toBe(child.publicId)
  expect(referenceInput('7')).toBe(7)
})

test.each([child.publicId, '1'])('child edit link %s opens the child and saves through its public reference', async ref => {
  api.get.mockResolvedValue({ data: { children: [child] } })
  render(<MemoryRouter initialEntries={[`/parent/children?edit=${ref}`]}><MyChildren /></MemoryRouter>)
  expect(await screen.findByPlaceholderText('e.g. Sarah Tan')).toHaveValue('Sarah')
  fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith(`/parent/children/${child.publicId}`, expect.objectContaining({ name: 'Sarah' })))
  expect(screen.getByRole('link', { name: 'View Learning Progress' })).toHaveAttribute('href', `/parent/children/${child.publicId}/progress`)
})

test.each([booking.publicId, '7'])('booking notification link %s opens details and counter action uses its public reference', async ref => {
  api.get.mockResolvedValue({ data: { bookings: [booking] } })
  render(<MemoryRouter initialEntries={[`/parent/bookings?booking=${ref}`]}><MyBookings /></MemoryRouter>)
  expect(await screen.findByTestId('lesson-details')).toHaveTextContent(booking.publicId)
  fireEvent.click(screen.getByRole('button', { name: 'Accept Counter Offer' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/parent/bookings/${booking.publicId}/accept-counter`, undefined))
})

test.each([booking.publicId, '7'])('complaint deep link %s preselects the lesson and preserves its public reference on submit', async ref => {
  api.get.mockImplementation(async url => ({ data: url === '/parent/complaints'
    ? { complaints: [], categories: ['Lesson issue'] }
    : { bookings: [{ ...booking, status: 'CONFIRMED' }] } }))
  render(<MemoryRouter initialEntries={[`/parent/complaints?booking=${ref}`]}><Complaints /></MemoryRouter>)
  const lesson = await screen.findByRole('combobox', { name: /Related lesson/ })
  await waitFor(() => expect(lesson).toHaveValue(booking.publicId))
  fireEvent.change(screen.getByRole('combobox', { name: /Category/ }), { target: { value: 'Lesson issue' } })
  fireEvent.change(screen.getByRole('textbox', { name: /What happened/ }), { target: { value: 'The tutor did not attend the lesson.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/parent/complaints', expect.objectContaining({ bookingId: booking.publicId })))
})

test('payment receipts and sandbox checkout use public payment and booking references', async () => {
  api.get.mockResolvedValue({ data: {
    required: [{ ...booking, status: 'AWAITING_PAYMENT' }],
    transactions: [{ id: 3, publicId: paymentId, status: 'SUCCESS', amount: 55, booking }],
    summary: { totalPaid: 55, pendingPayment: 55, paidThisMonth: 55 }, banks: ['Maybank'], gateway: 'simulator',
  } })
  api.post.mockImplementation(async url => ({ data: url.endsWith('/checkout') ? { paymentId: 3, paymentPublicId: paymentId } : { status: 'SUCCESS', message: 'Paid' } }))
  render(<MemoryRouter><Payments /></MemoryRouter>)
  expect(await screen.findByRole('link', { name: 'Receipt', exact: true })).toHaveAttribute('href', `/parent/payments/${paymentId}/receipt`)
  fireEvent.click(screen.getByRole('button', { name: /Pay Now/ }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Select your bank' }), { target: { value: 'Maybank' } })
  fireEvent.click(screen.getByRole('button', { name: /^Pay RM/ }))
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/parent/payments/checkout', { bookingId: booking.publicId }))
  expect(api.post).toHaveBeenCalledWith(`/parent/payments/${paymentId}/confirm`, { bank: 'Maybank', outcome: 'SUCCESS' })
})

test('administrator investigates and updates a complaint by its public reference', async () => {
  const complaint = { id: 9, publicId: 'edfa4741-4951-4e16-be16-2f6e6911726a', category: 'Lesson issue', description: 'Tutor did not attend.', status: 'OPEN', createdAt: '2026-11-11', filedBy: { name: 'Parent' } }
  api.get.mockImplementation(async url => ({ data: url === '/admin/complaints'
    ? { counts: { OPEN: 1, IN_PROGRESS: 0, RESOLVED: 0, DISMISSED: 0 }, complaints: [complaint] }
    : { investigation: { booking: null, otherComplaints: [], warnings: [] } } }))
  render(<MemoryRouter><AdminComplaints /></MemoryRouter>)
  fireEvent.click(await screen.findByRole('button', { name: 'Review' }))
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(`/admin/complaints/${complaint.publicId}`))
  fireEvent.click(screen.getByRole('button', { name: 'Mark In Progress' }))
  await waitFor(() => expect(api.patch).toHaveBeenCalledWith(`/admin/complaints/${complaint.publicId}`, { status: 'IN_PROGRESS', adminResponse: undefined }))
})
