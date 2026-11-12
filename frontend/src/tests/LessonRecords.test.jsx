import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import api from '../api/client'
import ChildProgress from '../pages/parent/ChildProgress'
import LessonDetails from '../components/LessonDetails'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() }, errorMessage: e => e.message }))
const startAt = '2026-11-12T06:00:00Z', endAt = '2026-11-12T07:00:00Z'
const child = { id: 1, name: 'Example Child', educationLevel: 'PRIMARY', grade: 4 }
const tutor = { id: 2, name: 'Example Tutor', rating: 5, reviewCount: 1 }
const attendance = { checkInAt: startAt, checkOutAt: endAt }
beforeEach(() => vi.clearAllMocks())

test('parents see online check-in and checkout in the child progress timeline', async () => {
  api.get.mockResolvedValue({ data: { child, stats: { completedLessons: 1, totalHours: 1, summariesReceived: 0, physicalLessons: 0, attendanceTrackedLessons: 1, checkedInLessons: 1 },
    subjects: [], nextLesson: null, timeline: [{ bookingId: 3, subject: 'Mathematics', teachingMode: 'ONLINE', startAt, endAt, attendance, tutor }] } })
  render(<MemoryRouter initialEntries={['/parent/children/1/progress']}><Routes><Route path="/parent/children/:id/progress" element={<ChildProgress />} /></Routes></MemoryRouter>)
  await screen.findByRole('heading', { name: "Example Child's Learning Progress" })
  expect(screen.getByText('Lessons checked in').previousSibling).toHaveTextContent('1 of 1')
  expect(screen.getByText(/Checked in .*out/)).toBeInTheDocument()
  expect(screen.queryByText(/Physical lessons \(GPS/)).not.toBeInTheDocument()
})

test('lesson details show the recorded homework and next-session plan without claiming independent attendance verification', () => {
  render(<MemoryRouter><LessonDetails onClose={() => {}} booking={{ id: 3, subject: 'Mathematics', status: 'COMPLETED', teachingMode: 'ONLINE', child, tutor, startAt, endAt, createdAt: startAt,
    attendance, summary: { content: 'Fractions', progressNote: 'Improving', homework: 'Exercises 1–5', recommendations: 'Review fractions next lesson.' } }} /></MemoryRouter>)
  expect(screen.getByText('Tutor attendance record')).toBeInTheDocument()
  expect(screen.queryByText('Attendance verified')).not.toBeInTheDocument()
  expect(screen.getByText('Exercises 1–5')).toBeInTheDocument()
  expect(screen.getByText('Review fractions next lesson.')).toBeInTheDocument()
})
