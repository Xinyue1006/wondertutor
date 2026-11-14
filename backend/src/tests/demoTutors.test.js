import bcrypt from 'bcrypt'
import { prisma } from '../config/prisma.js'
import { addDemoTutors, DEMO_TUTORS, demoTutorEmail } from '../../prisma/demoTutors.js'
import { SUBJECTS } from '../data/catalog.js'
import { readDatabaseSnapshot } from '../services/databaseMerge/apply.js'
import { api, makeBooking, makeParent, makeTutor, nextDate, MONDAY, resetDb, startServer, stopServer } from './helpers.js'

let hash
beforeAll(async () => { hash = await bcrypt.hash('Tutor1234', 10); await startServer() })
beforeEach(resetDb)
afterAll(stopServer)

test('new demo tutors preserve existing data and make all 19 subjects discoverable with real availability', async () => {
  const original = await makeTutor()
  await prisma.tutorSubject.updateMany({ where: { tutorId: original.tutor.id }, data: { subject: 'Chinese', educationLevel: 'PRIMARY' } })
  const family = await makeParent()
  await makeBooking({ tutor: original.tutor, parent: family.parent, child: family.child, date: nextDate(MONDAY), status: 'PENDING' })
  const before = await readDatabaseSnapshot(prisma)
  const result = await addDemoTutors(prisma, hash)
  expect(result.created).toHaveLength(12)
  expect(result.skipped).toHaveLength(0)
  const after = await readDatabaseSnapshot(prisma)
  for (const [model, rows] of Object.entries(before)) expect(after[model]).toEqual(expect.arrayContaining(rows))
  for (const model of ['Booking', 'Review', 'Payment', 'Child', 'ParentProfile', 'AuthSession', 'Notification']) expect(after[model]).toEqual(before[model])
  for (const subject of SUBJECTS) {
    const response = await api().get('/public/tutors?' + new URLSearchParams({ subject }))
    expect(response.status).toBe(200)
    expect(response.total).toBeGreaterThan(0)
    expect(response.tutors.every(tutor => tutor.subjects.includes(subject))).toBe(true)
  }
  const users = await prisma.user.findMany({ where: { id: { in: result.created.map(row => row.userId) } }, include: { tutor: { include: { qualifications: true, availability: true } } } })
  for (const user of users) {
    expect(user).toMatchObject({ role: 'TUTOR', status: 'ACTIVE', isEmailVerified: true, profilePhotoUrl: null, emailReminders: false })
    expect(await bcrypt.compare('Tutor1234', user.passwordHash)).toBe(true)
    expect(user.tutor).toMatchObject({ ratingAvg: 0, ratingCount: 0, offersOnline: true, offersPhysical: true })
    expect(user.tutor.qualifications).toHaveLength(2)
    expect(user.tutor.qualifications.every(row => row.documentUrl.startsWith('seed://'))).toBe(true)
    expect(user.tutor.availability).toHaveLength(4)
    const profile = await api().get('/public/tutors/' + user.tutor.id)
    expect(profile.tutor.location).toBe(user.tutor.location)
    expect(profile.tutor.upcomingAvailability.some(day => day.slots.some(slot => slot.status === 'available' && slot.mode === 'BOTH'))).toBe(true)
  }
})

test('repeat import preserves passwords, edited profiles, account status and calendar changes exactly', async () => {
  const first = await addDemoTutors(prisma, hash)
  const row = first.created[0]
  await prisma.user.update({ where: { id: row.userId }, data: { fullName: 'Edited demo name', passwordHash: 'changed-hash', status: 'DEACTIVATED' } })
  await prisma.tutorProfile.update({ where: { id: row.tutorId }, data: { hourlyRate: 87, isVerified: false, bio: 'Edited profile.' } })
  await prisma.availabilitySlot.deleteMany({ where: { tutorId: row.tutorId } })
  const before = await readDatabaseSnapshot(prisma)
  const repeat = await addDemoTutors(prisma, 'different-hash')
  expect(repeat.created).toHaveLength(0)
  expect(repeat.skipped).toHaveLength(DEMO_TUTORS.length)
  expect(await readDatabaseSnapshot(prisma)).toEqual(before)
})

test('an email collision with a different role rolls the whole batch back', async () => {
  await prisma.user.create({ data: { email: demoTutorEmail(DEMO_TUTORS[1]), fullName: 'Existing parent', role: 'PARENT' } })
  const before = await readDatabaseSnapshot(prisma)
  await expect(addDemoTutors(prisma, hash, DEMO_TUTORS.slice(0, 2))).rejects.toThrow('A different account already uses the demo email')
  expect(await readDatabaseSnapshot(prisma)).toEqual(before)
})

test('invalid fixture locations, duplicate keys and subject-level pairs cannot write any rows', async () => {
  const before = await readDatabaseSnapshot(prisma)
  for (const fixtures of [
    [{ ...DEMO_TUTORS[0], location: 'Unknown demo town' }],
    [DEMO_TUTORS[0], DEMO_TUTORS[0]],
    [{ ...DEMO_TUTORS[0], subjects: [{ subject: 'Physics', educationLevel: 'PRIMARY', minGrade: 1, maxGrade: 6 }] }],
  ]) await expect(addDemoTutors(prisma, hash, fixtures)).rejects.toThrow()
  await expect(addDemoTutors(prisma, '')).rejects.toThrow('A hashed demo password is required')
  expect(await readDatabaseSnapshot(prisma)).toEqual(before)
})
