import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({ default: { get: vi.fn(), put: vi.fn(), delete: vi.fn() }, errorMessage: (e) => e.message }))

import api from '../api/client'
import DateAvailability from '../pages/tutor/DateAvailability'
import { todayYmd } from '../lib/format'

const saved = [
  { id: 1, date: '2099-01-05', ranges: [{ startTime: '10:00', endTime: '12:00' }, { startTime: '14:00', endTime: '15:00' }] },
  { id: 2, date: '2099-01-06', ranges: [] },
]
const show = (exceptions = []) => {
  api.get.mockResolvedValue({ data: { exceptions } })
  return render(<MemoryRouter><DateAvailability /></MemoryRouter>)
}
const pickDate = (value) => fireEvent.change(screen.getByLabelText('Exception date'), { target: { value } })
const rangeRows = () => screen.queryAllByRole('button', { name: 'Remove hours' }).length

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  api.put.mockResolvedValue({ data: { ok: true } })
  api.delete.mockResolvedValue({ data: { ok: true } })
})
afterEach(() => vi.restoreAllMocks())

test('starts on today, cannot pick a past date, and links back to the weekly page', async () => {
  show()
  expect(await screen.findByText('No date exceptions saved.')).toBeInTheDocument()
  const input = screen.getByLabelText('Exception date')
  expect(input).toHaveValue(todayYmd())
  expect(input).toHaveAttribute('min', todayYmd())
  expect(screen.getByRole('link', { name: 'Back to weekly availability' })).toHaveAttribute('href', '/tutor/availability')
  expect(api.get).toHaveBeenCalledWith('/tutor/availability/exceptions')
})

test('lists saved dates with their hours or as unavailable all day', async () => {
  show(saved)
  expect(await screen.findByRole('button', { name: '2099-01-05 · 10:00–12:00, 14:00–15:00' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '2099-01-06 · Unavailable all day' })).toBeInTheDocument()
})

test('choosing a saved date loads its hours into the form', async () => {
  show(saved)
  fireEvent.click(await screen.findByRole('button', { name: /^2099-01-05/ }))
  expect(screen.getByLabelText('Exception date')).toHaveValue('2099-01-05')
  expect(rangeRows()).toBe(2)
  expect(screen.getByLabelText('startTime 0')).toHaveValue('10:00')
  expect(screen.getByLabelText('endTime 1')).toHaveValue('15:00')
})

test('typing a date that has saved hours loads them too', async () => {
  show(saved)
  await screen.findByRole('button', { name: /^2099-01-05/ })
  pickDate('2099-01-05')
  expect(rangeRows()).toBe(2)
  pickDate('2099-02-01')
  expect(rangeRows()).toBe(0)
})

test('Add hours adds a 09:00 to 10:00 row that can be edited and removed', async () => {
  show()
  await screen.findByText('No date exceptions saved.')
  fireEvent.click(screen.getByRole('button', { name: 'Add hours' }))
  expect(screen.getByLabelText('startTime 0')).toHaveValue('09:00')
  expect(screen.getByLabelText('endTime 0')).toHaveValue('10:00')
  fireEvent.change(screen.getByLabelText('endTime 0'), { target: { value: '11:00' } })
  expect(screen.getByLabelText('endTime 0')).toHaveValue('11:00')
  fireEvent.click(screen.getByRole('button', { name: 'Remove hours' }))
  expect(rangeRows()).toBe(0)
})

test('Add hours stops at 24 rows', async () => {
  show()
  await screen.findByText('No date exceptions saved.')
  const add = screen.getByRole('button', { name: 'Add hours' })
  for (let i = 0; i < 24; i++) fireEvent.click(add)
  expect(rangeRows()).toBe(24)
  expect(add).toBeDisabled()
})

test('saving sends the date and edited hours, then reloads the saved list', async () => {
  show()
  await screen.findByText('No date exceptions saved.')
  pickDate('2099-03-02')
  fireEvent.click(screen.getByRole('button', { name: 'Add hours' }))
  fireEvent.change(screen.getByLabelText('startTime 0'), { target: { value: '13:00' } })
  fireEvent.change(screen.getByLabelText('endTime 0'), { target: { value: '15:00' } })
  api.get.mockResolvedValue({ data: { exceptions: [{ id: 3, date: '2099-03-02', ranges: [{ startTime: '13:00', endTime: '15:00' }] }] } })
  fireEvent.click(screen.getByRole('button', { name: 'Save date' }))
  expect(await screen.findByRole('button', { name: '2099-03-02 · 13:00–15:00' })).toBeInTheDocument()
  expect(api.put).toHaveBeenCalledWith('/tutor/availability/exceptions', { date: '2099-03-02', ranges: [{ startTime: '13:00', endTime: '15:00' }] })
  expect(api.get).toHaveBeenCalledTimes(2)
})

test('saving with no hours marks the whole date unavailable', async () => {
  show()
  await screen.findByText('No date exceptions saved.')
  pickDate('2099-03-02')
  fireEvent.click(screen.getByRole('button', { name: 'Save date' }))
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/tutor/availability/exceptions', { date: '2099-03-02', ranges: [] }))
})

test('Restore weekly hours is off until the chosen date has saved hours', async () => {
  show(saved)
  await screen.findByRole('button', { name: /^2099-01-05/ })
  expect(screen.getByRole('button', { name: 'Restore weekly hours' })).toBeDisabled()
  pickDate('2099-01-06')
  expect(screen.getByRole('button', { name: 'Restore weekly hours' })).toBeEnabled()
})

test('restoring deletes the saved date, clears the form and reloads the list', async () => {
  show(saved)
  fireEvent.click(await screen.findByRole('button', { name: /^2099-01-05/ }))
  api.get.mockResolvedValue({ data: { exceptions: [saved[1]] } })
  fireEvent.click(screen.getByRole('button', { name: 'Restore weekly hours' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: /^2099-01-05/ })).toBeNull())
  expect(api.delete).toHaveBeenCalledWith('/tutor/availability/exceptions/2099-01-05')
  expect(rangeRows()).toBe(0)
})

test('a refused save shows the server message and keeps the typed hours', async () => {
  show()
  await screen.findByText('No date exceptions saved.')
  fireEvent.click(screen.getByRole('button', { name: 'Add hours' }))
  api.put.mockRejectedValue(new Error('This change conflicts with an existing lesson or request. Resolve that booking first.'))
  fireEvent.click(screen.getByRole('button', { name: 'Save date' }))
  expect(await screen.findByText(/conflicts with an existing lesson/)).toBeInTheDocument()
  expect(rangeRows()).toBe(1)
})

test('a refused restore shows the server message and keeps the saved date', async () => {
  show(saved)
  fireEvent.click(await screen.findByRole('button', { name: /^2099-01-05/ }))
  api.delete.mockRejectedValue(new Error('The weekly schedule conflicts with an existing lesson or request.'))
  fireEvent.click(screen.getByRole('button', { name: 'Restore weekly hours' }))
  expect(await screen.findByText(/weekly schedule conflicts/)).toBeInTheDocument()
  expect(rangeRows()).toBe(2)
})

test('the buttons are locked while a save is running', async () => {
  show()
  await screen.findByText('No date exceptions saved.')
  let finish
  api.put.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: 'Save date' }))
  expect(screen.getByRole('button', { name: 'Save date' })).toBeDisabled()
  finish({ data: { ok: true } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save date' })).toBeEnabled())
})

test('a failed first load shows the error', async () => {
  api.get.mockRejectedValue(new Error('Network error'))
  render(<MemoryRouter><DateAvailability /></MemoryRouter>)
  expect(await screen.findByText('Network error')).toBeInTheDocument()
})

test('opening a date from the weekly preview loads the saved ranges for that date', async () => {
  api.get.mockResolvedValue({ data: { exceptions: saved } })
  render(<MemoryRouter initialEntries={['/tutor/availability/dates?date=2099-01-05']}><DateAvailability /></MemoryRouter>)
  expect(await screen.findByLabelText('startTime 0')).toHaveValue('10:00')
  expect(screen.getByLabelText('Exception date')).toHaveValue('2099-01-05')
  expect(screen.getByLabelText('endTime 1')).toHaveValue('15:00')
})
