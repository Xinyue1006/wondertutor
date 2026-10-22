// "Add to calendar": the .ics file must be valid, escape what people typed, stay inside the 75-byte line rule and
// only ever contain the logged-in parent's own confirmed lessons.
import { prisma } from '../config/prisma.js'
import { buildCalendar, icsEscape, icsFold, icsTime } from '../services/calendar.service.js'
import { MONDAY, api, apiBase, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

describe('calendar file format', () => {
  test('times are written in UTC', () => {
    expect(icsTime('2026-10-22T10:00:00.000+08:00')).toBe('20261022T020000Z')
  })

  test('commas, semicolons, backslashes and new lines are escaped', () => {
    expect(icsEscape('Maths, Science; a\\b\nnext')).toBe('Maths\\, Science\\; a\\\\b\\nnext')
  })

  test('long lines are folded at 75 bytes and never cut a character in half', () => {
    const long = `SUMMARY:${'陈小明'.repeat(30)}`
    const folded = icsFold(long)
    for (const line of folded.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
    // unfolding (removing CRLF + one space) gives back the original text
    expect(folded.replace(/\r\n /g, '')).toBe(long)
  })

  test('a calendar has the required parts and one event per lesson', () => {
    const b = (id, mode) => ({
      id, startAt: new Date('2026-10-22T02:00:00Z'), endAt: new Date('2026-10-22T03:00:00Z'), updatedAt: new Date('2026-10-20T00:00:00Z'),
      subject: 'Mathematics', isTrial: false, teachingMode: mode, location: 'Kepong, Kuala Lumpur', meetingLink: 'https://meet.example.com/abc',
      child: { name: 'Sarah, Jr' }, tutor: { user: { fullName: 'Ms. Tan' } },
    })
    const ics = buildCalendar([b(1, 'PHYSICAL'), b(2, 'ONLINE')], { baseUrl: 'https://wondertutor.example' })
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain('UID:booking-1@wondertutor')
    expect(ics).toContain('DTSTART:20261022T020000Z')
    expect(ics).toContain('DTEND:20261022T030000Z')
    expect(ics).toContain('SUMMARY:Sarah\\, Jr: Mathematics with Ms. Tan')
    expect(ics).toContain('LOCATION:Kepong\\, Kuala Lumpur') // physical lesson: the address
    expect(ics).toContain('LOCATION:https://meet.example.com/abc') // online lesson: the meeting link
    expect(ics).toContain('URL:https://wondertutor.example/parent/bookings?booking=1')
    expect(ics).toContain('TRIGGER:-PT1H')
    expect(ics).not.toMatch(/[^\r]\n/) // every line break is CRLF
  })
})

describe('calendar download', () => {
  let parent, other, tutor, monday
  beforeAll(async () => {
    parent = await makeParent()
    other = await makeParent()
    tutor = await makeTutor()
    monday = nextDate(MONDAY)
  })
  const book = (p, status, start) => makeBooking({ parent: p.parent, child: p.child, tutor: tutor.tutor, date: monday, start, status })
  const download = async (token, path) => fetch(`${apiBase()}${path}`, { headers: { Authorization: `Bearer ${token}` } })

  test('a confirmed lesson downloads as a calendar file', async () => {
    const b = await book(parent, 'CONFIRMED', '16:00')
    const res = await download(parent.token, `/parent/bookings/${b.id}/calendar.ics`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/calendar')
    expect(res.headers.get('content-disposition')).toContain(`wondertutor-lesson-${b.id}.ics`)
    const text = await res.text()
    expect(text).toContain(`UID:booking-${b.id}@wondertutor`)
    expect(text).toContain('Sarah: Mathematics with Test Tutor')
  })

  test('a request that is not confirmed yet cannot be added', async () => {
    const b = await book(parent, 'PENDING', '17:00')
    expect((await download(parent.token, `/parent/bookings/${b.id}/calendar.ics`)).status).toBe(400)
  })

  test("another parent cannot download someone else's lesson", async () => {
    const b = await book(parent, 'CONFIRMED', '18:00')
    expect((await download(other.token, `/parent/bookings/${b.id}/calendar.ics`)).status).toBe(404)
  })

  test('the all-lessons file holds only my own confirmed lessons that have not started', async () => {
    const mine = await book(parent, 'CONFIRMED', '19:00')
    const theirs = await book(other, 'CONFIRMED', '19:00')
    const past = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: '2026-01-05', start: '16:00', status: 'CONFIRMED' })
    const text = await (await download(parent.token, '/parent/bookings/calendar.ics')).text()
    expect(text).toContain(`UID:booking-${mine.id}@wondertutor`)
    expect(text).not.toContain(`UID:booking-${theirs.id}@wondertutor`)
    expect(text).not.toContain(`UID:booking-${past.id}@wondertutor`)
  })

  test('with no confirmed lessons the answer says so', async () => {
    const empty = await makeParent()
    const res = await api(empty.token).get('/parent/bookings/calendar.ics')
    expect(res.status).toBe(404)
    expect(res.message).toContain('no confirmed upcoming lessons')
  })

  test('a link is needed to download', async () => {
    const res = await fetch(`${apiBase()}/parent/bookings/calendar.ics`)
    expect(res.status).toBe(401)
  })
})
