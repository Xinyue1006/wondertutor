// Homework and follow-up work on lesson summaries, and the child's progress report (history over a period).
import { prisma } from '../config/prisma.js'
import { MONDAY, api, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

let parent, other, tutor, monday

beforeAll(async () => {
  await resetDb()
  await startServer()
  parent = await makeParent()
  other = await makeParent()
  tutor = await makeTutor()
  monday = nextDate(MONDAY)
})
afterAll(stopServer)

// A completed lesson on a chosen day (Malaysia time), with an optional tutor summary and attendance
let slot = 0
async function lesson({ day, subject = 'Mathematics', mode = 'PHYSICAL', summary, checkedIn = false, rating } = {}) {
  const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: monday, start: `${16 + (slot++ % 4)}:00`, status: 'COMPLETED', price: 50 })
  const startAt = new Date(`${day}T10:00:00+08:00`)
  await prisma.booking.update({ where: { id: b.id }, data: { subject, teachingMode: mode, startAt, endAt: new Date(startAt.getTime() + 3600_000) } })
  if (summary) await prisma.sessionSummary.create({ data: { bookingId: b.id, ...summary } })
  if (checkedIn) await prisma.attendance.create({ data: { bookingId: b.id, checkInAt: startAt } })
  if (rating) await prisma.review.create({ data: { bookingId: b.id, parentId: parent.parent.id, tutorId: tutor.tutor.id, rating } })
  return b
}

describe('homework and follow-up work', () => {
  test('the progress page shows topics, observations, homework and recommendations from the tutor', async () => {
    const p = await makeParent()
    const t = await makeTutor()
    const b = await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: monday, start: '17:00', status: 'COMPLETED' })
    await prisma.sessionSummary.create({
      data: { bookingId: b.id, content: 'Worked on fractions.', progressNote: 'Quick with halves, slower with thirds.', topics: 'Fractions', homework: 'Page 12, questions 1-10', recommendations: 'Daily 10-minute practice' },
    })
    const res = await api(p.token).get(`/parent/children/${p.child.id}/progress`)
    expect(res.status).toBe(200)
    expect(res.timeline[0].summary).toEqual({
      content: 'Worked on fractions.', progressNote: 'Quick with halves, slower with thirds.', topics: 'Fractions', homework: 'Page 12, questions 1-10', recommendations: 'Daily 10-minute practice',
    })
  })

  test('older summaries without the new parts still load, with those parts empty', async () => {
    const p = await makeParent()
    const t = await makeTutor()
    const b = await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: monday, start: '18:00', status: 'COMPLETED' })
    await prisma.sessionSummary.create({ data: { bookingId: b.id, content: 'Revision.' } })
    const res = await api(p.token).get(`/parent/children/${p.child.id}/progress`)
    expect(res.timeline[0].summary).toMatchObject({ content: 'Revision.', homework: null, topics: null, recommendations: null })
  })
})

describe('the progress report', () => {
  beforeAll(async () => {
    await lesson({ day: '2026-01-12', subject: 'Mathematics', summary: { content: 'Fractions.', topics: 'Fractions', homework: 'Page 3', progressNote: 'Good' }, checkedIn: true, rating: 5 })
    await lesson({ day: '2026-03-02', subject: 'Mathematics', summary: { content: 'Decimals.', topics: 'Decimals' }, checkedIn: false, rating: 3 })
    await lesson({ day: '2026-03-20', subject: 'English', mode: 'ONLINE', summary: { content: 'Comprehension.', homework: 'Read chapter 4' } })
    await lesson({ day: '2026-06-01', subject: 'Mathematics' }) // no summary yet
  })
  const report = (query = '', token = parent.token) => api(token).get(`/parent/children/${parent.child.id}/report${query}`)

  test('covers every completed lesson, newest first, with totals and a line per subject', async () => {
    const r = await report()
    expect(r.status).toBe(200)
    expect(r.child.name).toBe('Sarah')
    expect(r.parentName).toBe('Test Parent')
    expect(r.lessons.map((l) => l.startAt.slice(0, 10))).toEqual(['2026-06-01', '2026-03-20', '2026-03-02', '2026-01-12'])
    expect(r.totals).toMatchObject({ lessons: 4, hours: 4, tutors: 1, summaries: 3, homeworkSet: 2, physicalLessons: 3, checkedIn: 1, averageRating: 4 })
    expect(r.subjects).toEqual([
      { subject: 'Mathematics', lessons: 3, hours: 3, tutors: expect.any(Array) },
      { subject: 'English', lessons: 1, hours: 1, tutors: expect.any(Array) },
    ])
    expect(r.subjectsAvailable).toEqual(['English', 'Mathematics'])
  })

  test('shows the tutor’s notes per lesson, and attendance only for physical lessons', async () => {
    const r = await report()
    const online = r.lessons.find((l) => l.subject === 'English')
    expect(online.attended).toBeNull() // online lessons have no attendance record
    expect(online.summary.homework).toBe('Read chapter 4')
    const jan = r.lessons.find((l) => l.startAt.startsWith('2026-01-12'))
    expect([jan.attended, jan.summary.topics, jan.summary.homework]).toEqual([true, 'Fractions', 'Page 3'])
    expect(r.lessons.find((l) => l.startAt.startsWith('2026-06-01')).summary).toBeNull()
  })

  test('a period includes both end days, and can be limited to one subject', async () => {
    const march = await report('?from=2026-03-02&to=2026-03-20')
    expect(march.lessons).toHaveLength(2)
    expect(march.totals.lessons).toBe(2)
    const maths = await report('?subject=Mathematics&from=2026-01-01&to=2026-03-31')
    expect(maths.lessons.map((l) => l.subject)).toEqual(['Mathematics', 'Mathematics'])
    expect(maths.period).toEqual({ from: '2026-01-01', to: '2026-03-31', subject: 'Mathematics' })
    expect((await report('?from=2027-01-01')).totals.lessons).toBe(0) // an empty period is a report with zeros, not an error
  })

  test('a lesson near midnight belongs to its Malaysian day', async () => {
    const p = await makeParent()
    const t = await makeTutor()
    const b = await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: monday, start: '17:00', status: 'COMPLETED' })
    await prisma.booking.update({ where: { id: b.id }, data: { startAt: new Date('2026-05-10T23:30:00+08:00'), endAt: new Date('2026-05-11T00:30:00+08:00') } })
    const r = await api(p.token).get(`/parent/children/${p.child.id}/report?from=2026-05-10&to=2026-05-10`)
    expect(r.totals.lessons).toBe(1)
    expect((await api(p.token).get(`/parent/children/${p.child.id}/report?from=2026-05-11&to=2026-05-11`)).totals.lessons).toBe(0)
  })

  test('bad dates are refused, and only the child’s own parent can open it', async () => {
    expect((await report('?from=2026-13-45')).status).toBe(400)
    const back = await report('?from=2026-06-01&to=2026-01-01')
    expect(back.status).toBe(400)
    expect(back.message).toContain('start date')
    expect((await report('', other.token)).status).toBe(404)
    expect((await report('', null)).status).toBe(401)
  })

  test('lessons that were not completed do not appear', async () => {
    const p = await makeParent()
    const t = await makeTutor()
    await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: monday, start: '17:00', status: 'CONFIRMED' })
    expect((await api(p.token).get(`/parent/children/${p.child.id}/report`)).lessons).toEqual([])
  })
})
