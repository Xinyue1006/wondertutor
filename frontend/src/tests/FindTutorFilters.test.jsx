import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import FindTutor from '../pages/parent/FindTutor'
import api from '../api/client'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: String }))
vi.mock('../assistant/MatchingContext', () => ({ useMatching: () => ({
  catalog: { subjects: ['Mathematics', 'Chemistry'], subjectLevels: { Mathematics: ['PRIMARY', 'SECONDARY'], Chemistry: ['SECONDARY'] }, homeLocation: 'Kuala Lumpur' },
  kids: [{ educationLevel: 'SECONDARY', grade: 5, subject: 'Chemistry' }], kidsLoaded: true,
}) }))
vi.mock('../components/PlaceSearch', () => ({ default: ({ value, onChange }) => <label>Location<input value={value} onChange={(e) => onChange(e.target.value)} /></label> }))

beforeEach(() => {
  api.get.mockReset()
  api.get.mockResolvedValue({ data: { tutors: [], total: 0, page: 1, totalPages: 1, pageSize: 9 } })
})

const open = () => render(<MemoryRouter><FindTutor /></MemoryRouter>)

test('changing Form 5 to Primary 1 removes Chemistry and requires a compatible subject', async () => {
  open()
  const subject = await screen.findByRole('combobox', { name: /Subject/ })
  expect(subject).toHaveValue('Chemistry')
  fireEvent.change(screen.getByRole('combobox', { name: /Education Level/ }), { target: { value: 'PRIMARY:1' } })
  expect(subject).toHaveValue('')
  expect(within(subject).queryByRole('option', { name: 'Chemistry' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Search Tutors' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Subject and education level are required')
  fireEvent.change(subject, { target: { value: 'Mathematics' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search Tutors' }))
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toMatchObject({ subject: 'Mathematics', level: 'PRIMARY', grade: 1 }))
  fireEvent.change(screen.getByRole('combobox', { name: /Education Level/ }), { target: { value: 'SECONDARY:5' } })
  expect(subject).toHaveValue('Mathematics')
  expect(within(subject).getByRole('option', { name: 'Chemistry' })).toBeInTheDocument()
})

test('Clear filters clears optional search fields and extra filters and restores default sorting', async () => {
  open()
  await screen.findByRole('combobox', { name: /Subject/ })
  fireEvent.click(screen.getByRole('button', { name: 'Price' }))
  fireEvent.click(screen.getByRole('button', { name: 'Under 50' }))
  fireEvent.click(screen.getByRole('button', { name: 'Select date & time' }))
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2027-01-01' } })
  fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '09:00' } })
  fireEvent.click(screen.getByRole('button', { name: 'Done' }))
  fireEvent.click(screen.getByRole('button', { name: 'Search Tutors' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Sort by:' }), { target: { value: 'price_asc' } })
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toMatchObject({ maxPrice: 49, date: '2027-01-01', time: '09:00', location: 'Kuala Lumpur', sort: 'price_asc' }))
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
  expect(screen.getByLabelText('Location')).toHaveValue('')
  expect(screen.getByRole('button', { name: 'Select date & time' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: /Subject/ })).toHaveValue('Chemistry')
  await waitFor(() => expect(api.get.mock.lastCall[1].params).toEqual({ subject: 'Chemistry', level: 'SECONDARY', grade: 5, sort: 'recommended', page: 1, pageSize: 9 }))
})
