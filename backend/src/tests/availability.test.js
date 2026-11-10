// Tutor availability: merging ranges, validation, usual hours and week overrides, the booked-hour lock per scope,
// copying a week, isolation between tutors, and that the parent booking calendar reads the saved hours.
import { prisma } from '../config/prisma.js'
import { effectiveSlotsForDate, normaliseSlots } from '../services/availability.service.js'
import { addDays } from '../utils/time.js'
import { currentWeekStart, weekStartOf } from '../utils/week.js'
import { MONDAY, api, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

const TUESDAY = 2
const slot = (dayOfWeek, startTime, endTime) => ({ dayOfWeek, startTime, endTime })
const put = (token, slots) => api(token).put('/tutor/availability', { slots })
const stored = (tutorId) => prisma.availabilitySlot.findMany({ where: { tutorId }, orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] })
const plain = (rows) => rows.map(({ dayOfWeek, startTime, endTime }) => slot(dayOfWeek, startTime, endTime))

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

  test.each(['CONFIRMED', 'AWAITING_PAYMENT'])('a %s booking is listed as booked for its week', async (status) => {
    const { token } = await withBooking(status)
    const date = nextDate(MONDAY)
    const res = await view(token, date)
    expect(res.booked).toEqual([{ date, startTime: '15:00' }])
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
    expect((await view(token, week(1))).booked).toEqual([{ date: sunday, startTime: '22:00' }])
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
