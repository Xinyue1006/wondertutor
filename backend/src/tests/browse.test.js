// Find a Tutor (browse): filters decide who is shown, the recommendation score decides the order,
// saved preferences + home area feed that score, every tutor carries its own match result, and results are paged.
import { prisma } from '../config/prisma.js'
import { api, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

let female, male, onlineOnly
const search = '/parent/tutors?subject=Mathematics&level=PRIMARY&grade=5'

beforeAll(async () => {
  await resetDb()
  await startServer()
  // Two tutors that are identical except for gender, plus one online-only tutor
  female = await makeTutor({ rate: 50 })
  male = await makeTutor({ rate: 50 })
  await prisma.tutorProfile.update({ where: { id: male.tutor.id }, data: { gender: 'MALE' } })
  onlineOnly = await makeTutor({ rate: 50, physical: false })
})
afterAll(stopServer)

const setPrefs = (parent, preferences) => prisma.parentProfile.update({ where: { id: parent.parent.id }, data: { preferences } })

describe('browse results', () => {
  test('each tutor carries its own match score, label and reasons; there is no fixed "recommended" tag', async () => {
    const { token } = await makeParent()
    const res = await api(token).get(search)
    expect(res.status).toBe(200)
    expect(res.total).toBe(3)
    for (const t of res.tutors) {
      expect(t.match.score).toBeGreaterThan(0)
      expect(t.match.score).toBeLessThanOrEqual(100)
      expect(typeof t.match.label).toBe('string')
      expect(Array.isArray(t.match.reasons)).toBe(true)
      expect(t).not.toHaveProperty('recommended')
    }
    // "Recommended" order is the score order
    const scores = res.tutors.map((t) => t.match.score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  test("the parent's saved preferences change the order (but never hide anyone)", async () => {
    const wantsMale = await makeParent()
    await setPrefs(wantsMale, { mode: 'EITHER', gender: 'MALE', characteristics: [], days: [], timePreset: null, budgetMax: null })
    const a = await api(wantsMale.token).get(search)
    expect(a.tutors[0].id).toBe(male.tutor.id)
    expect(a.tutors[0].match.reasons).toContain('Matches your preferred tutor gender')
    expect(a.total).toBe(3) // the female tutors are still listed, just lower
    expect(a.rankedBy).toContain('your saved preferences')

    const wantsFemale = await makeParent()
    await setPrefs(wantsFemale, { mode: 'EITHER', gender: 'FEMALE', characteristics: [], days: [], timePreset: null, budgetMax: null })
    const b = await api(wantsFemale.token).get(search)
    expect(b.tutors.findIndex((t) => t.id === female.tutor.id)).toBeLessThan(b.tutors.findIndex((t) => t.id === male.tutor.id))
  })

  test('a preferred teaching mode ranks tutors who offer it higher; choosing it as a filter hides the others', async () => {
    const wantsOnline = await makeParent()
    await setPrefs(wantsOnline, { mode: 'ONLINE', gender: 'ANY', characteristics: [], days: [], timePreset: null, budgetMax: null })
    expect((await api(wantsOnline.token).get(search)).total).toBe(3)
    const filtered = await api(wantsOnline.token).get(`${search}&mode=PHYSICAL`)
    expect(filtered.tutors.map((t) => t.id)).not.toContain(onlineOnly.tutor.id)
  })

  test('the home area is used for distance when no location is searched', async () => {
    const { token } = await makeParent() // test parents live in Kepong
    await prisma.parentProfile.updateMany({ where: { address: 'Kepong, Kuala Lumpur' }, data: { latitude: 3.2087, longitude: 101.6366 } })
    const res = await api(token).get(search)
    const physical = res.tutors.find((t) => t.id === female.tutor.id)
    expect(physical.distanceKm).toBe(0)
    expect(res.rankedBy.join(' ')).toMatch(/home area/)
  })
})

describe('pagination', () => {
  test('pages, totals and an out-of-range page', async () => {
    const { token } = await makeParent()
    const p1 = await api(token).get(`${search}&pageSize=2&page=1`)
    expect(p1).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 })
    expect(p1.tutors).toHaveLength(2)
    const p2 = await api(token).get(`${search}&pageSize=2&page=2`)
    expect(p2.tutors).toHaveLength(1)
    // no tutor appears on two pages
    expect(p1.tutors.map((t) => t.id)).not.toContain(p2.tutors[0].id)
    const tooFar = await api(token).get(`${search}&pageSize=2&page=99`)
    expect(tooFar.page).toBe(2)
    expect(tooFar.tutors).toHaveLength(1)
  })

  test('page size is capped and must be positive', async () => {
    const { token } = await makeParent()
    expect((await api(token).get(`${search}&pageSize=500`)).status).toBe(400)
    expect((await api(token).get(`${search}&page=0`)).status).toBe(400)
  })
})

describe('saved tutors', () => {
  test('save, list and unsave; the browse results show which tutors are saved', async () => {
    const { token } = await makeParent()
    expect((await api(token).get('/parent/favourites')).total).toBe(0)
    expect((await api(token).post(`/parent/favourites/${male.tutor.id}`)).isFavourite).toBe(true)
    const list = await api(token).get('/parent/favourites')
    expect(list.tutors.map((t) => t.id)).toEqual([male.tutor.id])
    expect((await api(token).get(search)).tutors.find((t) => t.id === male.tutor.id).isFavourite).toBe(true)
    expect((await api(token).post(`/parent/favourites/${male.tutor.id}`)).isFavourite).toBe(false)
    expect((await api(token).get('/parent/favourites')).total).toBe(0)
  })

  test("one parent's saved list is private, and deactivated tutors drop off it", async () => {
    const a = await makeParent()
    const b = await makeParent()
    await api(a.token).post(`/parent/favourites/${onlineOnly.tutor.id}`)
    expect((await api(b.token).get('/parent/favourites')).total).toBe(0)
    await prisma.user.update({ where: { id: onlineOnly.user.id }, data: { status: 'DEACTIVATED' } })
    expect((await api(a.token).get('/parent/favourites')).total).toBe(0)
    await prisma.user.update({ where: { id: onlineOnly.user.id }, data: { status: 'ACTIVE' } })
  })
})
