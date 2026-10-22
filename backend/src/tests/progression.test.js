// Automatic education-level progression: every child moves up one grade when a new school year (1 January, Malaysia time) starts.
import { prisma } from '../config/prisma.js'
import { advanceBy, currentSchoolYear, gradeName, nextGrade, promoteChildren } from '../services/progression.service.js'
import { api, makeChild, makeParent, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

const JAN_2027 = new Date('2027-01-01T01:00:00+08:00')
const DEC_2026 = new Date('2026-12-31T23:30:00+08:00') // still 2026 in Malaysia

describe('the grade ladder', () => {
  test('one year later, inside a level and across levels', () => {
    expect(nextGrade({ level: 'KINDERGARTEN', grade: 1 })).toEqual({ level: 'KINDERGARTEN', grade: 2 })
    expect(nextGrade({ level: 'KINDERGARTEN', grade: 3 })).toEqual({ level: 'PRIMARY', grade: 1 })
    expect(nextGrade({ level: 'PRIMARY', grade: 5 })).toEqual({ level: 'PRIMARY', grade: 6 })
    expect(nextGrade({ level: 'PRIMARY', grade: 6 })).toEqual({ level: 'SECONDARY', grade: 1 })
    expect(nextGrade({ level: 'SECONDARY', grade: 4 })).toEqual({ level: 'SECONDARY', grade: 5 })
  })

  test('there is nothing after Form 5', () => {
    expect(nextGrade({ level: 'SECONDARY', grade: 5 })).toBeNull()
    expect(advanceBy({ level: 'SECONDARY', grade: 5 }, 3)).toEqual({ level: 'SECONDARY', grade: 5, finished: true })
  })

  test('several missed years are added up (the server was off on 1 January)', () => {
    expect(advanceBy({ level: 'PRIMARY', grade: 5 }, 3)).toEqual({ level: 'SECONDARY', grade: 2, finished: false })
    expect(advanceBy({ level: 'KINDERGARTEN', grade: 2 }, 0)).toEqual({ level: 'KINDERGARTEN', grade: 2, finished: false })
  })

  test('readable names use Form for secondary school', () => {
    expect(gradeName('SECONDARY', 3)).toBe('Form 3')
    expect(gradeName('PRIMARY', 1)).toBe('Primary 1')
    expect(gradeName('KINDERGARTEN', 2)).toBe('Kindergarten 2')
  })

  test('the school year is the Malaysian calendar year', () => {
    expect(currentSchoolYear(DEC_2026)).toBe(2026)
    expect(currentSchoolYear(JAN_2027)).toBe(2027)
    expect(currentSchoolYear(new Date('2026-12-31T20:00:00Z'))).toBe(2027) // already 1 January in Kuala Lumpur
  })
})

describe('moving the children up', () => {
  test('a child is moved up on 1 January, notified once, and not moved again the same year', async () => {
    const p = await makeParent({ child: { educationLevel: 'PRIMARY', grade: 5, gradeYear: 2026 } })
    expect((await promoteChildren(DEC_2026)).moved).toBe(0)
    expect((await prisma.child.findUnique({ where: { id: p.child.id } })).grade).toBe(5)

    await promoteChildren(JAN_2027)
    const child = await prisma.child.findUnique({ where: { id: p.child.id } })
    expect([child.educationLevel, child.grade, child.gradeYear]).toEqual(['PRIMARY', 6, 2027])

    await promoteChildren(JAN_2027)
    await promoteChildren(new Date('2027-06-15T10:00:00+08:00'))
    expect((await prisma.child.findUnique({ where: { id: p.child.id } })).grade).toBe(6)
    const notes = await prisma.notification.findMany({ where: { userId: p.user.id, type: 'CHILD_PROMOTED' } })
    expect(notes).toHaveLength(1)
    expect(notes[0].title).toBe('Sarah moved up to Primary 6')
    expect(notes[0].message).toContain('My Children')
  })

  test('Primary 6 becomes Form 1, and the subjects are kept', async () => {
    const p = await makeParent({ child: { educationLevel: 'PRIMARY', grade: 6, gradeYear: 2026, subject: 'Science', subjects: ['Science', 'Mathematics'] } })
    await promoteChildren(JAN_2027)
    const child = await prisma.child.findUnique({ where: { id: p.child.id } })
    expect([child.educationLevel, child.grade]).toEqual(['SECONDARY', 1])
    expect(child.subjects).toEqual(['Science', 'Mathematics'])
  })

  test('a child who has finished Form 5 stays, and the parent is told once', async () => {
    const p = await makeParent({ child: { educationLevel: 'SECONDARY', grade: 5, gradeYear: 2026 } })
    await promoteChildren(JAN_2027)
    await promoteChildren(new Date('2028-01-02T10:00:00+08:00'))
    const child = await prisma.child.findUnique({ where: { id: p.child.id } })
    expect([child.educationLevel, child.grade, child.gradeYear]).toEqual(['SECONDARY', 5, 2028])
    expect(await prisma.notification.count({ where: { userId: p.user.id, type: 'CHILD_FINISHED' } })).toBe(1)
  })

  test('a server that was off for two Januaries catches up', async () => {
    const p = await makeParent({ child: { educationLevel: 'KINDERGARTEN', grade: 2, gradeYear: 2026 } })
    await promoteChildren(new Date('2028-03-01T10:00:00+08:00'))
    const child = await prisma.child.findUnique({ where: { id: p.child.id } })
    expect([child.educationLevel, child.grade, child.gradeYear]).toEqual(['PRIMARY', 1, 2028])
  })

  test('a child made before this feature (no school year yet) is only stamped, not moved', async () => {
    const p = await makeParent({ child: { educationLevel: 'PRIMARY', grade: 3, gradeYear: null } })
    const { moved } = await promoteChildren(JAN_2027)
    expect(moved).toBeGreaterThanOrEqual(0)
    const child = await prisma.child.findUnique({ where: { id: p.child.id } })
    expect([child.grade, child.gradeYear]).toEqual([3, 2027])
  })
})

describe('the school year is kept in step with what the parent enters', () => {
  test('a new child is stamped with this school year', async () => {
    const p = await makeParent()
    const res = await api(p.token).post('/parent/children', { name: 'Mia', educationLevel: 'PRIMARY', grade: 2, subjects: ['Mathematics'] })
    expect(res.status).toBe(201)
    expect(res.child.gradeYear).toBe(currentSchoolYear())
  })

  test('correcting the grade (a child repeating a year) is true for this year, so the next January moves from the corrected grade', async () => {
    const p = await makeParent({ child: { educationLevel: 'PRIMARY', grade: 4, gradeYear: 2025 } })
    const res = await api(p.token).put(`/parent/children/${p.child.id}`, { name: 'Sarah', educationLevel: 'PRIMARY', grade: 3, subjects: ['Mathematics'] })
    expect(res.status).toBe(200)
    expect(res.child.gradeYear).toBe(currentSchoolYear())
  })

  test('editing only the name or notes does not touch the school year', async () => {
    const p = await makeParent({ child: { gradeYear: currentSchoolYear() - 1 } })
    await api(p.token).put(`/parent/children/${p.child.id}`, { name: 'Sarah Lee', educationLevel: 'PRIMARY', grade: 5, subjects: ['Mathematics'] })
    expect((await prisma.child.findUnique({ where: { id: p.child.id } })).gradeYear).toBe(currentSchoolYear() - 1)
  })

  test('sign-up stamps the children too', async () => {
    const res = await api().post('/auth/register', {
      role: 'PARENT', fullName: 'Miki Lim', email: 'prog1@test.local', phone: '012-345 6789', password: 'Parent1234', acceptedPrivacy: true,
      children: [{ name: 'Adam', educationLevel: 'PRIMARY', grade: 3, subjects: ['English'] }],
    })
    expect(res.status).toBe(201)
    const kid = await prisma.child.findFirst({ where: { parent: { user: { email: 'prog1@test.local' } } } })
    expect(kid.gradeYear).toBe(currentSchoolYear())
  })
})

describe('preferred language and goals', () => {
  test('are saved with the child, and a language outside the list is refused', async () => {
    const p = await makeParent()
    const ok = await api(p.token).post('/parent/children', { name: 'Zara', educationLevel: 'SECONDARY', grade: 4, subjects: ['Mathematics'], preferredLanguage: 'Mandarin', goals: 'SPM Mathematics grade A' })
    expect(ok.status).toBe(201)
    expect(ok.child.preferredLanguage).toBe('Mandarin')
    expect(ok.child.goals).toBe('SPM Mathematics grade A')
    expect((await api(p.token).post('/parent/children', { name: 'Zed', educationLevel: 'SECONDARY', grade: 4, preferredLanguage: 'Klingon' })).status).toBe(400)
  })
})
