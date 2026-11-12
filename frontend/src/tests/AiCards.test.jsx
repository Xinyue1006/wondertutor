import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import AiCard from '../assistant/AiCards'

const lesson = { type: 'lesson_detail', subject: 'Mathematics', childName: 'Synthetic Child', tutorName: 'Synthetic Tutor', date: '2026-11-13', time: '17:00', mode: 'ONLINE', status: 'COMPLETED', summary: null, link: '/parent/bookings', checkIn: { recorded: true, checkInTime: '17:02', checkOutTime: '18:00' } }
const show = card => render(<MemoryRouter><AiCard card={card} /></MemoryRouter>)

test('actual online attendance times are shown in the assistant lesson card', () => {
  show(lesson)
  expect(screen.getByText('Checked in 17:02, out 18:00')).toBeInTheDocument()
  expect(screen.queryByText(/not tracked/i)).not.toBeInTheDocument()
})

test('legacy online attendance stays unknown rather than claiming absence', () => {
  show({ ...lesson, checkIn: { recorded: null, checkInTime: null, checkOutTime: null } })
  expect(screen.getByText('No attendance record available')).toBeInTheDocument()
  expect(screen.queryByText('No check-in recorded')).not.toBeInTheDocument()
})

test('progress uses the tracked-lesson denominator when online attendance exists', () => {
  show({ type: 'progress_summary', childName: 'Synthetic Child', link: '/parent/children', totals: { lessons: 2, hours: 2, summaries: 2, homeworkSet: 1, physicalLessons: 1, attendanceTrackedLessons: 2, checkedIn: 2 }, recentLessons: [] })
  expect(screen.getByText('Lessons checked in')).toBeInTheDocument()
  expect(screen.getByText('2 of 2')).toBeInTheDocument()
  expect(screen.queryByText('2 of 1')).not.toBeInTheDocument()
})
