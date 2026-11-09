import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), put: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))

import api from '../api/client'
import Availability from '../pages/tutor/Availability'

const bounds = { start: '07:00', end: '22:00' }
const slot = (dayOfWeek, startTime, endTime) => ({ dayOfWeek, startTime, endTime })
const LOADED = { slots: [slot(1, '14:00', '17:00')], locked: [{ dayOfWeek: 1, startTime: '15:00' }], bounds }
const LOCKED_NAME = 'Monday 15:00 to 16:00, booked lesson, locked'

const cell = (name) => screen.getByRole('button', { name })
const saveButton = () => screen.getByRole('button', { name: 'Save availability' })

async function setup(data = LOADED) {
  api.get.mockResolvedValue({ data })
  api.put.mockImplementation((_, body) => Promise.resolve({ data: { ...data, slots: body.slots } }))
  render(<Availability />)
  await screen.findByText('My availability')
}

beforeEach(() => vi.clearAllMocks())

describe('tutor availability page', () => {
  test('shows the loaded schedule, the weekly total and the booked hour', async () => {
    await setup()
    expect(cell('Monday 14:00 to 15:00')).toHaveAttribute('aria-pressed', 'true')
    expect(cell('Monday 17:00 to 18:00')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('3 hours a week')).toBeInTheDocument()
    expect(cell(LOCKED_NAME)).toHaveAttribute('title', 'Booked lesson on this day. Cancel or reschedule it first.')
  })

  test('a load failure offers Try again', async () => {
    api.get.mockRejectedValueOnce(new Error('Server is down'))
    api.get.mockResolvedValueOnce({ data: LOADED })
    render(<Availability />)
    expect(await screen.findByText('Server is down')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByText('My availability')).toBeInTheDocument()
  })

  test('clicking a cell switches it on and off and updates the total', async () => {
    await setup()
    const c = cell('Tuesday 09:00 to 10:00')
    await userEvent.click(c)
    expect(c).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('4 hours a week')).toBeInTheDocument()
    await userEvent.click(c)
    expect(c).toHaveAttribute('aria-pressed', 'false')
  })

  test('Enter or Space on a focused cell toggles it (a click with no pointer)', async () => {
    await setup()
    const c = cell('Tuesday 09:00 to 10:00')
    fireEvent.click(c, { detail: 0 })
    expect(c).toHaveAttribute('aria-pressed', 'true')
  })

  test('dragging paints every cell it passes over', async () => {
    await setup()
    const from = cell('Tuesday 09:00 to 10:00')
    const over = cell('Tuesday 10:00 to 11:00')
    document.elementFromPoint = () => over
    fireEvent.pointerDown(from, { button: 0 })
    fireEvent.pointerMove(from)
    fireEvent.pointerUp(window)
    delete document.elementFromPoint
    expect(from).toHaveAttribute('aria-pressed', 'true')
    expect(over).toHaveAttribute('aria-pressed', 'true')
  })

  test('a fast drag also paints the hours between, but never switches off a locked one', async () => {
    await setup()
    const from = cell('Monday 13:00 to 14:00')
    const to = cell('Monday 16:00 to 17:00')
    await userEvent.click(from) // on
    await userEvent.click(from) // off again, so the next press paints on
    document.elementFromPoint = () => to
    fireEvent.pointerDown(from, { button: 0 })
    fireEvent.pointerMove(from)
    fireEvent.pointerUp(window)
    delete document.elementFromPoint
    expect(from).toHaveAttribute('aria-pressed', 'true')
    expect(cell('Monday 14:00 to 15:00')).toHaveAttribute('aria-pressed', 'true')
    expect(cell(LOCKED_NAME)).toHaveAttribute('aria-pressed', 'true')
    expect(to).toHaveAttribute('aria-pressed', 'true')
  })

  describe('on touch', () => {
    const touch = { button: 0, pointerType: 'touch' }
    afterEach(() => vi.useRealTimers())
    const hold = () => act(() => vi.advanceTimersByTime(350))

    test('a quick tap toggles the cell when the finger lifts', async () => {
      await setup()
      const c = cell('Tuesday 09:00 to 10:00')
      fireEvent.pointerDown(c, touch)
      expect(c).toHaveAttribute('aria-pressed', 'false')
      fireEvent.pointerUp(window)
      expect(c).toHaveAttribute('aria-pressed', 'true')
    })

    test('a swipe that the browser turns into a scroll changes nothing', async () => {
      await setup()
      const c = cell('Tuesday 09:00 to 10:00')
      const other = cell('Tuesday 10:00 to 11:00')
      document.elementFromPoint = () => other
      vi.useFakeTimers()
      fireEvent.pointerDown(c, touch)
      fireEvent.pointerMove(c) // not held yet, so this must not paint
      fireEvent.pointerCancel(window)
      hold() // the cancelled press must not start painting later
      delete document.elementFromPoint
      expect(c).toHaveAttribute('aria-pressed', 'false')
      expect(other).toHaveAttribute('aria-pressed', 'false')
    })

    test('press and hold, then drag, paints the hours', async () => {
      await setup()
      const from = cell('Tuesday 09:00 to 10:00')
      const over = cell('Tuesday 11:00 to 12:00')
      document.elementFromPoint = () => over
      vi.useFakeTimers()
      fireEvent.pointerDown(from, touch)
      hold()
      expect(from).toHaveAttribute('aria-pressed', 'true')
      fireEvent.pointerMove(from)
      fireEvent.pointerUp(window)
      delete document.elementFromPoint
      expect(cell('Tuesday 10:00 to 11:00')).toHaveAttribute('aria-pressed', 'true')
      expect(over).toHaveAttribute('aria-pressed', 'true')
    })
  })

  test('a locked cell cannot be toggled', async () => {
    await setup()
    const c = cell(LOCKED_NAME)
    expect(c).toBeDisabled()
    await userEvent.click(c)
    expect(c).toHaveAttribute('aria-pressed', 'true')
  })

  test('Add many hours at once switches on the chosen hours and leaves the others', async () => {
    await setup()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Wednesday' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Friday' }))
    await userEvent.selectOptions(screen.getByLabelText('From'), '09:00')
    await userEvent.selectOptions(screen.getByLabelText('To'), '11:00')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    for (const name of ['Wednesday 09:00 to 10:00', 'Wednesday 10:00 to 11:00', 'Friday 09:00 to 10:00', 'Friday 10:00 to 11:00'])
      expect(cell(name)).toHaveAttribute('aria-pressed', 'true')
    expect(cell('Wednesday 11:00 to 12:00')).toHaveAttribute('aria-pressed', 'false')
    expect(cell('Monday 14:00 to 15:00')).toHaveAttribute('aria-pressed', 'true')
  })

  test('Add explains a missing day and a backwards time range', async () => {
    await setup()
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one day.')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Monday' }))
    await userEvent.selectOptions(screen.getByLabelText('From'), '18:00')
    await userEvent.selectOptions(screen.getByLabelText('To'), '09:00')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The end time must be later than the start time.')
  })

  test('a preset adds its hours', async () => {
    await setup()
    await userEvent.click(screen.getByRole('button', { name: 'Weekends 09:00–17:00' }))
    expect(cell('Sunday 16:00 to 17:00')).toHaveAttribute('aria-pressed', 'true')
    expect(cell('Saturday 09:00 to 10:00')).toHaveAttribute('aria-pressed', 'true')
    expect(cell('Friday 09:00 to 10:00')).toHaveAttribute('aria-pressed', 'false')
  })

  test('Clear this day and Clear all leave the booked hour on', async () => {
    await setup()
    await userEvent.click(screen.getByRole('button', { name: 'Clear Monday' }))
    expect(cell('Monday 14:00 to 15:00')).toHaveAttribute('aria-pressed', 'false')
    expect(cell(LOCKED_NAME)).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(cell('Tuesday 09:00 to 10:00'))
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(cell('Tuesday 09:00 to 10:00')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('1 hour a week')).toBeInTheDocument()
  })

  test('Save is disabled until something changes, and again if the change is undone', async () => {
    await setup()
    expect(saveButton()).toBeDisabled()
    const c = cell('Tuesday 09:00 to 10:00')
    await userEvent.click(c)
    expect(saveButton()).toBeEnabled()
    await userEvent.click(c)
    expect(saveButton()).toBeDisabled()
  })

  test('Save sends merged ranges and the success message stays', async () => {
    await setup()
    await userEvent.click(cell('Monday 17:00 to 18:00'))
    await userEvent.click(saveButton())
    expect(api.put).toHaveBeenCalledWith('/tutor/availability', { slots: [slot(1, '14:00', '18:00')] })
    expect(await screen.findByText('Your availability has been saved.')).toBeInTheDocument()
    await waitFor(() => expect(saveButton()).toBeDisabled())
  })

  test('a 409 from the server is shown on the page and the changes are kept', async () => {
    await setup()
    const message = 'Mon 15:00 has a booked lesson. Cancel or reschedule it first.'
    api.put.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 409, data: { message } } }))
    const c = cell('Tuesday 09:00 to 10:00')
    await userEvent.click(c)
    await userEvent.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(c).toHaveAttribute('aria-pressed', 'true')
    expect(saveButton()).toBeEnabled()
  })

  test('an empty schedule shows a plain note', async () => {
    await setup({ slots: [], locked: [], bounds })
    expect(screen.getByText("Parents can't book you until you add hours.")).toBeInTheDocument()
    expect(screen.getByText('0 hours a week')).toBeInTheDocument()
  })

  test('leaving through a link with unsaved changes asks first', async () => {
    await setup()
    const link = document.body.appendChild(Object.assign(document.createElement('a'), { href: '/tutor/earnings' }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(link)
    expect(confirm).not.toHaveBeenCalled() // nothing unsaved yet
    await userEvent.click(cell('Tuesday 09:00 to 10:00'))
    const notPrevented = fireEvent.click(link)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(notPrevented).toBe(false)
    confirm.mockRestore()
    link.remove()
  })
})
