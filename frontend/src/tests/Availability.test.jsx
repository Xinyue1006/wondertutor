import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), put: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))

// jsdom has no layout, so FullCalendar cannot draw or drag here. This stand-in renders what the page gives it and
// keeps its props, so a test can call select, eventDrop and eventResize the way the real calendar would.
let calendar
vi.mock('@fullcalendar/react', () => ({
  default: function FullCalendarStub(props) {
    calendar = props
    return (
      <div>
        {[1, 2, 3, 4, 5, 6, 7].map((d) => <div key={d}>{props.dayHeaderContent({ date: new Date(`2001-01-0${d}T00:00:00Z`) })}</div>)}
        {props.events.map((event, i) => <div key={i}>{props.eventContent({ event })}</div>)}
      </div>
    )
  },
}))

import api from '../api/client'
import Availability from '../pages/tutor/Availability'

const bounds = { start: '07:00', end: '22:00' }
const slot = (dayOfWeek, startTime, endTime) => ({ dayOfWeek, startTime, endTime })
const LOADED = { slots: [slot(1, '14:00', '17:00'), slot(3, '09:00', '11:00')], locked: [{ dayOfWeek: 1, startTime: '15:00' }], bounds }
const LOCK_MESSAGE = 'That change would drop an hour with a booked lesson. Cancel or reschedule the lesson first.'

// A moment in the reference week: the 1st is Monday, the 7th is Sunday
const at = (day, time) => new Date(`2001-01-0${day}T${time}:00Z`)
const span = (day, from, to) => ({ start: at(day, from), end: at(day, to) })
const select = (day, from, to) => act(() => calendar.select(span(day, from, to)))
const moved = (oldSpan, newSpan) => ({ oldEvent: oldSpan, event: newSpan, revert: vi.fn() })

const saveButton = () => screen.getByRole('button', { name: 'Save availability' })
const removeMode = () => userEvent.click(screen.getByRole('radio', { name: 'Remove hours' }))

async function setup(data = LOADED) {
  api.get.mockResolvedValue({ data })
  api.put.mockImplementation((_, body) => Promise.resolve({ data: { ...data, slots: body.slots } }))
  render(<Availability />)
  await screen.findByText('My availability')
}

beforeEach(() => vi.clearAllMocks())

describe('tutor availability page', () => {
  test('draws the loaded blocks, the booked hour and the weekly total', async () => {
    await setup()
    expect(screen.getByText('14:00–17:00')).toBeInTheDocument()
    expect(screen.getByText('09:00–11:00')).toBeInTheDocument()
    expect(screen.getByText('Booked lesson, locked').parentElement).toHaveAttribute('title', 'Booked lesson on this day. Cancel or reschedule it first.')
    expect(screen.getByText('5 hours a week')).toBeInTheDocument()
  })

  test('the calendar shows the fixed reference week in UTC, with time ranges down the side', async () => {
    await setup()
    expect(calendar.initialDate).toBe('2001-01-01')
    expect(calendar.timeZone).toBe('UTC')
    expect(calendar.slotMinTime).toBe('07:00:00')
    expect(calendar.slotMaxTime).toBe('22:00:00')
    expect(calendar.slotLabelContent({ text: '07:00' })).toBe('07:00–08:00')
  })

  test('a selection must stay inside one day', async () => {
    await setup()
    expect(calendar.selectAllow(span(2, '09:00', '11:00'))).toBe(true)
    expect(calendar.selectAllow({ start: at(2, '21:00'), end: at(3, '07:00') })).toBe(false)
  })

  test('a load failure offers Try again', async () => {
    api.get.mockRejectedValueOnce(new Error('Server is down'))
    api.get.mockResolvedValueOnce({ data: LOADED })
    render(<Availability />)
    expect(await screen.findByText('Server is down')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByText('My availability')).toBeInTheDocument()
  })

  test('in Add mode a selection switches those hours on', async () => {
    await setup()
    select(2, '10:00', '12:00')
    expect(screen.getByText('10:00–12:00')).toBeInTheDocument()
    expect(screen.getByText('7 hours a week')).toBeInTheDocument()
  })

  test('in Remove mode the same selection switches hours off and can split a block', async () => {
    await setup()
    await removeMode()
    select(3, '09:00', '10:00')
    expect(screen.getByText('10:00–11:00')).toBeInTheDocument()
    expect(screen.getByText('4 hours a week')).toBeInTheDocument()
  })

  test('Remove mode never removes a booked hour', async () => {
    await setup()
    await removeMode()
    select(1, '14:00', '17:00')
    expect(screen.getByText('15:00–16:00')).toBeInTheDocument()
    expect(screen.getByText('3 hours a week')).toBeInTheDocument()
  })

  test('blocks can only be moved in Add mode', async () => {
    await setup()
    expect(calendar.editable).toBe(true)
    await removeMode()
    expect(calendar.editable).toBe(false)
  })

  test('moving a block takes the old hours off and puts the new ones on', async () => {
    await setup()
    const info = moved(span(3, '09:00', '11:00'), span(5, '13:00', '15:00'))
    act(() => calendar.eventDrop(info))
    expect(info.revert).not.toHaveBeenCalled()
    expect(screen.getByText('13:00–15:00')).toBeInTheDocument()
    expect(screen.queryByText('09:00–11:00')).not.toBeInTheDocument()
  })

  test('resizing a block changes its length', async () => {
    await setup()
    act(() => calendar.eventResize(moved(span(3, '09:00', '11:00'), span(3, '09:00', '13:00'))))
    expect(screen.getByText('09:00–13:00')).toBeInTheDocument()
    expect(screen.getByText('7 hours a week')).toBeInTheDocument()
  })

  test('a move that drops a booked hour is reverted and explained', async () => {
    await setup()
    const info = moved(span(1, '14:00', '17:00'), span(2, '14:00', '17:00'))
    act(() => calendar.eventDrop(info))
    expect(info.revert).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent(LOCK_MESSAGE)
    expect(screen.getByText('14:00–17:00')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  test('a resize that drops a booked hour is reverted and explained', async () => {
    await setup()
    const info = moved(span(1, '14:00', '17:00'), span(1, '14:00', '15:00'))
    act(() => calendar.eventResize(info))
    expect(info.revert).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent(LOCK_MESSAGE)
  })

  test('the × button removes a block', async () => {
    await setup()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Wednesday 09:00 to 11:00' }))
    expect(screen.queryByText('09:00–11:00')).not.toBeInTheDocument()
    expect(screen.getByText('3 hours a week')).toBeInTheDocument()
  })

  test('the × button on a block with a booked hour removes the free hours and keeps that one', async () => {
    await setup()
    await userEvent.click(screen.getByRole('button', { name: 'Remove Monday 14:00 to 17:00' }))
    expect(screen.getByText('15:00–16:00')).toBeInTheDocument()
    expect(screen.getByText('3 hours a week')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('Add many hours at once switches on the chosen hours and leaves the others', async () => {
    await setup()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }))
    await userEvent.selectOptions(screen.getByLabelText('From'), '09:00')
    await userEvent.selectOptions(screen.getByLabelText('To'), '12:00')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByText('09:00–12:00')).toBeInTheDocument()
    expect(screen.getByText('14:00–17:00')).toBeInTheDocument()
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
    expect(screen.getAllByText('09:00–17:00')).toHaveLength(2)
    expect(screen.getByText('21 hours a week')).toBeInTheDocument()
  })

  test('Clear this day leaves the booked hour on and other days alone', async () => {
    await setup()
    await userEvent.click(screen.getByRole('button', { name: 'Clear Monday' }))
    expect(screen.getByText('15:00–16:00')).toBeInTheDocument()
    expect(screen.getByText('09:00–11:00')).toBeInTheDocument()
    expect(screen.getByText('3 hours a week')).toBeInTheDocument()
  })

  test('Clear all leaves only the booked hour on', async () => {
    await setup()
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(screen.getByText('15:00–16:00')).toBeInTheDocument()
    expect(screen.getByText('1 hour a week')).toBeInTheDocument()
  })

  test('Save is disabled until something changes, and again if the change is undone', async () => {
    await setup()
    expect(saveButton()).toBeDisabled()
    select(2, '10:00', '12:00')
    expect(saveButton()).toBeEnabled()
    await removeMode()
    select(2, '10:00', '12:00')
    expect(saveButton()).toBeDisabled()
  })

  test('Save sends merged ranges and the success message stays', async () => {
    await setup()
    select(1, '17:00', '19:00')
    await userEvent.click(saveButton())
    expect(api.put).toHaveBeenCalledWith('/tutor/availability', { slots: [slot(1, '14:00', '19:00'), slot(3, '09:00', '11:00')] })
    expect(await screen.findByText('Your availability has been saved.')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  test('a 409 from the server is shown on the page and the changes are kept', async () => {
    await setup()
    const message = 'Mon 15:00 has a booked lesson. Cancel or reschedule it first.'
    api.put.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 409, data: { message } } }))
    select(2, '10:00', '12:00')
    await userEvent.click(saveButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByText('10:00–12:00')).toBeInTheDocument()
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
    select(2, '10:00', '12:00')
    const notPrevented = fireEvent.click(link)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(notPrevented).toBe(false)
    confirm.mockRestore()
    link.remove()
  })
})
