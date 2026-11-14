// Date-specific hours: input checks, replacing a saved date, and the booking checks on save and restore
import { prisma } from '../config/prisma.js'
import { MONDAY, api, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'
import { addDays, todayMyt } from '../utils/time.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

const endpoint = '/tutor/availability/exceptions'
const save = (t, date, ranges) => api(t.token).put(endpoint, { date, ranges })
const hours = (startTime, endTime) => ({ startTime, endTime })
const gridFor = async (p, t, date) => (await api(p.token).get('/parent/tutors/' + t.tutor.id + '/slots?from=' + date)).days[0].slots.map((s) => s.start)

describe('input checks', () => {
  test('refuses a date in the past', async () => {
    const t = await makeTutor()
    const res = await save(t, addDays(todayMyt(), -1), [])
    expect(res.status).toBe(400)
    expect(res.message).toMatch(/today or a future date/)
  })

  test('accepts today', async () => {
    const t = await makeTutor()
    expect((await save(t, todayMyt(), [])).status).toBe(200)
  })

  test('refuses a badly written date', async () => {
    const t = await makeTutor()
    expect((await save(t, '2026/12/01', [])).status).toBe(400)
    expect((await save(t, 'tomorrow', [])).status).toBe(400)
  })

  test('refuses overlapping ranges', async () => {
    const t = await makeTutor()
    expect((await save(t, nextDate(MONDAY), [hours('09:00', '11:00'), hours('10:00', '12:00')])).status).toBe(400)
  })

  test('accepts ranges that touch end to start', async () => {
    const t = await makeTutor()
    expect((await save(t, nextDate(MONDAY), [hours('09:00', '10:00'), hours('10:00', '11:00')])).status).toBe(200)
  })

  test('refuses half-hour starts and ends', async () => {
    const t = await makeTutor(), date = nextDate(MONDAY)
    expect((await save(t, date, [hours('09:30', '11:00')])).status).toBe(400)
    expect((await save(t, date, [hours('09:00', '10:30')])).status).toBe(400)
  })

  test('refuses a range whose end equals its start', async () => {
    const t = await makeTutor()
    expect((await save(t, nextDate(MONDAY), [hours('09:00', '09:00')])).status).toBe(400)
  })

  test('refuses more than 24 ranges', async () => {
    const t = await makeTutor()
    const many = Array.from({ length: 25 }, () => hours('09:00', '10:00'))
    expect((await save(t, nextDate(MONDAY), many)).status).toBe(400)
  })

  test('refuses a missing ranges list', async () => {
    const t = await makeTutor()
    expect((await api(t.token).put(endpoint, { date: nextDate(MONDAY) })).status).toBe(400)
  })

  test('refuses a badly written date when restoring', async () => {
    const t = await makeTutor()
    expect((await api(t.token).del(endpoint + '/not-a-date')).status).toBe(400)
  })
})

describe('saving and listing', () => {
  test('saving the same date again replaces its hours instead of adding a second row', async () => {
    const t = await makeTutor(), date = nextDate(MONDAY)
    await save(t, date, [hours('09:00', '10:00')])
    await save(t, date, [hours('13:00', '15:00')])
    const { exceptions } = await api(t.token).get(endpoint)
    expect(exceptions).toHaveLength(1)
    expect(exceptions[0].ranges).toEqual([hours('13:00', '15:00')])
  })

  test('lists saved dates from the earliest to the latest', async () => {
    const t = await makeTutor(), first = nextDate(MONDAY)
    await save(t, addDays(first, 14), [])
    await save(t, first, [])
    await save(t, addDays(first, 7), [])
    const dates = (await api(t.token).get(endpoint)).exceptions.map((e) => e.date)
    expect(dates).toEqual([first, addDays(first, 7), addDays(first, 14)])
  })

  test('hours on a day with no usual hours become bookable that date only', async () => {
    const t = await makeTutor(), p = await makeParent(), tuesday = addDays(nextDate(MONDAY), 1)
    await save(t, tuesday, [hours('10:00', '12:00')])
    expect(await gridFor(p, t, tuesday)).toEqual(['10:00', '11:00'])
    expect(await gridFor(p, t, addDays(tuesday, 7))).toEqual([])
  })

  test('narrower hours replace the usual hours for that date', async () => {
    const t = await makeTutor(), p = await makeParent(), date = nextDate(MONDAY)
    await save(t, date, [hours('18:00', '19:00')])
    expect(await gridFor(p, t, date)).toEqual(['18:00'])
  })

  test("restoring one tutor's date does not touch another tutor's saved date", async () => {
    const t = await makeTutor(), other = await makeTutor(), date = nextDate(MONDAY)
    await save(t, date, [])
    await save(other, date, [])
    await api(other.token).del(endpoint + '/' + date)
    expect((await api(t.token).get(endpoint)).exceptions).toHaveLength(1)
  })

  test('only tutors can read or change date-specific hours', async () => {
    const p = await makeParent()
    expect((await api().get(endpoint)).status).toBe(401)
    expect((await api(p.token).get(endpoint)).status).toBe(403)
    expect((await api(p.token).del(endpoint + '/' + nextDate(MONDAY))).status).toBe(403)
  })
})

describe('booked lessons', () => {
  test('new hours that still cover a confirmed lesson can be saved', async () => {
    const t = await makeTutor(), p = await makeParent(), date = nextDate(MONDAY)
    await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start: '17:00', status: 'CONFIRMED' })
    expect((await save(t, date, [hours('17:00', '18:00')])).status).toBe(200)
  })

  test('new hours that leave out a confirmed lesson are refused and nothing is saved', async () => {
    const t = await makeTutor(), p = await makeParent(), date = nextDate(MONDAY)
    await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start: '17:00', status: 'CONFIRMED' })
    const res = await save(t, date, [hours('18:00', '20:00')])
    expect(res.status).toBe(409)
    expect(await prisma.availabilityException.count({ where: { tutorId: t.tutor.id } })).toBe(0)
  })

  test('a cancelled lesson does not block a change', async () => {
    const t = await makeTutor(), p = await makeParent(), date = nextDate(MONDAY)
    await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start: '17:00', status: 'CANCELLED' })
    expect((await save(t, date, [])).status).toBe(200)
  })

  test('restoring weekly hours is refused when a lesson booked on the extra hours would fall outside them', async () => {
    const t = await makeTutor(), p = await makeParent(), tuesday = addDays(nextDate(MONDAY), 1)
    await save(t, tuesday, [hours('10:00', '12:00')])
    await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: tuesday, start: '10:00', status: 'CONFIRMED' })
    expect((await api(t.token).del(endpoint + '/' + tuesday)).status).toBe(409)
    expect((await api(t.token).get(endpoint)).exceptions.map((e) => e.date)).toEqual([tuesday])
  })

  test('restoring weekly hours works when the lesson is inside the usual hours', async () => {
    const t = await makeTutor(), p = await makeParent(), date = nextDate(MONDAY)
    await save(t, date, [hours('17:00', '18:00')])
    await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start: '17:00', status: 'CONFIRMED' })
    expect((await api(t.token).del(endpoint + '/' + date)).status).toBe(200)
    expect((await api(t.token).get(endpoint)).exceptions).toEqual([])
  })
})
