// Tutor availability: merging ranges, validation, usual hours and week overrides, the booked-hour lock per scope,
// copying a week, isolation between tutors, and that the parent booking calendar reads the saved hours.
import { prisma } from '../config/prisma.js'
import { effectiveSlotsForDate, normaliseSlots } from '../services/availability.service.js'
import { PAYMENT_DEADLINE_MINUTES } from '../services/lifecycle.service.js'
import { paymentDeadline } from '../services/paymentWindow.js'
import { addDays, mytParts, mytToDate } from '../utils/time.js'
import { currentWeekStart, weekStartOf } from '../utils/week.js'
import { MONDAY, api, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

const TUESDAY = 2
const slot = (dayOfWeek, startTime, endTime, mode = 'BOTH') => ({ dayOfWeek, startTime, endTime, mode })
const put = (token, slots) => api(token).put('/tutor/availability', { slots })
const stored = (tutorId) => prisma.availabilitySlot.findMany({ where: { tutorId }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] })
const plain = (rows) => rows.map(({ dayOfWeek, startTime, endTime, mode }) => slot(dayOfWeek, startTime, endTime, mode))

// The Monday `n` weeks from the current week
const week = (n) => addDays(currentWeekStart(), n * 7)
const putWeek = (token, weekStart, slots) => api(token).put(`/tutor/availability/weeks/${weekStart}`, { slots })
const copy = (token, from, to) => api(token).post('/tutor/availability/weeks/copy', { from, to })
const view = (token, weekStart) => api(token).get(`/tutor/availability?week=${weekStart}`)
const overrides = (tutorId) => prisma.availabilityWeek.count({ where: { tutorId } })

async function book(tutor, date, start = '15:00', status = 'CONFIRMED') {
  const { parent, child } = await makeParent()
  return makeBooking({ parent, child, tutor, date, start, status })
}

describe('normaliseSlots', () => {
  test('joins overlapping and touching ranges on the same day', () => {
    expect(normaliseSlots([slot(1, '14:00', '16:00'), slot(1, '16:00', '18:00')])).toEqual([slot(1, '14:00', '18:00')])
    expect(normaliseSlots([slot(1, '09:00', '12:00'), slot(1, '10:00', '11:00'), slot(1, '11:00', '13:00')])).toEqual([slot(1, '09:00', '13:00')])
  })

  test('sorts unsorted input and keeps gaps and different days apart', () => {
    expect(normaliseSlots([slot(3, '10:00', '11:00'), slot(1, '18:00', '19:00'), slot(1, '09:00', '10:00')]))
      .toEqual([slot(1, '09:00', '10:00'), slot(1, '18:00', '19:00'), slot(3, '10:00', '11:00')])
  })
})

describe('PUT /tutor/availability validation', () => {
  let tutor
  beforeAll(async () => { tutor = await makeTutor() })

  test.each([
    ['minutes other than 00', [slot(1, '14:30', '16:00')], /whole hours between 07:00 and 22:00/],
    ['start after end', [slot(1, '16:00', '14:00')], /whole hours/],
    ['start equal to end', [slot(1, '16:00', '16:00')], /whole hours/],
    ['before the first hour', [slot(1, '06:00', '08:00')], /whole hours/],
    ['after the last hour', [slot(1, '21:00', '23:00')], /whole hours/],
    ['not a time', [slot(1, 'soon', '16:00')], /whole hours/],
    ['day 7', [slot(7, '14:00', '16:00')], /valid day/],
    ['a fractional day', [slot(1.5, '14:00', '16:00')], /valid day/],
    ['extra fields on a row', [{ ...slot(1, '14:00', '16:00'), tutorId: 99 }], /Unrecognized/],
    ['more rows than the limit', Array.from({ length: 106 }, () => slot(1, '14:00', '15:00')), /Too many/],
  ])('rejects %s with a readable message', async (_, slots, message) => {
    const before = await stored(tutor.tutor.id)
    const res = await put(tutor.token, slots)
    expect(res.status).toBe(400)
    expect(res.message).toMatch(message)
    expect(await stored(tutor.tutor.id)).toEqual(before)
  })

  test('rejects extra fields next to slots, and a missing list', async () => {
    expect((await api(tutor.token).put('/tutor/availability', { slots: [], tutorId: 99 })).status).toBe(400)
    expect((await api(tutor.token).put('/tutor/availability', {})).status).toBe(400)
  })
})

describe('saving the schedule', () => {
  test('stores merged ranges and answers in the same shape as GET', async () => {
    const { tutor, token } = await makeTutor()
    const res = await put(token, [slot(1, '16:00', '18:00'), slot(1, '14:00', '16:00')])
    expect(res.status).toBe(200)
    expect(res.usual).toEqual([slot(1, '14:00', '18:00')])
    expect(res.override).toBeNull()
    expect(res.booked).toEqual([])
    expect(res.bounds).toEqual({ start: '07:00', end: '22:00' })
    expect(plain(await stored(tutor.id))).toEqual([slot(1, '14:00', '18:00')])
  })

  test('replaces the previous schedule completely', async () => {
    const { tutor, token } = await makeTutor()
    await put(token, [slot(1, '09:00', '12:00'), slot(5, '09:00', '12:00')])
    await put(token, [slot(2, '10:00', '11:00')])
    expect(plain(await stored(tutor.id))).toEqual([slot(2, '10:00', '11:00')])
  })

  test('an empty schedule is allowed', async () => {
    const { tutor, token } = await makeTutor()
    const res = await put(token, [])
    expect(res.status).toBe(200)
    expect(res.usual).toEqual([])
    expect(await stored(tutor.id)).toEqual([])
  })
})

describe('booked hours', () => {
  const MONDAY_15 = slot(1, '15:00', '16:00')

  async function withBooking(status, date = nextDate(MONDAY)) {
    const t = await makeTutor({ availability: [slot(1, '14:00', '17:00')] })
    const { parent, child } = await makeParent()
    await makeBooking({ parent, child, tutor: t.tutor, date, start: '15:00', status })
    return t
  }

  test('a CONFIRMED booking is listed for its week as BOOKED', async () => {
    const { token } = await withBooking('CONFIRMED')
    const date = nextDate(MONDAY)
    const res = await view(token, date)
    expect(res.booked).toEqual([{ date, startTime: '15:00', dayOfWeek: 1, state: 'BOOKED', teachingMode: 'ONLINE' }])
    expect(res.usual).toEqual([slot(1, '14:00', '17:00')])
  })

  test('a booking is listed only for its own week', async () => {
    const { token } = await withBooking('CONFIRMED')
    expect((await view(token, addDays(nextDate(MONDAY), 7))).booked).toEqual([])
  })

  test('dropping a booked hour from the usual hours returns 409, names the date, and changes nothing', async () => {
    const { tutor, token } = await withBooking('CONFIRMED')
    const res = await put(token, [slot(1, '14:00', '15:00'), slot(1, '16:00', '17:00')])
    expect(res.status).toBe(409)
    expect(res.message).toMatch(new RegExp(`^Mon ${Number(nextDate(MONDAY).slice(8))} [A-Z][a-z]{2}, 15:00 has a booked lesson\\. Cancel or reschedule it first\\.$`))
    expect(plain(await stored(tutor.id))).toEqual([slot(1, '14:00', '17:00')])
  })

  test('a schedule that keeps the booked hour is accepted', async () => {
    const { tutor, token } = await withBooking('CONFIRMED')
    expect((await put(token, [MONDAY_15])).status).toBe(200)
    expect(plain(await stored(tutor.id))).toEqual([MONDAY_15])
  })

  test.each([
    ['a PENDING booking', 'PENDING', () => nextDate(MONDAY)],
    ['a past booking', 'CONFIRMED', () => addDays(nextDate(MONDAY), -28)],
  ])('%s does not lock the hour', async (_, status, date) => {
    const { token } = await withBooking(status, date())
    expect((await view(token, date())).booked).toEqual([])
    expect((await put(token, [])).status).toBe(200)
  })
})

describe('effectiveSlotsForDate', () => {
  const usual = [slot(1, '09:00', '12:00')]

  test('uses the usual hours when the week has no override', async () => {
    const { tutor } = await makeTutor({ availability: usual })
    expect(await effectiveSlotsForDate(tutor.id, week(1))).toEqual(usual)
  })

  test('the override wins for its own week and not for the next', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await putWeek(token, week(2), [slot(1, '14:00', '15:00')])
    expect(await effectiveSlotsForDate(tutor.id, week(2))).toEqual([slot(1, '14:00', '15:00')])
    expect(await effectiveSlotsForDate(tutor.id, week(3))).toEqual(usual)
  })

  test('only the slots of that weekday are returned', async () => {
    const { tutor } = await makeTutor({ availability: [...usual, slot(2, '10:00', '11:00')] })
    expect(await effectiveSlotsForDate(tutor.id, addDays(week(1), 1))).toEqual([slot(2, '10:00', '11:00')])
  })

  test('an override with no hours means nothing that week', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await putWeek(token, week(2), [])
    expect(await overrides(tutor.id)).toBe(1)
    expect(await effectiveSlotsForDate(tutor.id, week(2))).toEqual([])
  })

  test('Sunday belongs to the week that ends on it', async () => {
    const { tutor, token } = await makeTutor({ availability: [slot(0, '09:00', '10:00')] })
    await putWeek(token, week(2), [slot(0, '15:00', '16:00')])
    expect(await effectiveSlotsForDate(tutor.id, addDays(week(2), 6))).toEqual([slot(0, '15:00', '16:00')])
    expect(await effectiveSlotsForDate(tutor.id, addDays(week(2), -1))).toEqual([slot(0, '09:00', '10:00')])
  })
})

describe('week validation', () => {
  let t
  beforeAll(async () => { t = await makeTutor() })

  test.each([
    ['not a Monday', () => addDays(week(1), 1)],
    ['a malformed date', () => 'soon'],
    ['an impossible date', () => '2026-13-40'],
    ['a past week', () => week(-1)],
    ['beyond the horizon', () => week(27)],
  ])('%s is refused', async (_, weekStart) => {
    const saved = await putWeek(t.token, weekStart(), [])
    expect(saved.status).toBe(400)
    expect(saved.message).toBe('Choose a week from this week to 26 weeks ahead')
    expect((await api(t.token).del(`/tutor/availability/weeks/${weekStart()}`)).status).toBe(400)
  })

  test('the current week and the last allowed week are accepted', async () => {
    expect((await putWeek(t.token, week(0), [])).status).toBe(200)
    expect((await putWeek(t.token, week(26), [])).status).toBe(200)
  })

  test('slots follow the same rules as the usual hours', async () => {
    const res = await putWeek(t.token, week(1), [slot(1, '14:30', '16:00')])
    expect(res.status).toBe(400)
    expect(res.message).toMatch(/whole hours/)
    expect((await api(t.token).put(`/tutor/availability/weeks/${week(1)}`, { slots: [], extra: 1 })).status).toBe(400)
  })

  test('the week view snaps any date to its Monday and defaults to the current week', async () => {
    expect((await view(t.token, addDays(week(1), 3))).weekStart).toBe(week(1))
    expect((await api(t.token).get('/tutor/availability')).weekStart).toBe(week(0))
    expect((await api(t.token).get('/tutor/availability?week=soon')).status).toBe(400)
  })

  test('the view reports the weeks that can be opened', async () => {
    const res = await view(t.token, week(1))
    expect(res.limits).toEqual({ first: week(0), last: week(26) })
    expect(weekStartOf(res.limits.last)).toBe(week(26))
  })
})

describe('saving one week', () => {
  const usual = [slot(1, '09:00', '12:00')]

  test('a week that differs from the usual hours is stored and reported as changed', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    const res = await putWeek(token, week(1), [slot(2, '10:00', '11:00'), slot(2, '11:00', '12:00')])
    expect(res.status).toBe(200)
    expect(res.override).toEqual([slot(2, '10:00', '12:00')])
    expect(res.effective).toEqual([slot(2, '10:00', '12:00')])
    expect(res.usual).toEqual(usual)
    expect(res.changedWeeks).toEqual([week(1)])
    expect(await overrides(tutor.id)).toBe(1)
    expect(plain(await stored(tutor.id))).toEqual(usual)
  })

  test('hours equal to the usual ones remove the override', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await putWeek(token, week(1), [])
    const res = await putWeek(token, week(1), usual)
    expect(res.override).toBeNull()
    expect(res.changedWeeks).toEqual([])
    expect(await overrides(tutor.id)).toBe(0)
  })

  test('a second save replaces the first', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await putWeek(token, week(1), [slot(2, '10:00', '11:00')])
    const res = await putWeek(token, week(1), [slot(3, '13:00', '14:00')])
    expect(res.override).toEqual([slot(3, '13:00', '14:00')])
    expect(await overrides(tutor.id)).toBe(1)
    expect(await prisma.availabilityWeekSlot.count({ where: { week: { tutorId: tutor.id } } })).toBe(1)
  })

  test('reset goes back to the usual hours', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await putWeek(token, week(1), [])
    const res = await api(token).del(`/tutor/availability/weeks/${week(1)}`)
    expect(res.status).toBe(200)
    expect(res.override).toBeNull()
    expect(res.effective).toEqual(usual)
    expect(await overrides(tutor.id)).toBe(0)
  })

  test('reset does not fail when the week has no override', async () => {
    const { token } = await makeTutor({ availability: usual })
    expect((await api(token).del(`/tutor/availability/weeks/${week(1)}`)).status).toBe(200)
  })
})

describe('booked-hour lock per scope', () => {
  const usual = [slot(1, '14:00', '17:00')]

  test('a booking blocks removing its hour in its own week, and the message has the date', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await book(tutor, week(1))
    const res = await putWeek(token, week(1), [slot(1, '14:00', '15:00')])
    expect(res.status).toBe(409)
    expect(res.message).toMatch(new RegExp(`^Mon ${Number(week(1).slice(8))} [A-Z][a-z]{2}, 15:00 has a booked lesson`))
    expect(await overrides(tutor.id)).toBe(0)
  })

  test('a booking in another week does not block the change', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await book(tutor, week(1))
    expect((await putWeek(token, week(2), [slot(1, '14:00', '15:00')])).status).toBe(200)
  })

  test('saving the usual hours is blocked by a booking in a week without an override', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await book(tutor, week(1))
    expect((await put(token, [])).status).toBe(409)
    expect(plain(await stored(tutor.id))).toEqual(usual)
  })

  test('saving the usual hours is not blocked by a booking in a week with an override', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await putWeek(token, week(1), [slot(1, '15:00', '16:00')])
    await book(tutor, week(1))
    expect((await put(token, [])).status).toBe(200)
    expect(await stored(tutor.id)).toEqual([])
  })

  test('reset is blocked when the booking is outside the usual hours', async () => {
    const { tutor, token } = await makeTutor({ availability: [slot(1, '09:00', '10:00')] })
    await putWeek(token, week(1), [slot(1, '15:00', '16:00')])
    await book(tutor, week(1))
    const res = await api(token).del(`/tutor/availability/weeks/${week(1)}`)
    expect(res.status).toBe(409)
    expect(await overrides(tutor.id)).toBe(1)
  })

  test('a Sunday 22:00 Malaysia-time booking counts in the week that ends on that Sunday', async () => {
    const { tutor, token } = await makeTutor()
    const sunday = addDays(week(1), 6)
    await book(tutor, sunday, '22:00')
    expect((await view(token, week(1))).booked).toEqual([{ date: sunday, startTime: '22:00', dayOfWeek: 0, state: 'BOOKED', teachingMode: 'ONLINE' }])
    expect((await view(token, week(2))).booked).toEqual([])
  })
})

describe('copying a week', () => {
  const usual = [slot(1, '09:00', '12:00')]
  const special = [slot(3, '13:00', '15:00')]
  const reasonFor = (res, weekStart) => res.skipped.find((s) => s.weekStart === weekStart)?.reason

  test('copies an override to several weeks and leaves the source alone', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await putWeek(token, week(1), special)
    const res = await copy(token, week(1), [week(2), week(3)])
    expect(res.status).toBe(200)
    expect(res.copied).toEqual([week(2), week(3)])
    expect(res.skipped).toEqual([])
    expect((await view(token, week(3))).override).toEqual(special)
    expect((await view(token, week(1))).override).toEqual(special)
    expect(await overrides(tutor.id)).toBe(3)
  })

  test('copying a week on the usual hours creates no override rows', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    const res = await copy(token, week(1), [week(2)])
    expect(res.copied).toEqual([week(2)])
    expect(await overrides(tutor.id)).toBe(0)
  })

  test('a target that had its own hours is replaced', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await putWeek(token, week(2), special)
    await copy(token, week(1), [week(2)]) // week 1 is on the usual hours
    expect((await view(token, week(2))).override).toBeNull()
    expect(await overrides(tutor.id)).toBe(0)
  })

  test('the source, a past week, a week beyond the horizon and a duplicate are skipped with a reason', async () => {
    const { token } = await makeTutor({ availability: usual })
    await putWeek(token, week(1), special)
    const res = await copy(token, week(1), [week(1), week(-1), week(27), week(2), week(2)])
    expect(res.status).toBe(200)
    expect(res.copied).toEqual([week(2)])
    expect(reasonFor(res, week(1))).toBe('This is the week being copied')
    expect(reasonFor(res, week(-1))).toBe('Outside the allowed weeks')
    expect(reasonFor(res, week(27))).toBe('Outside the allowed weeks')
    expect(res.skipped.filter((s) => s.weekStart === week(2)).map((s) => s.reason)).toEqual(['Listed more than once'])
  })

  test('a target whose booked hour would be lost is skipped while the others are saved', async () => {
    const { tutor, token } = await makeTutor({ availability: [slot(1, '14:00', '17:00')] })
    await putWeek(token, week(1), special)
    await book(tutor, week(2))
    const res = await copy(token, week(1), [week(2), week(3)])
    expect(res.copied).toEqual([week(3)])
    expect(reasonFor(res, week(2))).toMatch(new RegExp(`^Mon ${Number(week(2).slice(8))} [A-Z][a-z]{2}, 15:00 has a booked lesson$`))
    expect((await view(token, week(2))).override).toBeNull()
  })

  test('more than 8 targets, or none, is refused', async () => {
    const { token } = await makeTutor({ availability: usual })
    expect((await copy(token, week(1), Array.from({ length: 9 }, (_, i) => week(i + 2)))).status).toBe(400)
    expect((await copy(token, week(1), [])).status).toBe(400)
  })

  test('the source must be an allowed week', async () => {
    const { token } = await makeTutor({ availability: usual })
    expect((await copy(token, addDays(week(1), 1), [week(2)])).status).toBe(400)
    expect((await copy(token, week(-1), [week(2)])).status).toBe(400)
  })
})

describe('teaching mode of a slot', () => {
  const usual = [slot(1, '14:00', '16:00', 'ONLINE'), slot(1, '16:00', '18:00', 'PHYSICAL')]

  test('hours sent without a mode are BOTH', async () => {
    const { token } = await makeTutor()
    const res = await put(token, [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }])
    expect(res.usual).toEqual([slot(1, '09:00', '10:00', 'BOTH')])
  })

  test('touching hours stay apart when the mode differs and join when it is the same', () => {
    expect(normaliseSlots(usual)).toEqual(usual)
    expect(normaliseSlots([slot(1, '14:00', '15:00', 'ONLINE'), slot(1, '15:00', '16:00', 'ONLINE')])).toEqual([slot(1, '14:00', '16:00', 'ONLINE')])
  })

  test('one hour cannot have two modes', async () => {
    const { token } = await makeTutor()
    const res = await put(token, [slot(1, '14:00', '16:00', 'ONLINE'), slot(1, '15:00', '17:00', 'PHYSICAL')])
    expect(res.status).toBe(400)
    expect(res.message).toBe('An hour cannot have two teaching modes')
  })

  test('an unknown mode is refused', async () => {
    const { token } = await makeTutor()
    const res = await put(token, [slot(1, '14:00', '16:00', 'TELEPATHY')])
    expect(res.status).toBe(400)
    expect(res.message).toBe('Choose online, physical or both')
  })

  test('the usual hours keep their modes and the view says what the profile offers', async () => {
    const { tutor, token } = await makeTutor()
    const res = await put(token, usual)
    expect(res.usual).toEqual(usual)
    await prisma.tutorProfile.update({ where: { id: tutor.id }, data: { offersOnline: true, offersPhysical: false } })
    expect((await view(token, week(1))).offers).toEqual({ online: true, physical: false })
  })

  test('a week with the same hours but another mode counts as changed', async () => {
    const { tutor, token } = await makeTutor({ availability: [slot(1, '14:00', '16:00', 'ONLINE')] })
    expect((await putWeek(token, week(1), [slot(1, '14:00', '16:00', 'ONLINE')])).override).toBeNull()
    const res = await putWeek(token, week(1), [slot(1, '14:00', '16:00', 'PHYSICAL')])
    expect(res.override).toEqual([slot(1, '14:00', '16:00', 'PHYSICAL')])
    expect(await overrides(tutor.id)).toBe(1)
  })

  test('copying a week carries the modes', async () => {
    const { token } = await makeTutor()
    await putWeek(token, week(1), usual)
    await copy(token, week(1), [week(2)])
    expect((await view(token, week(2))).override).toEqual(usual)
  })

  test('effectiveSlotsForDate returns the mode', async () => {
    const { tutor, token } = await makeTutor()
    await putWeek(token, week(1), usual)
    expect(await effectiveSlotsForDate(tutor.id, week(1))).toEqual(usual)
  })
})

describe('teaching mode checks', () => {
  const ONLINE_ONLY = { online: true, physical: false }
  const PHYSICAL_ONLY = { online: false, physical: true }
  const HOUR_15 = (mode) => [slot(1, '14:00', '15:00'), slot(1, '15:00', '16:00', mode), slot(1, '16:00', '17:00')]
  const usual = [slot(1, '14:00', '17:00')]
  const bookIn = async (tutor, date, status, teachingMode) => {
    const { parent, child } = await makeParent()
    return makeBooking({ parent, child, tutor, date, start: '15:00', status, extra: { teachingMode } })
  }
  const label = (date) => new RegExp(`^Mon ${Number(date.slice(8))} [A-Z][a-z]{2}, 15:00 `)

  test('an online-only tutor cannot save a physical hour for a week, and nothing is saved', async () => {
    const { tutor, token } = await makeTutor(ONLINE_ONLY)
    const res = await putWeek(token, week(1), [slot(1, '09:00', '10:00', 'PHYSICAL')])
    expect(res.status).toBe(400)
    expect(res.message).toBe('Your profile offers online lessons only')
    expect(await overrides(tutor.id)).toBe(0)
  })

  test.each(['ONLINE', 'BOTH'])('an online-only tutor can save a %s hour for a week', async (mode) => {
    const { token } = await makeTutor(ONLINE_ONLY)
    expect((await putWeek(token, week(1), [slot(1, '09:00', '10:00', mode)])).status).toBe(200)
  })

  test('a physical-only tutor cannot save an online usual hour', async () => {
    const { tutor, token } = await makeTutor({ ...PHYSICAL_ONLY, availability: usual })
    const res = await put(token, [slot(1, '09:00', '10:00', 'ONLINE')])
    expect(res.status).toBe(400)
    expect(res.message).toBe('Your profile offers physical lessons only')
    expect(plain(await stored(tutor.id))).toEqual(usual)
  })

  test.each(['PHYSICAL', 'ONLINE', 'BOTH'])('a tutor offering both can save a %s hour', async (mode) => {
    const { token } = await makeTutor()
    expect((await put(token, [slot(1, '09:00', '10:00', mode)])).status).toBe(200)
  })

  test.each(['PHYSICAL', 'ONLINE', 'BOTH'])('a tutor with neither switched on can save a %s hour', async (mode) => {
    const { token } = await makeTutor({ online: false, physical: false })
    expect((await put(token, [slot(1, '09:00', '10:00', mode)])).status).toBe(200)
  })

  test('a quick add must be a mode the profile offers, and one with no mode is fine', async () => {
    const { token } = await makeTutor(ONLINE_ONLY)
    const preset = { label: 'Evenings', days: [1], from: '17:00', to: '21:00' }
    const refused = await api(token).put('/tutor/availability/quick-add', { presets: [{ ...preset, mode: 'PHYSICAL' }] })
    expect(refused.status).toBe(400)
    expect(refused.message).toBe('Your profile offers online lessons only')
    expect((await api(token).put('/tutor/availability/quick-add', { presets: [preset] })).status).toBe(200)
  })

  test('a paid physical lesson stops its hour becoming online only', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await bookIn(tutor, week(1), 'CONFIRMED', 'PHYSICAL')
    const res = await putWeek(token, week(1), HOUR_15('ONLINE'))
    expect(res.status).toBe(409)
    expect(res.message).toMatch(label(week(1)))
    expect(res.message).toContain('has a booked lesson')
    expect((await putWeek(token, week(1), HOUR_15('PHYSICAL'))).status).toBe(200)
    expect((await putWeek(token, week(1), HOUR_15('BOTH'))).status).toBe(200)
  })

  test('a held online lesson can have its hour opened to both but not made physical only', async () => {
    const { tutor, token } = await makeTutor({ availability: [slot(1, '15:00', '16:00', 'ONLINE')] })
    await bookIn(tutor, week(1), 'AWAITING_PAYMENT', 'ONLINE')
    const res = await putWeek(token, week(1), [slot(1, '15:00', '16:00', 'PHYSICAL')])
    expect(res.status).toBe(409)
    expect(res.message).toContain('is held until a parent pays')
    expect((await putWeek(token, week(1), [slot(1, '15:00', '16:00', 'BOTH')])).status).toBe(200)
  })

  test('the usual hours cannot strand a lesson either', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await bookIn(tutor, week(1), 'CONFIRMED', 'PHYSICAL')
    expect((await put(token, HOUR_15('ONLINE'))).status).toBe(409)
  })

  test('copying skips a week whose lesson the source mode would strand, with the reason', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await bookIn(tutor, week(2), 'CONFIRMED', 'PHYSICAL')
    await putWeek(token, week(1), HOUR_15('ONLINE'))
    const res = await copy(token, week(1), [week(2), week(3)])
    expect(res.copied).toEqual([week(3)])
    expect(res.skipped).toHaveLength(1)
    expect(res.skipped[0].weekStart).toBe(week(2))
    expect(res.skipped[0].reason).toMatch(new RegExp(`^Mon ${Number(week(2).slice(8))} [A-Z][a-z]{2}, 15:00 has a booked lesson$`))
  })

  test('the week view gives each hour its lesson mode', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    await bookIn(tutor, week(1), 'CONFIRMED', 'PHYSICAL')
    expect((await view(token, week(1))).booked[0].teachingMode).toBe('PHYSICAL')
  })
})

describe('quick adds', () => {
  const preset = (over = {}) => ({ label: 'Evenings', days: [1, 3], from: '17:00', to: '21:00', mode: 'ONLINE', ...over })
  const saveQuick = (token, presets) => api(token).put('/tutor/availability/quick-add', { presets })

  test('a tutor starts with none of their own', async () => {
    const { token } = await makeTutor()
    expect((await view(token, week(1))).quickAdd).toBeNull()
  })

  test('saved quick adds come back with the week and belong to that tutor', async () => {
    const { token } = await makeTutor()
    const { token: other } = await makeTutor()
    const res = await saveQuick(token, [preset(), preset({ label: 'Weekend', days: [6, 0], mode: 'BOTH' })])
    expect(res.status).toBe(200)
    expect(res.quickAdd).toHaveLength(2)
    expect((await view(token, week(1))).quickAdd[0]).toEqual(preset())
    expect((await view(other, week(1))).quickAdd).toBeNull()
  })

  test('saving an empty list keeps it empty rather than going back to the built-in ones', async () => {
    const { token } = await makeTutor()
    await saveQuick(token, [])
    expect((await view(token, week(1))).quickAdd).toEqual([])
  })

  test('the name is trimmed', async () => {
    const { token } = await makeTutor()
    expect((await saveQuick(token, [preset({ label: '  Evenings  ' })])).quickAdd[0].label).toBe('Evenings')
  })

  test.each([
    ['a blank name', { label: '   ' }, 'Give the quick add a name'],
    ['a long name', { label: 'x'.repeat(41) }, 'Keep the name to 40 characters'],
    ['no days', { days: [] }, 'Choose at least one day'],
    ['a repeated day', { days: [1, 1] }, 'Choose valid days of the week'],
    ['a day out of range', { days: [7] }, 'Choose valid days of the week'],
    ['a backwards time', { from: '18:00', to: '09:00' }, 'Choose whole hours between 07:00 and 22:00'],
    ['a part hour', { from: '09:30' }, 'Choose whole hours between 07:00 and 22:00'],
    ['an unknown mode', { mode: 'TELEPATHY' }, 'Choose online, physical or both'],
  ])('%s is refused', async (_, over, message) => {
    const { token } = await makeTutor()
    const res = await saveQuick(token, [preset(over)])
    expect(res.status).toBe(400)
    expect(res.message).toBe(message)
  })

  test('at most 8 can be kept', async () => {
    const { token } = await makeTutor()
    expect((await saveQuick(token, Array.from({ length: 8 }, () => preset()))).status).toBe(200)
    const res = await saveQuick(token, Array.from({ length: 9 }, () => preset()))
    expect(res.status).toBe(400)
    expect(res.message).toBe('Keep to 8 quick adds')
  })

  test('saving quick adds does not change the hours', async () => {
    const { tutor, token } = await makeTutor({ availability: [slot(1, '14:00', '17:00')] })
    await saveQuick(token, [preset()])
    expect(plain(await stored(tutor.id))).toEqual([slot(1, '14:00', '17:00')])
  })

  test('a parent cannot save quick adds', async () => {
    const { token } = await makeParent()
    expect((await saveQuick(token, [preset()])).status).toBe(403)
  })
})

describe('held and booked hours', () => {
  const usual = [slot(1, '14:00', '17:00')]
  const heldAt = (hour, payBy) => ({ extra: { payBy }, status: 'AWAITING_PAYMENT', start: hour })

  async function setup(bookings, date = week(1)) {
    const t = await makeTutor({ availability: usual })
    const { parent, child } = await makeParent()
    const made = []
    for (const b of bookings) made.push(await makeBooking({ parent, child, tutor: t.tutor, date, start: '15:00', ...b }))
    return { ...t, made }
  }
  const startOf = (date, time) => mytToDate(date, time)
  const inTheWindow = (date, time) => new Date(startOf(date, time).getTime() - 3 * 3_600_000)
  // The label the service prints: "Mon 23 Nov, 16:00", in Malaysia time
  const labelOf = (instant) => {
    const { date, time, dow } = mytParts(instant)
    const month = new Date(`${date}T00:00:00Z`).toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]} ${Number(date.slice(8))} ${month}, ${time}`
  }
  const heldText = (hourLabel, payBy) => `${hourLabel} is held until a parent pays (by ${labelOf(payBy)})`
  const hour = (date, time) => labelOf(startOf(date, time))

  test('an AWAITING_PAYMENT booking is PENDING_PAYMENT and held until its deadline', async () => {
    const payBy = inTheWindow(week(1), '15:00')
    const { token, made } = await setup([heldAt('15:00', payBy)])
    const [entry] = (await view(token, week(1))).booked
    expect(entry).toEqual({ date: week(1), startTime: '15:00', dayOfWeek: 1, state: 'PENDING_PAYMENT', holdUntil: paymentDeadline(made[0]).toISOString(), teachingMode: 'ONLINE' })
    expect(entry.holdUntil).toBe(payBy.toISOString())
  })

  test('with no payBy the hold ends before the lesson by the old rule', async () => {
    const { token, made } = await setup([heldAt('15:00', null)])
    const [entry] = (await view(token, week(1))).booked
    expect(entry.holdUntil).toBe(new Date(made[0].startAt.getTime() - PAYMENT_DEADLINE_MINUTES * 60_000).toISOString())
  })

  test('a paid lesson wins when two bookings share an hour', async () => {
    const { token } = await setup([heldAt('15:00', inTheWindow(week(1), '15:00')), { status: 'CONFIRMED' }])
    expect((await view(token, week(1))).booked.map((b) => b.state)).toEqual(['BOOKED'])
  })

  test.each(['PENDING', 'COUNTER_OFFERED'])('a %s booking does not hold the hour', async (status) => {
    const { token } = await setup([{ status }])
    expect((await view(token, week(1))).booked).toEqual([])
    expect((await putWeek(token, week(1), [])).status).toBe(200)
  })

  test('a past held booking does not appear', async () => {
    const date = addDays(currentWeekStart(), -7)
    const { token } = await setup([{ status: 'AWAITING_PAYMENT' }], date)
    expect((await view(token, date)).booked).toEqual([])
  })

  test('a held hour blocks saving a week, with the pay-by time', async () => {
    const payBy = inTheWindow(week(1), '15:00')
    const { tutor, token } = await setup([heldAt('15:00', payBy)])
    const res = await putWeek(token, week(1), [slot(1, '14:00', '15:00')])
    expect(res.status).toBe(409)
    expect(res.message).toBe(`${heldText(hour(week(1), '15:00'), payBy)}. It is released if the parent does not pay in time.`)
    expect(await overrides(tutor.id)).toBe(0)
  })

  test('a held hour blocks saving the usual hours', async () => {
    const payBy = inTheWindow(week(1), '15:00')
    const { tutor, token } = await setup([heldAt('15:00', payBy)])
    const res = await put(token, [])
    expect(res.status).toBe(409)
    expect(res.message).toContain(heldText(hour(week(1), '15:00'), payBy))
    expect(plain(await stored(tutor.id))).toEqual(usual)
  })

  test('copying skips a week whose held hour would be lost, with the reason', async () => {
    const payBy = inTheWindow(week(2), '15:00')
    const { token } = await setup([heldAt('15:00', payBy)], week(2))
    await putWeek(token, week(1), [slot(2, '09:00', '10:00')])
    const res = await copy(token, week(1), [week(2), week(3)])
    expect(res.copied).toEqual([week(3)])
    expect(res.skipped).toEqual([{ weekStart: week(2), reason: heldText(hour(week(2), '15:00'), payBy) }])
  })

  test('a booked hour keeps its own wording, and a mix lists both', async () => {
    const payBy = inTheWindow(week(1), '16:00')
    const { token } = await setup([{ status: 'CONFIRMED' }, heldAt('16:00', payBy)])
    const res = await putWeek(token, week(1), [])
    expect(res.status).toBe(409)
    expect(res.message).toBe(`${hour(week(1), '15:00')} has a booked lesson; ${heldText(hour(week(1), '16:00'), payBy)}. Booked lessons must be cancelled or rescheduled first, and held hours are released if the parent does not pay in time.`)
  })

  test('once the booking is cancelled the hour is free and the same save succeeds', async () => {
    const { token, made } = await setup([heldAt('15:00', inTheWindow(week(1), '15:00'))])
    expect((await putWeek(token, week(1), [])).status).toBe(409)
    await prisma.booking.update({ where: { id: made[0].id }, data: { status: 'CANCELLED' } })
    expect((await view(token, week(1))).booked).toEqual([])
    expect((await putWeek(token, week(1), [])).status).toBe(200)
  })
})

describe('access', () => {
  test('each tutor only reads and changes their own schedule', async () => {
    const a = await makeTutor({ availability: [slot(1, '09:00', '10:00')] })
    const b = await makeTutor({ availability: [slot(2, '11:00', '12:00')] })
    expect((await api(a.token).get('/tutor/availability')).usual).toEqual([slot(1, '09:00', '10:00')])
    await put(a.token, [slot(3, '13:00', '14:00')])
    expect(plain(await stored(b.tutor.id))).toEqual([slot(2, '11:00', '12:00')])
  })

  test("one tutor's week changes never reach another tutor", async () => {
    const a = await makeTutor({ availability: [slot(1, '09:00', '10:00')] })
    const b = await makeTutor({ availability: [slot(2, '11:00', '12:00')] })
    await putWeek(b.token, week(1), [slot(4, '09:00', '10:00')])
    await putWeek(a.token, week(1), [])
    await copy(a.token, week(1), [week(2)])
    await api(a.token).del(`/tutor/availability/weeks/${week(1)}`)
    expect((await view(b.token, week(1))).override).toEqual([slot(4, '09:00', '10:00')])
    expect((await view(b.token, week(2))).override).toBeNull()
  })

  test.each([
    ['PUT a week', (t) => api(t).put(`/tutor/availability/weeks/${week(1)}`, { slots: [] })],
    ['DELETE a week', (t) => api(t).del(`/tutor/availability/weeks/${week(1)}`)],
    ['copy a week', (t) => api(t).post('/tutor/availability/weeks/copy', { from: week(1), to: [week(2)] })],
  ])('%s needs a tutor: a visitor gets 401 and a parent 403', async (_, call) => {
    const parent = await makeParent()
    expect((await call(undefined)).status).toBe(401)
    expect((await call(parent.token)).status).toBe(403)
  })

  test('an unverified tutor can use it, a visitor gets 401 and a parent 403', async () => {
    const tutor = await makeTutor()
    const parent = await makeParent()
    expect((await api(tutor.token).get('/tutor/availability')).status).toBe(200)
    expect((await api().get('/tutor/availability')).status).toBe(401)
    expect((await api(parent.token).get('/tutor/availability')).status).toBe(403)
    expect((await api(parent.token).put('/tutor/availability', { slots: [] })).status).toBe(403)
  })
})

describe('parent booking calendar', () => {
  test('offers exactly the hours the tutor saved', async () => {
    const { tutor, token } = await makeTutor()
    const parent = await makeParent()
    await put(token, [slot(TUESDAY, '09:00', '11:00')])

    const res = await api(parent.token).get(`/parent/tutors/${tutor.id}/slots?from=${nextDate(TUESDAY)}`)
    expect(res.status).toBe(200)
    const offered = res.days.flatMap((d) => d.slots.map((s) => [d.dow, s.start, s.end, s.status]))
    expect(offered).toEqual([[TUESDAY, '09:00', '10:00', 'available'], [TUESDAY, '10:00', '11:00', 'available']])
  })
})

describe('one availability rule for parents: date change, then week, then usual hours', () => {
  const usual = [slot(1, '16:00', '18:00')]
  const monday = (n) => week(n)
  const setDate = (token, date, ranges) => api(token).put('/tutor/availability/exceptions', { date, ranges })
  const hoursOn = async (parentToken, tutor, date) =>
    (await api(parentToken).get(`/parent/tutors/${tutor.id}/slots?from=${date}`)).days[0].slots.map((c) => `${c.start} ${c.mode}`)
  const request = (tutor, child, date, startTime, teachingMode) =>
    ({ tutorId: tutor.id, childId: child.id, teachingMode, proposedPrice: 45, slots: [{ date, startTime }],
      ...(teachingMode === 'PHYSICAL' ? { lessonLocation: { address: '12 Jalan Test, Kuala Lumpur', latitude: 3.2, longitude: 101.6, confirmed: true } } : {}) })
  const search = (token, query) => api(token).get(`/parent/tutors?subject=Mathematics&level=PRIMARY&${query}`)
  const found = (res, tutor) => res.tutors.some((t) => t.id === tutor.id)

  test('the parent calendar follows the order, with each hour\'s mode', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    const { token: parentToken } = await makeParent()
    await putWeek(token, monday(2), [slot(1, '09:00', '10:00', 'ONLINE')])
    expect(await hoursOn(parentToken, tutor, monday(2))).toEqual(['09:00 ONLINE'])
    expect(await hoursOn(parentToken, tutor, monday(3))).toEqual(['16:00 BOTH', '17:00 BOTH'])
    expect((await setDate(token, monday(2), [{ startTime: '11:00', endTime: '12:00' }])).status).toBe(200)
    expect(await hoursOn(parentToken, tutor, monday(2))).toEqual(['11:00 BOTH'])
  })

  test('a closed date and a closed week stay closed', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    const { token: parentToken } = await makeParent()
    await putWeek(token, monday(2), [slot(1, '09:00', '10:00')])
    await setDate(token, monday(2), [])
    expect(await hoursOn(parentToken, tutor, monday(2))).toEqual([])
    await putWeek(token, monday(3), [])
    expect(await hoursOn(parentToken, tutor, monday(3))).toEqual([])
  })

  test('booking follows the order and the hour\'s mode', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    const { token: parentToken, child } = await makeParent()
    await putWeek(token, monday(2), [slot(1, '09:00', '10:00', 'ONLINE')])
    const book = (date, time, mode) => api(parentToken).post('/parent/bookings', request(tutor, child, date, time, mode))
    expect((await book(monday(2), '16:00', 'ONLINE')).status).toBe(400) // the week closed it
    const wrongMode = await book(monday(2), '09:00', 'PHYSICAL')
    expect(wrongMode.status).toBe(400)
    expect(wrongMode.message).toBe('This hour is for online lessons only')
    expect((await book(monday(2), '09:00', 'ONLINE')).status).toBe(201)
    await setDate(token, monday(3), [{ startTime: '10:00', endTime: '11:00' }])
    expect((await book(monday(3), '16:00', 'PHYSICAL')).status).toBe(400) // the date change closed it
    expect((await book(monday(3), '10:00', 'PHYSICAL')).status).toBe(201)
  })

  test('accepting a counter-offer checks the hour again, including its mode', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    const { parent, child, token: parentToken } = await makeParent()
    const b = await makeBooking({ parent, child, tutor, date: monday(2), start: '16:00', status: 'COUNTER_OFFERED', extra: { counterPrice: 55, teachingMode: 'PHYSICAL' } })
    await putWeek(token, monday(2), [slot(1, '16:00', '18:00', 'ONLINE')])
    const res = await api(parentToken).post(`/parent/bookings/${b.id}/accept-counter`)
    expect(res.status).toBe(400)
    expect(res.message).toBe('This hour is for online lessons only')
  })

  test('a lesson can only be moved to an hour that allows its mode', async () => {
    const { tutor, token } = await makeTutor({ availability: usual })
    const { parent, child, token: parentToken } = await makeParent()
    const b = await makeBooking({ parent, child, tutor, date: monday(2), start: '16:00', status: 'CONFIRMED', extra: { teachingMode: 'PHYSICAL' } })
    await putWeek(token, monday(3), [slot(1, '09:00', '10:00', 'ONLINE'), slot(1, '10:00', '11:00', 'BOTH')])
    const move = (startTime) => api(parentToken).post(`/parent/bookings/${b.id}/reschedule`, { date: monday(3), startTime, reason: 'Clash with school' })
    const refused = await move('09:00')
    expect(refused.status).toBe(400)
    expect(refused.message).toBe('This hour is for online lessons only')
    expect((await move('10:00')).status).toBe(201)
  })

  test('search by date and time follows the order and the mode', async () => {
    // A Saturday evening far ahead, so other tutors in this file do not fill the page of results
    const { tutor, token } = await makeTutor({ availability: [slot(6, '20:00', '21:00')] })
    const { token: parentToken } = await makeParent()
    const saturday = addDays(week(6), 5)
    await putWeek(token, week(6), [slot(6, '21:00', '22:00', 'ONLINE')])
    const at = (time, mode = '') => search(parentToken, `pageSize=30&date=${saturday}&time=${time}${mode && `&mode=${mode}`}`)
    expect(found(await at('20:00'), tutor)).toBe(false) // the usual hour, closed by the week
    expect(found(await at('21:00'), tutor)).toBe(true)
    expect(found(await at('21:00', 'ONLINE'), tutor)).toBe(true)
    expect(found(await at('21:00', 'PHYSICAL'), tutor)).toBe(false)
  })

  test('the day filter counts the next weeks under the same rule and mode', async () => {
    const { tutor, token } = await makeTutor({ availability: [] })
    const { token: parentToken } = await makeParent()
    const onThursday = (mode = '') => search(parentToken, `pageSize=30&days=4${mode && `&mode=${mode}`}`)
    expect(found(await onThursday(), tutor)).toBe(false)
    await putWeek(token, monday(1), [slot(4, '09:00', '10:00', 'ONLINE')])
    expect(found(await onThursday(), tutor)).toBe(true)
    expect(found(await onThursday('ONLINE'), tutor)).toBe(true)
    expect(found(await onThursday('PHYSICAL'), tutor)).toBe(false)
  })

  test('a lesson on a date with its own change does not lock the week or usual hours', async () => {
    const { tutor, token } = await makeTutor({ availability: [] })
    await setDate(token, monday(1), [{ startTime: '09:00', endTime: '10:00' }])
    const { parent, child } = await makeParent()
    await makeBooking({ parent, child, tutor, date: monday(1), start: '09:00', status: 'CONFIRMED' })
    expect((await putWeek(token, monday(1), [slot(2, '09:00', '10:00')])).status).toBe(200)
    expect((await put(token, [])).status).toBe(200)
  })

  test('removing a date change falls back to that week\'s hours, then the usual hours', async () => {
    const { tutor, token } = await makeTutor({ availability: [] })
    await setDate(token, monday(1), [{ startTime: '09:00', endTime: '10:00' }])
    const { parent, child } = await makeParent()
    await makeBooking({ parent, child, tutor, date: monday(1), start: '09:00', status: 'CONFIRMED' })
    const remove = () => api(token).del(`/tutor/availability/exceptions/${monday(1)}`)
    expect((await remove()).status).toBe(409) // no week or usual hour covers the lesson
    await putWeek(token, monday(1), [slot(1, '09:00', '10:00')])
    expect((await remove()).status).toBe(200)
  })
})
