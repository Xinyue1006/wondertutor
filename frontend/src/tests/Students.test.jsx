import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn() }, errorMessage: (e) => e.message }))

import api from '../api/client'
import Students from '../pages/tutor/Students'

const sarah = { id: 1, name: 'Sarah Lim', grade: 5 }
const adam = { id: 2, name: 'Adam Tan', grade: 3 }
const lesson = (id, child, status, startAt = '2026-12-07T09:00:00.000Z', subject = 'Mathematics') => ({ id, child, status, startAt, subject })

const show = (bookings) => {
  api.get.mockResolvedValue({ data: { bookings } })
  return render(<MemoryRouter><Students /></MemoryRouter>)
}
const summaries = () => screen.queryAllByText(/· \d+ lessons?$/).map((n) => n.textContent)

beforeEach(() => { vi.resetAllMocks() })

test('loads the tutor lesson list', async () => {
  show([])
  await screen.findByText('No matching students.')
  expect(api.get).toHaveBeenCalledWith('/tutor/bookings', expect.objectContaining({ signal: expect.any(AbortSignal) }))
})

test('groups lessons by student and shows the grade and lesson count', async () => {
  show([lesson(1, sarah, 'CONFIRMED'), lesson(2, sarah, 'COMPLETED'), lesson(3, adam, 'CONFIRMED')])
  await screen.findByText('Sarah Lim · 5 · 2 lessons')
  expect(summaries()).toEqual(['Sarah Lim · 5 · 2 lessons', 'Adam Tan · 3 · 1 lessons'])
})

test('lists confirmed, completed and disputed lessons only', async () => {
  show([
    lesson(1, sarah, 'CONFIRMED'), lesson(2, sarah, 'COMPLETED'), lesson(3, sarah, 'DISPUTED'),
    lesson(4, sarah, 'PENDING'), lesson(5, sarah, 'CANCELLED'), lesson(6, sarah, 'REJECTED'), lesson(7, sarah, 'AWAITING_PAYMENT'),
  ])
  expect(await screen.findByText('Sarah Lim · 5 · 3 lessons')).toBeInTheDocument()
})

test('a child with only requests or cancelled lessons is not listed', async () => {
  show([lesson(1, adam, 'PENDING'), lesson(2, adam, 'CANCELLED')])
  expect(await screen.findByText('No matching students.')).toBeInTheDocument()
})

test('each lesson links to its session page with date, subject and status', async () => {
  show([lesson(9, sarah, 'COMPLETED', '2026-12-07T09:00:00.000Z', 'Science')])
  fireEvent.click(await screen.findByText('Sarah Lim · 5 · 1 lessons'))
  const link = screen.getByRole('link', { name: /Science · completed/ })
  expect(link).toHaveAttribute('href', '/tutor/bookings/9/session')
  expect(link).toHaveTextContent('7 Dec 2026')
})

test('search finds a student by part of the name, ignoring case', async () => {
  show([lesson(1, sarah, 'CONFIRMED'), lesson(2, adam, 'CONFIRMED')])
  await screen.findByText('Adam Tan · 3 · 1 lessons')
  fireEvent.change(screen.getByLabelText('Find a student'), { target: { value: 'sAr' } })
  expect(summaries()).toEqual(['Sarah Lim · 5 · 1 lessons'])
})

test('search with no match says so and clearing it shows everyone again', async () => {
  show([lesson(1, sarah, 'CONFIRMED'), lesson(2, adam, 'CONFIRMED')])
  await screen.findByText('Adam Tan · 3 · 1 lessons')
  const box = screen.getByLabelText('Find a student')
  fireEvent.change(box, { target: { value: 'zzz' } })
  expect(screen.getByText('No matching students.')).toBeInTheDocument()
  fireEvent.change(box, { target: { value: '' } })
  expect(summaries()).toHaveLength(2)
})

test('two children with the same name stay separate', async () => {
  show([lesson(1, sarah, 'CONFIRMED'), lesson(2, { id: 3, name: 'Sarah Lim', grade: 2 }, 'CONFIRMED')])
  await screen.findByText('Sarah Lim · 5 · 1 lessons')
  expect(screen.getByText('Sarah Lim · 2 · 1 lessons')).toBeInTheDocument()
})

test("a student's lessons stay in the order the server sent them", async () => {
  show([lesson(1, sarah, 'COMPLETED', '2026-11-02T09:00:00.000Z'), lesson(2, sarah, 'CONFIRMED', '2026-12-07T09:00:00.000Z')])
  const group = (await screen.findByText('Sarah Lim · 5 · 2 lessons')).closest('details')
  fireEvent.click(within(group).getByText('Sarah Lim · 5 · 2 lessons'))
  const links = within(group).getAllByRole('link').map((a) => a.getAttribute('href'))
  expect(links).toEqual(['/tutor/bookings/1/session', '/tutor/bookings/2/session'])
})

test('a failed load can be retried', async () => {
  api.get.mockRejectedValueOnce(new Error('Network error')).mockResolvedValue({ data: { bookings: [lesson(1, sarah, 'CONFIRMED')] } })
  render(<MemoryRouter><Students /></MemoryRouter>)
  expect(await screen.findByText('Network error')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /try again|retry/i }))
  expect(await screen.findByText('Sarah Lim · 5 · 1 lessons')).toBeInTheDocument()
})
