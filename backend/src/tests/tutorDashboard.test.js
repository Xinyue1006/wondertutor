// Tutor home page numbers and the lesson list behind the My students page
import { prisma } from '../config/prisma.js'
import { api, makeBooking, makeChild, makeParent, makeTutor, MONDAY, WEDNESDAY, nextDate, resetDb, startServer, stopServer } from './helpers.js'
import { addDays, todayMyt } from '../utils/time.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)

const lastWeek = () => addDays(todayMyt(), -7)

describe('dashboard', () => {
  test('a new tutor sees zero requests, zero lessons and no rating', async () => {
    const t = await makeTutor()
    const view = await api(t.token).get('/tutor/dashboard')
    expect(view.status).toBe(200)
    expect(view).toMatchObject({ newRequests: 0, upcomingSessions: 0, ratingCount: 0 })
    expect(Number(view.ratingAvg)).toBe(0)
  })

  test('counts only pending requests as new requests', async () => {
    const t = await makeTutor(), p = await makeParent()
    const base = { parent: p.parent, child: p.child, tutor: t.tutor }
    await makeBooking({ ...base, date: nextDate(MONDAY), start: '16:00' })
    await makeBooking({ ...base, date: nextDate(MONDAY), start: '17:00' })
    for (const [start, status] of [['18:00', 'COUNTER_OFFERED'], ['19:00', 'REJECTED']])
      await makeBooking({ ...base, date: nextDate(WEDNESDAY), start, status })
    expect((await api(t.token).get('/tutor/dashboard')).newRequests).toBe(2)
  })

  test('counts confirmed future lessons only, not past, completed or cancelled ones', async () => {
    const t = await makeTutor(), p = await makeParent()
    const base = { parent: p.parent, child: p.child, tutor: t.tutor }
    await makeBooking({ ...base, date: nextDate(MONDAY), status: 'CONFIRMED' })
    await makeBooking({ ...base, date: nextDate(WEDNESDAY), status: 'CONFIRMED' })
    await makeBooking({ ...base, date: lastWeek(), status: 'CONFIRMED' })
    await makeBooking({ ...base, date: lastWeek(), start: '18:00', status: 'COMPLETED' })
    await makeBooking({ ...base, date: nextDate(MONDAY), start: '18:00', status: 'CANCELLED' })
    expect((await api(t.token).get('/tutor/dashboard')).upcomingSessions).toBe(2)
  })

  test("never counts another tutor's bookings", async () => {
    const t = await makeTutor(), other = await makeTutor(), p = await makeParent()
    await makeBooking({ parent: p.parent, child: p.child, tutor: other.tutor, date: nextDate(MONDAY) })
    await makeBooking({ parent: p.parent, child: p.child, tutor: other.tutor, date: nextDate(WEDNESDAY), status: 'CONFIRMED' })
    expect(await api(t.token).get('/tutor/dashboard')).toMatchObject({ newRequests: 0, upcomingSessions: 0 })
  })

  test('shows the saved parent rating', async () => {
    const t = await makeTutor()
    await prisma.tutorProfile.update({ where: { id: t.tutor.id }, data: { ratingAvg: 4.5, ratingCount: 6 } })
    const view = await api(t.token).get('/tutor/dashboard')
    expect(Number(view.ratingAvg)).toBe(4.5)
    expect(view.ratingCount).toBe(6)
  })

  test('only a logged-in tutor can open the dashboard', async () => {
    const p = await makeParent()
    expect((await api().get('/tutor/dashboard')).status).toBe(401)
    expect((await api(p.token).get('/tutor/dashboard')).status).toBe(403)
  })
})

describe('students list', () => {
  test("returns each lesson with the child's id, name, grade and level and no private details", async () => {
    const t = await makeTutor(), p = await makeParent()
    await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: nextDate(MONDAY), status: 'CONFIRMED' })
    const [lesson] = (await api(t.token).get('/tutor/bookings')).bookings
    expect(lesson.child).toEqual({ id: p.child.id, name: 'Sarah', grade: 5, educationLevel: 'PRIMARY' })
    expect(lesson.status).toBe('CONFIRMED')
    expect(lesson.subject).toBe('Mathematics')
  })

  test('keeps two children of the same parent apart', async () => {
    const t = await makeTutor(), p = await makeParent()
    const brother = await makeChild(p.parent.id, { name: 'Adam', grade: 6 })
    await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: nextDate(MONDAY), status: 'CONFIRMED' })
    await makeBooking({ parent: p.parent, child: brother, tutor: t.tutor, date: nextDate(WEDNESDAY), status: 'COMPLETED' })
    const names = (await api(t.token).get('/tutor/bookings')).bookings.map((b) => b.child.name).sort()
    expect(names).toEqual(['Adam', 'Sarah'])
  })

  test('lists lessons from the earliest to the latest', async () => {
    const t = await makeTutor(), p = await makeParent()
    const later = addDays(nextDate(MONDAY), 7)
    await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: later, status: 'CONFIRMED' })
    await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: nextDate(MONDAY), status: 'CONFIRMED' })
    const times = (await api(t.token).get('/tutor/bookings')).bookings.map((b) => new Date(b.startAt).getTime())
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  test("never shows another tutor's students", async () => {
    const t = await makeTutor(), other = await makeTutor(), p = await makeParent()
    await makeBooking({ parent: p.parent, child: p.child, tutor: other.tutor, date: nextDate(MONDAY), status: 'CONFIRMED' })
    expect((await api(t.token).get('/tutor/bookings')).bookings).toEqual([])
  })
})
