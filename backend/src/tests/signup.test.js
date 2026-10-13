// Parent signup: children with subject and learning goals, saved tutor preferences, and the saved area's coordinates.
import { prisma } from '../config/prisma.js'
import { api, makeParent, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

const base = (n) => ({
  role: 'PARENT', fullName: 'Miki Lim', email: `miki${n}@test.local`, phone: '+60123456789', password: 'Parent1234',
})

describe('parent registration', () => {
  test('saves the area (with coordinates), each child\'s subject and goals, and the preferences', async () => {
    const res = await api().post('/auth/register', {
      ...base(1),
      address: 'Kepong, Kuala Lumpur',
      children: [{ name: 'Sarah', educationLevel: 'PRIMARY', grade: 5, subject: 'Mathematics', notes: 'Wants to be faster at word problems' }],
      preferences: { mode: 'PHYSICAL', gender: 'FEMALE', characteristics: ['Structured'], days: [6, 1, 1], timePreset: 'EVENING', budgetMax: 60 },
    })
    expect(res.status).toBe(201)

    const parent = await prisma.parentProfile.findFirst({ where: { user: { email: 'miki1@test.local' } }, include: { children: true } })
    expect(parent.latitude).toBeCloseTo(3.2087, 3) // matching distance needs this from the first search
    expect(parent.children[0]).toMatchObject({ subject: 'Mathematics', notes: 'Wants to be faster at word problems' })
    // duplicate days removed and sorted; shape is the matching wizard's
    expect(parent.preferences).toEqual({ mode: 'PHYSICAL', gender: 'FEMALE', characteristics: ['Structured'], days: [1, 6], timePreset: 'EVENING', budgetMax: 60 })
  })

  test('preferences are optional: nothing chosen is stored as null', async () => {
    expect((await api().post('/auth/register', { ...base(2), preferences: {} })).status).toBe(201)
    const parent = await prisma.parentProfile.findFirst({ where: { user: { email: 'miki2@test.local' } } })
    expect(parent.preferences).toBeNull()
  })

  test('invalid preferences are rejected with a message', async () => {
    const bad = await api().post('/auth/register', { ...base(3), preferences: { mode: 'TELEPORT' } })
    expect(bad.status).toBe(400)
    const unknownStyle = await api().post('/auth/register', { ...base(4), preferences: { characteristics: ['Shouty'] } })
    expect(unknownStyle.status).toBe(400)
    const hugeBudget = await api().post('/auth/register', { ...base(5), preferences: { budgetMax: 5000 } })
    expect(hugeBudget.status).toBe(400)
  })
})

describe('preferences on the profile and in the wizard defaults', () => {
  test('a parent can save, read and clear preferences', async () => {
    const { token } = await makeParent()
    const prefs = { mode: 'ONLINE', gender: 'ANY', characteristics: ['Interactive'], days: [2, 4], timePreset: 'AFTERNOON', budgetMax: 80 }

    const saved = await api(token).put('/parent/profile', { fullName: 'Test Parent', phone: '+60123456789', address: 'Kepong, Kuala Lumpur', preferences: prefs })
    expect(saved.status).toBe(200)
    expect(saved.profile.preferences).toEqual(prefs)
    expect((await api(token).get('/parent/profile')).profile.preferences).toEqual(prefs)
    expect((await api(token).get('/parent/catalog')).preferences).toEqual(prefs) // the wizard starts from these

    // leaving "preferences" out keeps them; null clears them
    const kept = await api(token).put('/parent/profile', { fullName: 'Test Parent', phone: '+60123456789' })
    expect(kept.profile.preferences).toEqual(prefs)
    const cleared = await api(token).put('/parent/profile', { fullName: 'Test Parent', phone: '+60123456789', preferences: null })
    expect(cleared.profile.preferences).toBeNull()
  })

  test('a parent with no preferences gets null from the catalog', async () => {
    const { token } = await makeParent()
    expect((await api(token).get('/parent/catalog')).preferences).toBeNull()
  })
})
