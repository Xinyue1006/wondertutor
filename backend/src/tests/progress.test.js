// A child's learning progress, built from completed lessons (attendance + summaries come from the Tutor Portal).
import { prisma } from '../config/prisma.js'
import { MONDAY, api, makeBooking, makeChild, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'
import { addDays, mytToDate } from '../utils/time.js'

let parent, tutor
beforeAll(async () => {
  await resetDb()
  await startServer()
  parent = await makeParent()
  tutor = await makeTutor()
  const past = (n, start, extra = {}) =>
    makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: addDays(nextDate(MONDAY), -7 * n), start, status: 'COMPLETED', extra })
  const a = await past(2, '16:00', { teachingMode: 'PHYSICAL', location: 'Kepong' })
  const b = await past(1, '16:00', { teachingMode: 'PHYSICAL', location: 'Kepong' })
  await past(1, '18:00') // online, no attendance (out of scope)
  await prisma.attendance.create({ data: { bookingId: a.id, checkInAt: a.startAt, checkOutAt: a.endAt, checkInPhotoUrl: 'https://res.cloudinary.com/demo/x.jpg' } })
  await prisma.sessionSummary.create({ data: { bookingId: a.id, content: 'Fractions: adding unlike denominators', progressNote: 'Getting faster' } })
  await prisma.sessionSummary.create({ data: { bookingId: b.id, content: 'Word problems' } })
  // not completed: must not count
  await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: nextDate(MONDAY), start: '19:00', status: 'CONFIRMED' })
})
afterAll(stopServer)

describe('learning progress', () => {
  test('totals, per-subject breakdown, attendance (physical lessons only) and the next lesson', async () => {
    const r = await api(parent.token).get(`/parent/children/${parent.child.id}/progress`)
    expect(r.status).toBe(200)
    expect(r.stats).toMatchObject({ completedLessons: 3, totalHours: 3, physicalLessons: 2, checkedInLessons: 1, summariesReceived: 2 })
    expect(r.subjects).toEqual([expect.objectContaining({ subject: 'Mathematics', lessons: 3, hours: 3, tutors: ['Test Tutor'] })])
    expect(r.nextLesson).toMatchObject({ subject: 'Mathematics', tutorName: 'Test Tutor' })
  })

  test('the timeline is newest first and carries the tutor notes and check-in photo', async () => {
    const r = await api(parent.token).get(`/parent/children/${parent.child.id}/progress`)
    const times = r.timeline.map((l) => new Date(l.startAt).getTime())
    expect([...times].sort((x, y) => y - x)).toEqual(times)
    const withPhoto = r.timeline.find((l) => l.attendance)
    expect(withPhoto.summary).toEqual({ content: 'Fractions: adding unlike denominators', progressNote: 'Getting faster' })
    expect(withPhoto.attendance.checkInPhotoUrl).toMatch(/cloudinary/)
  })

  test('a child with no lessons yet gets empty, not broken, progress', async () => {
    const kid = await makeChild(parent.parent.id, { name: 'New' })
    const r = await api(parent.token).get(`/parent/children/${kid.id}/progress`)
    expect(r.stats.completedLessons).toBe(0)
    expect(r.timeline).toEqual([])
    expect(r.nextLesson).toBeNull()
  })

  test("another parent cannot see this child's progress", async () => {
    const other = await makeParent()
    expect((await api(other.token).get(`/parent/children/${parent.child.id}/progress`)).status).toBe(404)
  })
})

describe('signup subject list', () => {
  test('a child subject that is not on the list is rejected at signup', async () => {
    const r = await api().post('/auth/register', {
      role: 'PARENT', fullName: 'Miki Lim', email: 'miki.subject@test.local', phone: '+60123456789', password: 'Parent1234',
      children: [{ name: 'A', educationLevel: 'PRIMARY', grade: 3, subject: 'Underwater basket weaving' }],
    })
    expect(r.status).toBe(400)
  })
})
