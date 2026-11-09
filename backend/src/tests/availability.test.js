// Tutor weekly availability: merging ranges, validation, replacing the schedule, the booked-hour lock,
// isolation between tutors, and that the parent booking calendar reads the saved hours.
import { prisma } from '../config/prisma.js'
import { normaliseSlots } from '../services/availability.service.js'
import { addDays } from '../utils/time.js'
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
    expect(res.slots).toEqual([slot(1, '14:00', '18:00')])
    expect(res.locked).toEqual([])
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
    expect(res.slots).toEqual([])
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

  test.each(['CONFIRMED', 'AWAITING_PAYMENT'])('a %s booking locks the hour in GET', async (status) => {
    const { token } = await withBooking(status)
    const res = await api(token).get('/tutor/availability')
    expect(res.locked).toEqual([{ dayOfWeek: 1, startTime: '15:00' }])
    expect(res.slots).toEqual([slot(1, '14:00', '17:00')])
  })

  test('two bookings in the same weekly hour are listed once', async () => {
    const t = await withBooking('CONFIRMED')
    const { parent, child } = await makeParent()
    await makeBooking({ parent, child, tutor: t.tutor, date: addDays(nextDate(MONDAY), 7), start: '15:00', status: 'CONFIRMED' })
    expect((await api(t.token).get('/tutor/availability')).locked).toHaveLength(1)
  })

  test('dropping a booked hour returns 409, names it, and changes nothing', async () => {
    const { tutor, token } = await withBooking('CONFIRMED')
    const res = await put(token, [slot(1, '14:00', '15:00'), slot(1, '16:00', '17:00')])
    expect(res.status).toBe(409)
    expect(res.message).toBe('Mon 15:00 has a booked lesson. Cancel or reschedule it first.')
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
    expect((await api(token).get('/tutor/availability')).locked).toEqual([])
    expect((await put(token, [])).status).toBe(200)
  })
})

describe('access', () => {
  test('each tutor only reads and changes their own schedule', async () => {
    const a = await makeTutor({ availability: [slot(1, '09:00', '10:00')] })
    const b = await makeTutor({ availability: [slot(2, '11:00', '12:00')] })
    expect((await api(a.token).get('/tutor/availability')).slots).toEqual([slot(1, '09:00', '10:00')])
    await put(a.token, [slot(3, '13:00', '14:00')])
    expect(plain(await stored(b.tutor.id))).toEqual([slot(2, '11:00', '12:00')])
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
