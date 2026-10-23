import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: (e) => e?.response?.data?.message || e.message }))
const saveCsv = vi.fn()
vi.mock('../lib/csv', () => ({ saveCsv: (...a) => saveCsv(...a) }))

import api from '../api/client'
import ProgressReport from '../pages/parent/ProgressReport'

const report = (over = {}) => ({
  generatedAt: '2026-10-23T02:00:00Z',
  child: { id: 7, name: 'Sarah Tan', educationLevel: 'PRIMARY', grade: 5 },
  parentName: 'Miki Tan',
  period: { from: null, to: null, subject: null },
  subjectsAvailable: ['English', 'Mathematics'],
  totals: { lessons: 2, hours: 2, tutors: 1, summaries: 2, homeworkSet: 1, physicalLessons: 1, checkedIn: 1, averageRating: 4.5 },
  subjects: [{ subject: 'Mathematics', lessons: 2, hours: 2, tutors: ['Daniel Tan'] }],
  lessons: [
    { bookingId: 2, subject: 'Mathematics', startAt: '2026-03-02T02:00:00Z', endAt: '2026-03-02T03:00:00Z', teachingMode: 'PHYSICAL', tutor: 'Daniel Tan', attended: true,
      summary: { content: 'Decimals.', progressNote: 'Improving', topics: 'Decimals', homework: 'Page 12, 1-10', recommendations: 'Daily practice' } },
    { bookingId: 1, subject: 'Mathematics', startAt: '2026-01-12T02:00:00Z', endAt: '2026-01-12T03:00:00Z', teachingMode: 'ONLINE', tutor: 'Daniel Tan', attended: null, summary: null },
  ],
  ...over,
})
const renderPage = () => render(<MemoryRouter initialEntries={['/parent/children/7/report']}><Routes><Route path="/parent/children/:id/report" element={<ProgressReport />} /></Routes></MemoryRouter>)

beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue({ data: report() }) })

describe('progress report', () => {
  test('shows the totals, the subjects and every lesson with the tutor’s homework', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Learning Progress Report' })).toBeInTheDocument()
    expect(screen.getByText(/Sarah Tan, Primary 5/)).toBeInTheDocument()
    expect(screen.getByText('Tutor summaries').previousSibling).toHaveTextContent('2 of 2')
    expect(screen.getByText(/Homework \/ follow-up:/)).toBeInTheDocument()
    expect(screen.getByText('Page 12, 1-10')).toBeInTheDocument()
    expect(screen.getByText('No summary for this lesson.')).toBeInTheDocument()
    expect(screen.getByText(/Online/)).toBeInTheDocument()
  })

  test('asks again with the chosen subject, and with dates when "Choose dates" is used', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Learning Progress Report' })
    await userEvent.selectOptions(screen.getByLabelText('Subject'), 'English')
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/parent/children/7/report', { params: { from: '', to: '', subject: 'English' } }))
    await userEvent.click(screen.getByRole('radio', { name: 'This year' }))
    await waitFor(() => expect(api.get.mock.calls.at(-1)[1].params.from).toMatch(/^\d{4}-01-01$/))
  })

  test('refuses a period that ends before it starts, without asking the server', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Learning Progress Report' })
    await userEvent.click(screen.getByRole('radio', { name: 'Choose dates' }))
    const calls = api.get.mock.calls.length
    await userEvent.type(screen.getByLabelText('To'), '2026-01-01')
    await userEvent.type(screen.getByLabelText('From'), '2026-06-01')
    expect(await screen.findByText('The start date must be on or before the end date.')).toBeInTheDocument()
    expect(api.get.mock.calls.length).toBe(calls + 1) // only the "To" date alone was sent; the impossible pair was not
  })

  test('downloads a spreadsheet with one row per lesson', async () => {
    renderPage()
    await screen.findByRole('heading', { name: 'Learning Progress Report' })
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
    const [rows, name] = saveCsv.mock.calls[0]
    expect(rows).toHaveLength(3) // header + 2 lessons
    expect(rows[0]).toContain('Homework / follow-up')
    expect(rows[1].includes('Page 12, 1-10')).toBe(true)
    expect(rows[2][5]).toBe('Not tracked (online)')
    expect(name).toBe('progress-report-Sarah-Tan.csv')
  })

  test('an empty period says so and does not offer a download', async () => {
    api.get.mockResolvedValue({ data: report({ lessons: [], subjects: [], totals: { ...report().totals, lessons: 0 } }) })
    renderPage()
    expect(await screen.findByText('No completed lessons in this period')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
  })

  test('shows the server message when the report cannot be loaded', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('x'), { response: { status: 404, data: { message: 'Child not found' } } }))
    renderPage()
    expect(await screen.findByText('Child not found')).toBeInTheDocument()
  })
})
