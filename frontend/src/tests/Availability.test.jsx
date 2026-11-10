import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { addDays, dateOfDay, nowInMalaysia, weekLabel, weekStartOf } from '../lib/availability'

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
const slot = (dayOfWeek, startTime, endTime) => ({ dayOfWeek, startTime, endTime })
const LOCK_MESSAGE = 'That change would drop an hour with a booked lesson. Cancel or reschedule the lesson first.'

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
  render(<Availability />)
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
    render(<Availability />)
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
  test('draws the blocks, the booked hour and the weekly total', async () => {
    await setup()
    expect(screen.getByText('14:00–17:00')).toBeInTheDocument()
    expect(screen.getByText('09:00–11:00')).toBeInTheDocument()
    expect(screen.getByText('Booked lesson, locked').parentElement).toHaveAttribute('title', 'Booked lesson on this day. Cancel or reschedule it first.')
    expect(screen.getByText('5 hours a week')).toBeInTheDocument()
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
    expect(screen.getByText('7 hours a week')).toBeInTheDocument()
  })

  test('in Remove mode a selection switches hours off and can split a block', async () => {
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
    expect(screen.queryByText('Booked lesson, locked')).not.toBeInTheDocument()
    expect(screen.getByText('5 hours a week')).toBeInTheDocument()
  })

  test('the booked hours are locked while editing that week', async () => {
    await setup(changed({ booked: [{ date: dateOfDay(WEEK, 2), startTime: '10:00' }] }))
    expect(screen.getByText('Booked lesson, locked')).toBeInTheDocument()
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
    expect(screen.getByText('1 hour a week')).toBeInTheDocument()
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

  test('in This week only they are drawn greyed and have no × button', async () => {
    await setup(data())
    await asWeek()
    expect(screen.queryByRole('button', { name: /^Remove Monday/ })).not.toBeInTheDocument()
    expect(button('Remove Friday 09:00 to 12:00')).toBeInTheDocument()
    const past = calendar.events.filter((e) => e.extendedProps.kind === 'pastBlock')
    expect(past).toHaveLength(1)
    expect(past[0].editable).toBe(false)
  })

  test('in This week only, clearing leaves them as they were', async () => {
    await setup(data())
    await asWeek()
    await userEvent.click(button('Clear all'))
    expect(screen.getByText('3 hours a week')).toBeInTheDocument()
  })

  test('in This week only, adding does not switch them on', async () => {
    await setup(data())
    await asWeek()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tuesday' }))
    await userEvent.selectOptions(screen.getByLabelText('From'), '09:00')
    await userEvent.selectOptions(screen.getByLabelText('To'), '12:00')
    await userEvent.click(button('Add'))
    expect(screen.getByText('6 hours a week')).toBeInTheDocument()
  })

  test('in My usual hours every hour can still be changed', async () => {
    await setup(data())
    expect(calendar.selectAllow(monday)).toBe(true)
    expect(calendar.eventAllow({ start: monday.start }, { start: monday.start })).toBe(true)
    expect(calendar.events.some((e) => e.extendedProps.kind === 'pastBackground')).toBe(false)
    await userEvent.click(button('Remove Monday 09:00 to 12:00'))
    expect(screen.getByText('3 hours a week')).toBeInTheDocument()
  })
})
