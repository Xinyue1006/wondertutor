// A child can need several subjects, and the subject list covers PT3 / SPM: Computer Science, History, Geography,
// Economics, Accounting and more, each only at the levels where it exists.
import { prisma } from '../config/prisma.js'
import { SUBJECTS, SUBJECT_LEVELS, subjectsForLevel } from '../data/catalog.js'
import { subjectsOf } from '../utils/childSubjects.js'
import { MONDAY, api, apiBase, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

const kid = (extra = {}) => ({ name: 'Sarah', educationLevel: 'PRIMARY', grade: 5, ...extra })

describe('the subject list', () => {
  test('includes the SPM subjects that were missing', () => {
    for (const s of ['Computer Science', 'History', 'Geography', 'Economics', 'Principles of Accounting', 'Business', 'Literature in English', 'Tamil', 'Islamic Education', 'Moral Education']) {
      expect(SUBJECTS).toContain(s)
    }
  })

  test('every subject belongs to at least one level, and each level only offers what exists there', () => {
    expect(SUBJECTS.every((s) => SUBJECT_LEVELS[s]?.length > 0)).toBe(true)
    expect(subjectsForLevel('KINDERGARTEN')).not.toContain('Physics')
    expect(subjectsForLevel('PRIMARY')).not.toContain('Physics')
    expect(subjectsForLevel('PRIMARY')).not.toContain('Additional Mathematics')
    expect(subjectsForLevel('PRIMARY')).toContain('Computer Science')
    expect(subjectsForLevel('SECONDARY')).toEqual(expect.arrayContaining(['Physics', 'Additional Mathematics', 'Economics', 'Principles of Accounting']))
    expect(subjectsForLevel('SECONDARY')).toHaveLength(SUBJECTS.length)
  })

  test('the forms are told which subject exists at which level', async () => {
    const p = await makeParent()
    const catalog = await api(p.token).get('/parent/catalog')
    expect(catalog.subjects).toContain('Computer Science')
    expect(catalog.subjectLevels.Physics).toEqual(['SECONDARY'])
    expect(catalog.maxChildSubjects).toBe(6)
    const home = await (await fetch(`${apiBase()}/public/home`)).json()
    expect(home.subjectLevels['Computer Science']).toEqual(['PRIMARY', 'SECONDARY'])
  })
})

describe('a child with several subjects', () => {
  test('is saved with the whole list, duplicates removed, and the first one also kept as the main subject', async () => {
    const p = await makeParent()
    const res = await api(p.token).post('/parent/children', kid({ subjects: ['Mathematics', 'Science', 'English', 'Mathematics'] }))
    expect(res.status).toBe(201)
    expect(res.child.subjects).toEqual(['Mathematics', 'Science', 'English'])
    expect(res.child.subject).toBe('Mathematics')
    const row = await prisma.child.findUnique({ where: { id: res.child.id } })
    expect(row.subjects).toEqual(['Mathematics', 'Science', 'English'])
    expect(row.subject).toBe('Mathematics')
  })

  test('can be edited to other subjects, and to none', async () => {
    const p = await makeParent()
    const { child } = await api(p.token).post('/parent/children', kid({ subjects: ['Mathematics'] }))
    const changed = await api(p.token).put(`/parent/children/${child.id}`, kid({ subjects: ['Science', 'Chinese'] }))
    expect(changed.child.subjects).toEqual(['Science', 'Chinese'])
    expect(changed.child.subject).toBe('Science')
    const none = await api(p.token).put(`/parent/children/${child.id}`, kid({ subjects: [] }))
    expect(none.child.subjects).toEqual([])
    expect(none.child.subject).toBeNull()
  })

  test('the old single "subject" is still accepted', async () => {
    const p = await makeParent()
    const res = await api(p.token).post('/parent/children', kid({ subject: 'English' }))
    expect(res.status).toBe(201)
    expect(res.child.subjects).toEqual(['English'])
  })

  test('a child saved before this change (one subject only) shows it as a list', async () => {
    const p = await makeParent({ child: { subject: 'Science' } })
    expect(subjectsOf(p.child)).toEqual(['Science'])
    const list = await api(p.token).get('/parent/children')
    expect(list.children[0].subjects).toEqual(['Science'])
  })

  test('at most six subjects, and only from the list', async () => {
    const p = await makeParent()
    const seven = ['Mathematics', 'English', 'Science', 'Bahasa Melayu', 'Chinese', 'Tamil', 'History']
    const tooMany = await api(p.token).post('/parent/children', kid({ subjects: seven }))
    expect(tooMany.status).toBe(400)
    expect(tooMany.message).toContain('up to 6')
    expect((await api(p.token).post('/parent/children', kid({ subjects: ['Underwater Basket Weaving'] }))).status).toBe(400)
  })

  test('a subject that does not exist at the child’s level is refused, naming the subject and the level', async () => {
    const p = await makeParent()
    const res = await api(p.token).post('/parent/children', kid({ subjects: ['Mathematics', 'Physics'] }))
    expect(res.status).toBe(400)
    expect(res.message).toBe('Physics is not taught at Primary level')
    const ok = await api(p.token).post('/parent/children', { name: 'Adam', educationLevel: 'SECONDARY', grade: 5, subjects: ['Physics', 'Computer Science', 'Principles of Accounting'] })
    expect(ok.status).toBe(201)
    const tiny = await api(p.token).post('/parent/children', { name: 'Mia', educationLevel: 'KINDERGARTEN', grade: 2, subjects: ['Science'] })
    expect(tiny.status).toBe(400)
  })
})

describe('sign-up with children', () => {
  const base = (n, children) => ({
    role: 'PARENT', fullName: 'Miki Lim', email: `subj${n}@test.local`, phone: '012-345 6789', password: 'Parent1234', acceptedPrivacy: true, children,
  })

  test('the subjects of each child are saved', async () => {
    const res = await api().post('/auth/register', base(1, [{ name: 'Adam', educationLevel: 'SECONDARY', grade: 4, subjects: ['Physics', 'Chemistry', 'Additional Mathematics'], notes: 'SPM next year' }]))
    expect(res.status).toBe(201)
    const parent = await prisma.parentProfile.findFirst({ where: { user: { email: 'subj1@test.local' } }, include: { children: true } })
    expect(parent.children[0].subjects).toEqual(['Physics', 'Chemistry', 'Additional Mathematics'])
    expect(parent.children[0].subject).toBe('Physics')
  })

  test('the older one-subject form still works, and a wrong level is refused', async () => {
    expect((await api().post('/auth/register', base(2, [{ name: 'Sarah', educationLevel: 'PRIMARY', grade: 3, subject: 'Mathematics' }]))).status).toBe(201)
    const bad = await api().post('/auth/register', base(3, [{ name: 'Sarah', educationLevel: 'PRIMARY', grade: 3, subjects: ['Economics'] }]))
    expect(bad.status).toBe(400)
    expect(bad.message).toContain('Economics is not taught at Primary level')
  })
})

describe('booking a lesson for a child with several subjects', () => {
  test('without a chosen subject, the first of the child’s subjects that this tutor teaches is used', async () => {
    const p = await makeParent({ child: { subject: null, subjects: ['English', 'Mathematics'] } })
    const t = await makeTutor() // teaches Mathematics in Primary 4-6 (not English)
    const res = await api(p.token).post('/parent/bookings', {
      tutorId: t.tutor.id, childId: p.child.id, date: nextDate(MONDAY), startTime: '16:00', teachingMode: 'ONLINE', proposedPrice: 50,
    })
    expect(res.status).toBe(201)
    expect(res.booking.subject).toBe('Mathematics')
  })
})

describe('download my data', () => {
  test('lists every subject of each child', async () => {
    const p = await makeParent()
    await api(p.token).post('/parent/children', kid({ name: 'Zara', subjects: ['Mathematics', 'Science'] }))
    const data = JSON.parse(await (await fetch(`${apiBase()}/parent/account/export`, { headers: { Authorization: `Bearer ${p.token}` } })).text())
    expect(data.children.find((c) => c.name === 'Zara').subjects).toEqual(['Mathematics', 'Science'])
  })
})
