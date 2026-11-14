import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { addDays, dateOfDay, malaysiaLabel, nowInMalaysia, weekLabel, weekStartOf } from '../lib/availability'

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
  errorMessage: (e) => e?.response?.data?.message || e.message,
}))

// jsdom has no layout, so FullCalendar cannot draw or drag here. This stand-in renders what the page gives it, keeps
// its props so a test can call select, eventDrop and eventResize, and moves between weeks the way the real one does.
let calendar
let shownDate
vi.mock('@fullcalendar/react', async () => {
  const { useEffect, useImperativeHandle } = await vi.importActual('react')
  const announce = (date) => {
    shownDate = date
    calendar.datesSet({ start: new Date(`${date}T00:00:00Z`) })
  }
  const shift = (days) => {
    const d = new Date(`${shownDate}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    announce(d.toISOString().slice(0, 10))
  }
  return {
    default: function FullCalendarStub({ ref, ...props }) {
      calendar = props
      useImperativeHandle(ref, () => ({
        getApi: () => ({ next: () => shift(7), prev: () => shift(-7), today: () => announce(calendar.validRange.start), gotoDate: announce }),
      }))
      useEffect(() => { announce(props.initialDate) }, []) // eslint-disable-line react-hooks/exhaustive-deps
      return (
        <div>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => <div key={d}>{props.dayHeaderContent({ date: new Date(Date.UTC(2026, 10, 15 + d)) })}</div>)}
          {props.events.map((event, i) => <div key={i}>{props.eventContent({ event })}</div>)}
        </div>
      )
    },
  }
})

import api from '../api/client'
import Availability from '../pages/tutor/Availability'

const bounds = { start: '07:00', end: '22:00' }
const slot = (dayOfWeek, startTime, endTime, mode = 'BOTH') => ({ dayOfWeek, startTime, endTime, mode })
const LOCK_MESSAGE = 'That change would drop a booked or held hour, so it was undone.'

const FIRST = weekStartOf(nowInMalaysia().date)
const LAST = addDays(FIRST, 26 * 7)
const WEEK = addDays(FIRST, 14) // a week with no past hours in it
const USUAL = [slot(1, '14:00', '17:00'), slot(3, '09:00', '11:00')]
const OWN_HOURS = [slot(2, '10:00', '12:00')]

const weekView = (over = {}) => ({
  weekStart: WEEK,
  usual: USUAL,
  override: null,
  effective: USUAL,
  booked: [{ date: WEEK, startTime: '15:00' }],
  changedWeeks: [],
  limits: { first: FIRST, last: LAST },
  bounds,
  ...over,
})
const changed = (over = {}) => weekView({ override: OWN_HOURS, effective: OWN_HOURS, booked: [], changedWeeks: [WEEK], ...over })

// A moment in the week on screen, by dayOfWeek (0 = Sunday, the last day)
const at = (day, time, week = WEEK) => new Date(`${dateOfDay(week, day)}T${time}:00Z`)
const span = (day, from, to) => ({ start: at(day, from), end: at(day, to) })
const select = (day, from, to) => act(() => calendar.select(span(day, from, to)))
const moved = (oldSpan, newSpan) => ({ oldEvent: oldSpan, event: newSpan, revert: vi.fn() })

const button = (name) => screen.getByRole('button', { name })
const expectWeek = (available, booked, held) => expect(screen.getByRole('list', { name: 'Your week' })).toHaveTextContent(`${available} Available${booked} Booked${held} Pending payment`)
const lockedHour = (name) => screen.getByRole('img', { name })
const BOOKED_NAME = /, booked$/
const removeMode = () => userEvent.click(screen.getByRole('radio', { name: 'Remove hours' }))
const usualScope = () => screen.getByRole('radio', { name: 'My usual hours' })
const weekScope = () => screen.getByRole('radio', { name: /^This week only/ })
const asWeek = () => userEvent.click(weekScope())
const requestedWeeks = () => api.get.mock.calls.map(([, config]) => config?.params?.week)

async function setup(data = weekView(), otherWeeks = {}) {
  api.get.mockImplementation((_, config) => {
    const week = config?.params?.week
    return Promise.resolve({ data: week ? { ...data, weekStart: week, booked: [], ...otherWeeks[week] } : data })
  })
  api.put.mockImplementation((url, body) => Promise.resolve({
    data: url.includes('/weeks/') ? { ...data, override: body.slots, effective: body.slots } : { ...data, usual: body.slots, effective: data.override ?? body.slots },
  }))
  api.delete.mockResolvedValue({ data: { ...data, override: null, effective: data.usual, changedWeeks: [] } })
  render(<MemoryRouter><Availability /></MemoryRouter>)
  await screen.findByText('My availability')
}

beforeEach(() => {
  vi.clearAllMocks()
  shownDate = null
})
afterEach(() => vi.useRealTimers())

describe('the week on screen', () => {
  test('the week loads and the title shows its dates', async () => {
    await setup()
    expect(screen.getByRole('heading', { name: weekLabel(WEEK, true) })).toBeInTheDocument()
    expect(calendar.initialDate).toBe(WEEK)
    expect(calendar.timeZone).toBe('UTC')
    expect(calendar.validRange).toEqual({ start: FIRST, end: addDays(LAST, 7) })
    expect(api.get).toHaveBeenCalledTimes(1) // the calendar opening on that week does not load it twice
  })

  test('each row shows its time as a range', async () => {
    await setup()
    expect(calendar.slotLabelContent({ text: '07:00' })).toBe('07:00–08:00')
  })

  test('Next requests the following Monday and Previous goes back', async () => {
    await setup()
    await userEvent.click(button('Next'))
    expect(requestedWeeks()).toContain(addDays(WEEK, 7))
    await screen.findByRole('heading', { name: weekLabel(addDays(WEEK, 7), true) })
    await userEvent.click(button('Previous'))
    await screen.findByRole('heading', { name: weekLabel(WEEK, true) })
  })

  test('Today goes to the current week', async () => {
    await setup()
    await userEvent.click(button('Today'))
    expect(requestedWeeks()).toContain(FIRST)
  })

  test('Previous and Today are disabled on the first week', async () => {
    await setup(weekView({ weekStart: FIRST, booked: [] }))
    expect(button('Previous')).toBeDisabled()
    expect(button('Today')).toBeDisabled()
    expect(button('Next')).toBeEnabled()
  })

  test('Next is disabled on the last week', async () => {
    await setup(weekView({ weekStart: LAST, booked: [] }))
    expect(button('Next')).toBeDisabled()
    expect(button('Previous')).toBeEnabled()
  })

  test('a load failure offers Try again', async () => {
    api.get.mockRejectedValueOnce(new Error('Server is down'))
    api.get.mockResolvedValueOnce({ data: weekView() })
    render(<MemoryRouter><Availability /></MemoryRouter>)
    expect(await screen.findByText('Server is down')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByText('My availability')).toBeInTheDocument()
  })

  test('the changed-week chips jump to that week', async () => {
    const later = addDays(WEEK, 14)
    await setup(weekView({ changedWeeks: [later] }))
    await userEvent.click(button(weekLabel(later)))
    expect(requestedWeeks()).toContain(later)
    await screen.findByRole('heading', { name: weekLabel(later, true) })
  })
})

describe('what is being edited', () => {
  test('a week with no override opens on the usual hours', async () => {
    await setup()
    expect(usualScope()).toBeChecked()
    expect(screen.getByText('Your usual hours')).toBeInTheDocument()
    expect(button('Save usual hours')).toBeDisabled()
    expect(screen.getByText('Adding to: my usual hours')).toBeInTheDocument()
  })

  test('a week with an override opens on that week', async () => {
    await setup(changed())
    expect(weekScope()).toBeChecked()
    expect(screen.getByText('Changed for this week')).toBeInTheDocument()
    expect(button('Save this week')).toBeDisabled()
    expect(screen.getByText('Adding to: this week only')).toBeInTheDocument()
    expect(screen.getByText('10:00–12:00')).toBeInTheDocument()
  })

  test('the scope label names the week', async () => {
    await setup()
    expect(screen.getByRole('radio', { name: `This week only (${weekLabel(WEEK)})` })).toBeInTheDocument()
  })

  test('switching scope shows the other set of hours', async () => {
    await setup(changed())
    await userEvent.click(usualScope())
    expect(screen.getByText('14:00–17:00')).toBeInTheDocument()
    expect(screen.queryByText('10:00–12:00')).not.toBeInTheDocument()
  })

  test('Save usual hours sends the usual hours', async () => {
    await setup()
    select(1, '17:00', '19:00')
    await userEvent.click(button('Save usual hours'))
    expect(api.put).toHaveBeenCalledWith('/tutor/availability', { slots: [slot(1, '14:00', '19:00'), slot(3, '09:00', '11:00')] }, { params: { week: WEEK } })
    expect(await screen.findByText('Your usual hours have been saved.')).toBeInTheDocument()
    expect(button('Save usual hours')).toBeDisabled()
  })

  test('after saving the usual hours, the weeks that kept their own hours are named', async () => {
    const later = '2026-12-07'
    await setup(weekView({ changedWeeks: [later] }))
    select(2, '10:00', '11:00')
    await userEvent.click(button('Save usual hours'))
    expect(await screen.findByText(/These weeks have their own hours and were not changed: 7 Dec\./)).toBeInTheDocument()
  })

  test('Save this week sends that week', async () => {
    await setup()
    await asWeek()
    select(2, '10:00', '12:00')
    await userEvent.click(button('Save this week'))
    expect(api.put).toHaveBeenCalledWith(`/tutor/availability/weeks/${WEEK}`, { slots: [slot(1, '14:00', '17:00'), slot(2, '10:00', '12:00'), slot(3, '09:00', '11:00')] })
    expect(await screen.findByText('This week has been saved.')).toBeInTheDocument()
  })

  test('Reset is offered only when the week has an override', async () => {
    await setup()
    await asWeek()
    expect(screen.queryByRole('button', { name: 'Reset this week to my usual hours' })).not.toBeInTheDocument()
  })

  test('Reset asks first, then goes back to the usual hours', async () => {
    await setup(changed())
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await userEvent.click(button('Reset this week to my usual hours'))
    expect(api.delete).not.toHaveBeenCalled()
    confirm.mockReturnValue(true)
    await userEvent.click(button('Reset this week to my usual hours'))
    expect(api.delete).toHaveBeenCalledWith(`/tutor/availability/weeks/${WEEK}`)
    expect(await screen.findByText('This week is back to your usual hours.')).toBeInTheDocument()
    expect(screen.getByText('Your usual hours')).toBeInTheDocument()
    confirm.mockRestore()
  })

  test('the empty note depends on what is being edited', async () => {
    await setup(weekView({ usual: [], effective: [], booked: [] }))
    expect(screen.getByText("Parents can't book you until you add hours.")).toBeInTheDocument()
    await asWeek()
    expect(screen.getByText("Parents can't book you this week.")).toBeInTheDocument()
  })
})

describe('unsaved changes', () => {
  let confirm
  beforeEach(() => { confirm = vi.spyOn(window, 'confirm').mockReturnValue(false) })
  afterEach(() => confirm.mockRestore())

  test('changing week asks first and Cancel keeps the edits', async () => {
    await setup()
    select(2, '10:00', '12:00')
    api.get.mockClear()
    await userEvent.click(button('Next'))
    expect(confirm).toHaveBeenCalledWith('Discard your unsaved changes?')
    expect(api.get).not.toHaveBeenCalled()
    expect(screen.getByText('10:00–12:00')).toBeInTheDocument()
  })

  test('changing week after agreeing to discard loads the new week', async () => {
    confirm.mockReturnValue(true)
    await setup()
    select(2, '10:00', '12:00')
    await userEvent.click(button('Next'))
    expect(requestedWeeks()).toContain(addDays(WEEK, 7))
    await waitFor(() => expect(screen.queryByText('10:00–12:00')).not.toBeInTheDocument())
  })

  test('changing scope asks first and Cancel keeps the edits', async () => {
    await setup()
    select(2, '10:00', '12:00')
    await asWeek()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(usualScope()).toBeChecked()
    expect(screen.getByText('10:00–12:00')).toBeInTheDocument()
  })

  test('nothing asks when there are no changes', async () => {
    await setup()
    await userEvent.click(button('Next'))
    await asWeek()
    expect(confirm).not.toHaveBeenCalled()
  })

  test('Save is disabled until something changes, and again if the change is undone', async () => {
    await setup()
    expect(button('Save usual hours')).toBeDisabled()
    select(2, '10:00', '12:00')
    expect(button('Save usual hours')).toBeEnabled()
    await removeMode()
    select(2, '10:00', '12:00')
    expect(button('Save usual hours')).toBeDisabled()
  })

  test('leaving through a link with unsaved changes asks first', async () => {
    await setup()
    const link = document.body.appendChild(Object.assign(document.createElement('a'), { href: '/tutor/earnings' }))
    fireEvent.click(link)
    expect(confirm).not.toHaveBeenCalled() // nothing unsaved yet
    select(2, '10:00', '12:00')
    const notPrevented = fireEvent.click(link)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(notPrevented).toBe(false)
    link.remove()
  })
})

describe('copying this week', () => {
  const openDialog = async () => {
    await userEvent.click(button('Copy this week to…'))
    return screen.findByRole('dialog')
  }
  const ticked = (dialog) => within(dialog).getAllByRole('checkbox').filter((c) => c.checked).length

  test('the button is only there when editing this week', async () => {
    await setup()
    expect(screen.queryByRole('button', { name: 'Copy this week to…' })).not.toBeInTheDocument()
    await asWeek()
    expect(button('Copy this week to…')).toBeEnabled()
  })

  test('the button is disabled with unsaved changes', async () => {
    await setup(changed())
    select(2, '14:00', '15:00')
    expect(button('Copy this week to…')).toBeDisabled()
    expect(button('Copy this week to…')).toHaveAttribute('title', 'Save this week first')
  })

  test('the dialog lists the next 8 weeks and marks the ones that will be replaced', async () => {
    const soon = addDays(WEEK, 14)
    await setup(changed({ changedWeeks: [WEEK, soon] }))
    const dialog = await openDialog()
    const boxes = within(dialog).getAllByRole('checkbox')
    expect(boxes).toHaveLength(8)
    await waitFor(() => expect(boxes[0]).toHaveFocus())
    expect(within(dialog).getAllByText('will be replaced')).toHaveLength(1)
    expect(within(dialog).getByRole('checkbox', { name: `${weekLabel(soon)} will be replaced` })).toBeInTheDocument()
  })

  test('the list stops at the last week that can be edited', async () => {
    await setup(changed({ weekStart: addDays(LAST, -14), changedWeeks: [] }))
    const dialog = await openDialog()
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(2)
  })

  test('the quick choices tick 4 or 8 weeks', async () => {
    await setup(changed())
    const dialog = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next 4 weeks' }))
    expect(ticked(dialog)).toBe(4)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next 8 weeks' }))
    expect(ticked(dialog)).toBe(8)
  })

  test('Copy needs at least one week', async () => {
    await setup(changed())
    const dialog = await openDialog()
    expect(within(dialog).getByRole('button', { name: 'Copy' })).toBeDisabled()
  })

  test('Escape closes the dialog', async () => {
    await setup(changed())
    await openDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  test('confirming sends the copy and shows the copied and skipped weeks with reasons', async () => {
    const [one, two] = [addDays(WEEK, 7), addDays(WEEK, 14)]
    api.post.mockResolvedValue({ data: { copied: [one], skipped: [{ weekStart: two, reason: 'Mon 7 Dec, 15:00 has a booked lesson' }] } })
    await setup(changed())
    const dialog = await openDialog()
    const boxes = within(dialog).getAllByRole('checkbox')
    await userEvent.click(boxes[0])
    await userEvent.click(boxes[1])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy' }))
    expect(api.post).toHaveBeenCalledWith('/tutor/availability/weeks/copy', { from: WEEK, to: [one, two] })
    expect(await screen.findByText(`Copied to: ${weekLabel(one)}.`)).toBeInTheDocument()
    expect(screen.getByText(/Mon 7 Dec, 15:00 has a booked lesson/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('editing the hours', () => {
  test('draws the blocks, the booked hour and the week summary', async () => {
    await setup()
    expect(screen.getByText('14:00–17:00')).toBeInTheDocument()
    expect(screen.getByText('09:00–11:00')).toBeInTheDocument()
    expect(lockedHour(BOOKED_NAME)).toHaveAttribute('title', 'Booked lesson. Cancel or reschedule it first.')
    expectWeek(4, 1, 0)
  })

  test('events sit on the real dates of the week', async () => {
    await setup()
    expect(calendar.events[0].start).toBe(`${dateOfDay(WEEK, 1)}T14:00:00`)
  })

  test('a selection must stay inside one day', async () => {
    await setup()
    expect(calendar.selectAllow(span(2, '09:00', '11:00'))).toBe(true)
    expect(calendar.selectAllow({ start: at(2, '21:00'), end: at(3, '07:00') })).toBe(false)
  })

  test('in Add mode a selection switches those hours on', async () => {
    await setup()
    select(2, '10:00', '12:00')
    expect(screen.getByText('10:00–12:00')).toBeInTheDocument()
    expectWeek(6, 1, 0)
  })

  test('in Remove mode a selection switches hours off and can split a block', async () => {
    await setup()
    await removeMode()
    select(3, '09:00', '10:00')
    expect(screen.getByText('10:00–11:00')).toBeInTheDocument()
    expectWeek(3, 1, 0)
  })

  test('Remove mode never removes a booked hour', async () => {
    await setup()
    await removeMode()
    select(1, '14:00', '17:00')
    expect(screen.getByText('15:00–16:00')).toBeInTheDocument()
    expectWeek(2, 1, 0)
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
  })

  test('a move that drops a booked hour is reverted and explained', async () => {
    await setup()
    const info = moved(span(1, '14:00', '17:00'), span(2, '14:00', '17:00'))
    act(() => calendar.eventDrop(info))
    expect(info.revert).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alert')).toHaveTextContent(LOCK_MESSAGE)
    expect(button('Save usual hours')).toBeDisabled()
  })

  test('the booked hours of a week with an override do not lock the usual hours', async () => {
    await setup(changed({ booked: [{ date: dateOfDay(WEEK, 2), startTime: '10:00' }] }))
    await userEvent.click(usualScope())
    expect(screen.queryByRole('img', { name: BOOKED_NAME })).not.toBeInTheDocument()
    expectWeek(5, 0, 0)
  })

  test('the booked hours are locked while editing that week', async () => {
    await setup(changed({ booked: [{ date: dateOfDay(WEEK, 2), startTime: '10:00' }] }))
    expect(lockedHour(BOOKED_NAME)).toBeInTheDocument()
    await userEvent.click(button('Clear all'))
    expect(screen.getByText('10:00–11:00')).toBeInTheDocument()
  })

  test('the × button removes a block', async () => {
    await setup()
    await userEvent.click(button('Remove Wednesday 09:00 to 11:00'))
    expect(screen.queryByText('09:00–11:00')).not.toBeInTheDocument()
  })

  test('the × button on a block with a booked hour keeps that hour', async () => {
    await setup()
    await userEvent.click(button('Remove Monday 14:00 to 17:00'))
    expect(screen.getByText('15:00–16:00')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  test('Add many hours at once switches on the chosen hours and leaves the others', async () => {
    await setup()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }))
    await userEvent.selectOptions(screen.getByLabelText('From'), '09:00')
    await userEvent.selectOptions(screen.getByLabelText('To'), '12:00')
    await userEvent.click(button('Add'))
    expect(screen.getByText('09:00–12:00')).toBeInTheDocument()
    expect(screen.getByText('14:00–17:00')).toBeInTheDocument()
  })

  test('Add explains a missing day and a backwards time range', async () => {
    await setup()
    await userEvent.click(button('Add'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one day.')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Monday' }))
    await userEvent.selectOptions(screen.getByLabelText('From'), '18:00')
    await userEvent.selectOptions(screen.getByLabelText('To'), '09:00')
    await userEvent.click(button('Add'))
    expect(await screen.findByRole('alert')).toHaveTextContent('The end time must be later than the start time.')
  })

  test('a preset adds its hours', async () => {
    await setup()
    await userEvent.click(button('Weekends 09:00–17:00'))
    expect(screen.getAllByText('09:00–17:00')).toHaveLength(2)
  })

  test('Clear this day and Clear all leave the booked hour on', async () => {
    await setup()
    await userEvent.click(button('Clear Monday'))
    expect(screen.getByText('15:00–16:00')).toBeInTheDocument()
    expect(screen.getByText('09:00–11:00')).toBeInTheDocument()
    await userEvent.click(button('Clear all'))
    expectWeek(0, 1, 0)
  })

  test('a 409 is shown on the page and the changes are kept', async () => {
    await setup()
    const message = 'Mon 23 Nov, 15:00 has a booked lesson. Cancel or reschedule it first.'
    api.put.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 409, data: { message } } }))
    select(2, '10:00', '12:00')
    await userEvent.click(button('Save usual hours'))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByText('10:00–12:00')).toBeInTheDocument()
    expect(button('Save usual hours')).toBeEnabled()
  })
})

describe('hours that have already passed', () => {
  const THIS_WEEK = '2026-11-16'
  const data = () => weekView({ weekStart: THIS_WEEK, usual: [slot(1, '09:00', '12:00'), slot(5, '09:00', '12:00')], effective: [slot(1, '09:00', '12:00'), slot(5, '09:00', '12:00')], booked: [], limits: { first: THIS_WEEK, last: '2027-05-17' } })
  const monday = { start: new Date('2026-11-16T09:00:00Z'), end: new Date('2026-11-16T10:00:00Z') }
  const friday = { start: new Date('2026-11-20T09:00:00Z'), end: new Date('2026-11-20T10:00:00Z') }

  // Wednesday 18 Nov, 14:30 in Malaysia. Only the clock is fixed; timers stay real for the page to load.
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-18T06:30:00Z') }))

  test('in This week only they cannot be selected or moved', async () => {
    await setup(data())
    await asWeek()
    expect(calendar.selectAllow(monday)).toBe(false)
    expect(calendar.selectAllow(friday)).toBe(true)
    expect(calendar.eventAllow({ start: monday.start }, { start: friday.start })).toBe(false)
    expect(calendar.eventAllow({ start: friday.start }, { start: monday.start })).toBe(false)
    expect(calendar.eventAllow({ start: friday.start }, { start: friday.start })).toBe(true)
  })

  test('in This week only they are drawn as passed and have no × button', async () => {
    await setup(data())
    await asWeek()
    expect(screen.queryByRole('button', { name: /^Remove Monday/ })).not.toBeInTheDocument()
    expect(button('Remove Friday 09:00 to 12:00')).toBeInTheDocument()
    const past = calendar.events.filter((e) => e.extendedProps.kind === 'passed')
    expect(past.length).toBeGreaterThan(0)
    expect(past.every((e) => e.display === 'background' && e.classNames.includes('fc-passed'))).toBe(true)
    expect(screen.getByRole('img', { name: /^Monday 16 Nov 07:00 to 22:00, passed$/ })).toHaveAttribute('title', 'Already passed')
  })

  test('the passed hours follow the clock while the page stays open', async () => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date('2026-11-18T05:59:00Z') }) // 13:59 in Malaysia
    const hours = [slot(3, '14:00', '15:00')]
    await setup({ ...data(), usual: hours, effective: hours })
    await asWeek()
    const passedUntil = (end) => screen.queryByRole('img', { name: `Wednesday 18 Nov 07:00 to ${end}, passed` })
    expect(passedUntil('14:00')).toBeInTheDocument()
    expect(screen.getByText('14:00–15:00')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    expect(passedUntil('15:00')).toBeInTheDocument()
    expect(passedUntil('14:00')).not.toBeInTheDocument()
    expect(screen.queryByText('14:00–15:00')).not.toBeInTheDocument()
  })

  test('in This week only, clearing leaves them as they were', async () => {
    await setup(data())
    await asWeek()
    await userEvent.click(button('Clear all'))
    expectWeek(0, 0, 0)
    await userEvent.click(button('Save this week'))
    expect(api.put.mock.calls[0][1].slots).toEqual([slot(1, '09:00', '12:00')])
  })

  test('in This week only, adding does not switch them on', async () => {
    await setup(data())
    await asWeek()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }))
    await userEvent.selectOptions(screen.getByLabelText('From'), '09:00')
    await userEvent.selectOptions(screen.getByLabelText('To'), '12:00')
    await userEvent.click(button('Add'))
    expectWeek(3, 0, 0) // only Friday: the past Tuesday hours stay off
  })

  test('in My usual hours every hour can still be changed', async () => {
    await setup(data())
    expect(calendar.selectAllow(monday)).toBe(true)
    expect(calendar.eventAllow({ start: monday.start }, { start: monday.start })).toBe(true)
    expect(calendar.events.some((e) => e.extendedProps.kind === 'passed')).toBe(false)
    await userEvent.click(button('Remove Monday 09:00 to 12:00'))
    expectWeek(3, 0, 0)
  })
})

describe('teaching mode of a slot', () => {
  const pick = (name) => userEvent.click(screen.getByRole('radio', { name }))
  const both = { online: true, physical: true }
  const saved = () => api.put.mock.calls[0][1].slots
  const noBooked = (over = {}) => weekView({ booked: [], offers: both, ...over })

  test('new hours take the chosen mode and are saved with it', async () => {
    await setup(noBooked())
    await pick('Online')
    select(2, '10:00', '12:00')
    await userEvent.click(button('Save usual hours'))
    expect(saved()).toContainEqual(slot(2, '10:00', '12:00', 'ONLINE'))
    expect(saved()).toContainEqual(slot(1, '14:00', '17:00', 'BOTH'))
  })

  test('the mode is written on the block', async () => {
    await setup(noBooked({ usual: [slot(1, '14:00', '15:00', 'PHYSICAL')], effective: [slot(1, '14:00', '15:00', 'PHYSICAL')] }))
    expect(screen.getByText('Physical', { selector: 'span' })).toBeInTheDocument()
  })

  test('hours of different modes are separate blocks', async () => {
    await setup(noBooked())
    await pick('Online')
    select(1, '17:00', '19:00')
    expect(screen.getByText('14:00–17:00')).toBeInTheDocument()
    expect(screen.getByText('17:00–19:00')).toBeInTheDocument()
  })

  test('there is no Change mode option', async () => {
    await setup(noBooked())
    expect(within(screen.getByRole('radiogroup', { name: 'What dragging does' })).getAllByRole('radio')).toHaveLength(2)
  })

  test('adding existing hours again changes their mode and counts as unsaved', async () => {
    await setup(noBooked())
    await pick('Physical')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Monday' }))
    await userEvent.selectOptions(screen.getByLabelText('From'), '14:00')
    await userEvent.selectOptions(screen.getByLabelText('To'), '15:00')
    await userEvent.click(button('Add'))
    expect(screen.getByText('15:00–17:00')).toBeInTheDocument()
    expectWeek(5, 0, 0)
    await userEvent.click(button('Save usual hours'))
    expect(saved()).toContainEqual(slot(1, '14:00', '15:00', 'PHYSICAL'))
  })

  test('adding over a booked hour leaves its mode alone', async () => {
    await setup(weekView({ offers: both }))
    await pick('Online')
    select(1, '14:00', '17:00')
    await userEvent.click(button('Save usual hours'))
    expect(saved()).toEqual(expect.arrayContaining([slot(1, '14:00', '15:00', 'ONLINE'), slot(1, '15:00', '16:00', 'BOTH'), slot(1, '16:00', '17:00', 'ONLINE')]))
  })

  test('Add many hours at once uses the chosen mode', async () => {
    await setup(noBooked())
    await pick('Online')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }))
    await userEvent.selectOptions(screen.getByLabelText('From'), '09:00')
    await userEvent.selectOptions(screen.getByLabelText('To'), '12:00')
    await userEvent.click(button('Add'))
    await userEvent.click(button('Save usual hours'))
    expect(saved()).toContainEqual(slot(2, '09:00', '12:00', 'ONLINE'))
  })

  test('a moved block keeps its mode', async () => {
    const hours = [slot(3, '09:00', '11:00', 'ONLINE')]
    await setup(noBooked({ usual: hours, effective: hours }))
    await pick('Physical')
    act(() => calendar.eventDrop(moved(span(3, '09:00', '11:00'), span(5, '13:00', '15:00'))))
    await userEvent.click(button('Save usual hours'))
    expect(saved()).toEqual([slot(5, '13:00', '15:00', 'ONLINE')])
  })

  test('a tutor who offers one mode has no choice to make', async () => {
    await setup(noBooked({ offers: { online: false, physical: true } }))
    expect(screen.getByText(/\(set in My Profile\)/)).toHaveTextContent('Teaching mode: Physical (set in My Profile)')
    expect(screen.queryByRole('radio', { name: 'Both' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Physical', { selector: 'span' }).length).toBeGreaterThan(0)
  })
})

describe('quick adds', () => {
  const both = { online: true, physical: true }
  const own = (over = {}) => ({ label: 'Evenings', days: [2, 4], from: '17:00', to: '19:00', mode: 'ONLINE', ...over })
  const data = (quickAdd, over = {}) => weekView({ booked: [], offers: both, quickAdd, ...over })
  const answerQuickAdd = () => api.put.mockImplementation((_, body) => Promise.resolve({ data: { quickAdd: body.presets } }))
  const sent = () => api.put.mock.calls.at(-1)[1].presets
  const choose = async (day, from, to) => {
    await userEvent.click(screen.getByRole('checkbox', { name: day }))
    await userEvent.selectOptions(screen.getByLabelText('From'), from)
    await userEvent.selectOptions(screen.getByLabelText('To'), to)
  }
  const nameIt = (text) => userEvent.type(screen.getByLabelText('Quick add name'), text)

  test('a tutor with none saved sees the built-in ones', async () => {
    await setup(data(null))
    expect(button('Weekday evenings 17:00–21:00')).toBeInTheDocument()
    expect(button('Weekends 09:00–17:00')).toBeInTheDocument()
  })

  test('saved ones replace the built-in ones and show their details', async () => {
    await setup(data([own()]))
    expect(button('Evenings')).toHaveTextContent('Tue, Thu · 17:00–19:00 · Online')
    expect(screen.queryByRole('button', { name: 'Weekends 09:00–17:00' })).not.toBeInTheDocument()
  })

  test('an empty list says so', async () => {
    await setup(data([]))
    expect(screen.getByText(/No quick adds yet/)).toBeInTheDocument()
  })

  test('using one adds its hours with its own mode, whatever mode is chosen above', async () => {
    await setup(data([own()]))
    await userEvent.click(screen.getByRole('radio', { name: 'Physical' }))
    await userEvent.click(button('Evenings'))
    await userEvent.click(button('Save usual hours'))
    expect(api.put.mock.calls[0][1].slots).toContainEqual(slot(2, '17:00', '19:00', 'ONLINE'))
  })

  test('a built-in one uses the mode chosen above', async () => {
    await setup(data(null))
    await userEvent.click(screen.getByRole('radio', { name: 'Physical' }))
    await userEvent.click(button('Weekends 09:00–17:00'))
    await userEvent.click(button('Save usual hours'))
    expect(api.put.mock.calls[0][1].slots).toContainEqual(slot(6, '09:00', '17:00', 'PHYSICAL'))
  })

  test('a saved mode the profile no longer offers falls back to the chosen one', async () => {
    await setup(data([own()], { offers: { online: false, physical: true } }))
    await userEvent.click(button('Evenings'))
    await userEvent.click(button('Save usual hours'))
    expect(api.put.mock.calls[0][1].slots).toContainEqual(slot(2, '17:00', '19:00', 'PHYSICAL'))
  })

  test('saving a new one sends the chosen days, times and mode and shows it', async () => {
    await setup(data([own()]))
    answerQuickAdd()
    await userEvent.click(screen.getByRole('radio', { name: 'Physical' }))
    await choose('Saturday', '09:00', '12:00')
    await userEvent.click(button('Save as a quick add'))
    await nameIt('Saturday class')
    await userEvent.click(button('Save quick add'))
    expect(api.put).toHaveBeenCalledWith('/tutor/availability/quick-add', { presets: expect.any(Array) })
    expect(sent()).toEqual([own(), { label: 'Saturday class', days: [6], from: '09:00', to: '12:00', mode: 'PHYSICAL' }])
    expect(await screen.findByRole('button', { name: 'Saturday class' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Quick add name')).not.toBeInTheDocument()
  })

  test('a name, a day and a valid time are needed', async () => {
    await setup(data([]))
    await userEvent.click(button('Save as a quick add'))
    await userEvent.click(button('Save quick add'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at least one day.')
    await choose('Monday', '09:00', '12:00')
    await userEvent.click(button('Save quick add'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the quick add a name.')
    expect(api.put).not.toHaveBeenCalled()
  })

  test('editing loads it into the fields and replaces it', async () => {
    await setup(data([own(), own({ label: 'Other' })]))
    answerQuickAdd()
    await userEvent.click(button('Edit Evenings'))
    expect(screen.getByRole('checkbox', { name: 'Tuesday' })).toBeChecked()
    expect(screen.getByLabelText('From')).toHaveValue('17:00')
    expect(screen.getByRole('radio', { name: 'Online' })).toBeChecked()
    expect(screen.getByLabelText('Quick add name')).toHaveValue('Evenings')
    await userEvent.selectOptions(screen.getByLabelText('To'), '21:00')
    await userEvent.click(button('Update quick add'))
    expect(sent()).toEqual([own({ to: '21:00' }), own({ label: 'Other' })])
  })

  test('a built-in one can be edited, which keeps the other one', async () => {
    await setup(data(null))
    answerQuickAdd()
    await userEvent.click(button('Edit Weekends 09:00–17:00'))
    await userEvent.clear(screen.getByLabelText('Quick add name'))
    await nameIt('Weekends')
    await userEvent.click(button('Update quick add'))
    expect(sent().map((p) => p.label)).toEqual(['Weekday evenings 17:00–21:00', 'Weekends'])
  })

  test('deleting asks first', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    await setup(data([own(), own({ label: 'Other' })]))
    answerQuickAdd()
    await userEvent.click(button('Delete Evenings'))
    expect(api.put).not.toHaveBeenCalled()
    await userEvent.click(button('Delete Evenings'))
    expect(sent()).toEqual([own({ label: 'Other' })])
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Evenings' })).not.toBeInTheDocument())
    confirm.mockRestore()
  })

  test('saving one leaves unsaved hours on the calendar', async () => {
    await setup(data([own()]))
    select(5, '10:00', '12:00')
    answerQuickAdd()
    await userEvent.click(button('Edit Evenings'))
    await userEvent.click(button('Update quick add'))
    await waitFor(() => expect(screen.queryByLabelText('Quick add name')).not.toBeInTheDocument())
    expect(screen.getByText('10:00–12:00')).toBeInTheDocument()
    expect(button('Save usual hours')).toBeEnabled()
  })

  test('a server error is shown and the form stays open', async () => {
    await setup(data([own()]))
    api.put.mockRejectedValueOnce(new Error('Keep to 8 quick adds'))
    await userEvent.click(button('Edit Evenings'))
    await userEvent.click(button('Update quick add'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Keep to 8 quick adds')
    expect(screen.getByLabelText('Quick add name')).toBeInTheDocument()
  })

  test('at the limit no new one can be saved', async () => {
    await setup(data(Array.from({ length: 8 }, (_, i) => own({ label: `Set ${i}` }))))
    expect(screen.queryByRole('button', { name: 'Save as a quick add' })).not.toBeInTheDocument()
    expect(screen.getByText(/the most you can keep/)).toBeInTheDocument()
  })
})

describe('slot states', () => {
  const HOLD_UNTIL = '2026-11-30T08:00:00.000Z' // Mon 30 Nov, 16:00 in Malaysia
  const bookedHour = () => ({ date: WEEK, startTime: '15:00', dayOfWeek: 1, state: 'BOOKED' })
  const heldHour = () => ({ date: dateOfDay(WEEK, 3), startTime: '09:00', dayOfWeek: 3, state: 'PENDING_PAYMENT', holdUntil: HOLD_UNTIL })
  const mixed = () => weekView({ booked: [bookedHour(), heldHour()] })
  const HELD_NAME = /, pending payment$/
  const kinds = (name) => calendar.events.filter((e) => e.classNames?.includes(name))

  test('booked and held hours have their own classes, icons, tooltips and names', async () => {
    await setup(mixed())
    expect(kinds('fc-booked')).toHaveLength(1)
    expect(kinds('fc-held')).toHaveLength(1)
    expect(lockedHour(`Monday ${Number(WEEK.slice(8))} ${weekLabel(WEEK).split(' ').at(-1)} 15:00, booked`)).toBeInTheDocument()
    const held = lockedHour(HELD_NAME)
    expect(held).toHaveAttribute('title', `Held until ${malaysiaLabel(HOLD_UNTIL)} while the parent pays. It is released if they don't.`)
    expect(held.querySelector('svg')).toBeInTheDocument()
    expectWeek(3, 1, 1)
  })

  test('the legend has the five states', async () => {
    await setup(mixed())
    const items = within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual(['Available', 'Booked', 'Pending payment', 'Passed', 'Not available'])
  })

  test('Clear all keeps both kinds', async () => {
    await setup(mixed())
    await userEvent.click(button('Clear all'))
    expectWeek(0, 1, 1)
    expect(screen.getByText('15:00–16:00')).toBeInTheDocument()
    expect(screen.getByText('09:00–10:00')).toBeInTheDocument()
  })

  test('a 409 about a held hour is shown as it is', async () => {
    await setup(mixed())
    const message = 'Wed 2 Dec, 09:00 is held until a parent pays (by Mon 30 Nov, 16:00). It is released if the parent does not pay in time.'
    api.put.mockRejectedValueOnce(Object.assign(new Error('x'), { response: { status: 409, data: { message } } }))
    select(2, '10:00', '12:00')
    await userEvent.click(button('Save usual hours'))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  describe('re-reading the week', () => {
    const answerWith = (booked) => api.get.mockResolvedValue({ data: weekView({ booked }) })
    const tick = () => act(() => vi.advanceTimersByTimeAsync(60_000))
    const reloads = () => api.get.mock.calls.length
    // The timer starts just after the page paints, so let that finish first
    const settle = () => act(() => new Promise((resolve) => { setTimeout(resolve, 20) }))
    const open = async (data) => {
      await setup(data)
      await settle()
    }

    beforeEach(() => vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] }))

    test('after 60 seconds a held hour turns free without touching unsaved hours', async () => {
      await open(mixed())
      select(2, '10:00', '12:00')
      expectWeek(5, 1, 1)
      answerWith([bookedHour()])
      await tick()
      expect(screen.queryByRole('img', { name: HELD_NAME })).not.toBeInTheDocument()
      expect(screen.getByText('10:00–12:00')).toBeInTheDocument()
      expectWeek(6, 1, 0)
      expect(button('Save usual hours')).toBeEnabled() // the added hours are still unsaved
    })

    test('a held hour that is paid turns booked', async () => {
      await open(mixed())
      answerWith([bookedHour(), { ...heldHour(), state: 'BOOKED', holdUntil: undefined }])
      await tick()
      expect(screen.queryByRole('img', { name: HELD_NAME })).not.toBeInTheDocument()
      expectWeek(3, 2, 0)
    })

    test('a newly held hour becomes locked and adds nothing to the unsaved changes', async () => {
      await open(weekView({ booked: [bookedHour()] }))
      answerWith([bookedHour(), heldHour()])
      await tick()
      expect(lockedHour(HELD_NAME)).toBeInTheDocument()
      expect(button('Save usual hours')).toBeDisabled()
    })

    test('the page also re-reads when the window regains focus', async () => {
      await open(mixed())
      const before = reloads()
      await act(async () => { window.dispatchEvent(new Event('focus')) })
      expect(reloads()).toBe(before + 1)
    })

    test('nothing is re-read while a save is running', async () => {
      await open(mixed())
      select(2, '10:00', '12:00')
      let finish
      api.put.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      await userEvent.click(button('Save usual hours'))
      await settle()
      const before = reloads()
      await tick()
      expect(reloads()).toBe(before)
      await act(async () => { finish({ data: mixed() }) })
    })

    test('the timer stops when the page closes', async () => {
      await open(mixed())
      cleanup()
      const before = reloads()
      await tick()
      expect(reloads()).toBe(before)
    })
  })
})

describe('availability integration safeguards', () => {
  test.each(['usual', 'week'])('a lesson controlled by a date exception never adds hours to the %s pattern', async (scope) => {
    const hours = [slot(2, '14:00', '15:00')]
    await setup(weekView({ usual: hours, effective: hours, booked: [
      { date: WEEK, startTime: '09:00', state: 'BOOKED', affectsUsual: false, affectsWeek: false },
    ] }))
    if (scope === 'week') await asWeek()
    expect(screen.queryByRole('img', { name: BOOKED_NAME })).not.toBeInTheDocument()
    expect(screen.queryByText('09:00–10:00')).not.toBeInTheDocument()
    select(2, '15:00', '16:00')
    await userEvent.click(button(scope === 'week' ? 'Save this week' : 'Save usual hours'))
    expect(api.put.mock.calls[0][1].slots).toEqual([slot(2, '14:00', '16:00')])
  })

  test('editing and navigation are frozen while saving, so the response cannot discard later edits', async () => {
    await setup(weekView({ booked: [] }))
    select(2, '10:00', '12:00')
    let finish
    api.put.mockImplementationOnce((_, body) => new Promise((resolve) => {
      finish = () => resolve({ data: weekView({ booked: [], usual: body.slots, effective: body.slots }) })
    }))
    await userEvent.click(button('Save usual hours'))
    expect(button('Clear all')).toBeDisabled()
    expect(button('Next')).toBeDisabled()
    expect(weekScope()).toBeDisabled()
    expect(button('Add')).toBeDisabled()
    expect(calendar.selectable).toBe(false)
    expect(calendar.editable).toBe(false)
    select(5, '14:00', '15:00')
    const move = moved(span(2, '10:00', '12:00'), span(5, '14:00', '16:00'))
    act(() => calendar.eventDrop(move))
    expect(move.revert).toHaveBeenCalledOnce()
    expect(screen.queryByText('14:00–15:00')).not.toBeInTheDocument()
    await act(async () => finish())
    expect(screen.getByText('10:00–12:00')).toBeInTheDocument()
    expect(button('Save usual hours')).toBeDisabled()
    expect(button('Next')).toBeEnabled()
  })
})

test('the saved parent view identifies date hours and opens that date for editing', async () => {
  const date = addDays(WEEK, 1)
  await setup(changed({ parentDays: [{ date, source: 'date', slots: [{ start: '09:00', end: '10:00', mode: 'ONLINE' }] }] }))
  fireEvent.click(screen.getByText('What parents can book'))
  expect(screen.getByText('09:00–10:00 (Online)')).toBeVisible()
  expect(screen.getByRole('link', { name: /^Edit Tuesday/ })).toHaveAttribute('href', '/tutor/availability/dates?date=' + date)
})
