import { prisma } from '../config/prisma.js'
import { rankTutorGroups, groupTutorCandidates } from '../services/tutorSearchScope.js'
import { scoreTutor } from '../services/matching.service.js'
import { executeTool } from '../services/assistant/tools.js'
import { createSession, _clearAll } from '../services/assistant/session.js'
import { composeFromEvidence } from '../services/assistant/answers.js'
import { api, makeParent, makeTutor, nextDate, MONDAY, resetDb, startServer, stopServer } from './helpers.js'

const criteria = { subject: 'English', level: 'PRIMARY', grade: 5, location: 'Kepong, Kuala Lumpur', lat: 3.2087, lng: 101.6366, mode: 'EITHER' }
const tutor = (id, extra = {}) => ({ id, subjects: [{ subject: 'English', educationLevel: 'PRIMARY', minGrade: 1, maxGrade: 6 }], latitude: 3.2087, longitude: 101.6366, offersPhysical: true, offersOnline: true, yearsExperience: 6, isVerified: true, hourlyRate: 50, ratingAvg: 4.8, ratingCount: 8, availability: [], qualifications: [], ...extra })

describe('physical eligibility and truthful scoring', () => {
  test('dual-mode tutors cannot bypass the radius, and remote recommendations describe online lessons', () => {
    const far = tutor(2, { latitude: 5.2885, longitude: 103.1227 })
    const groups = rankTutorGroups([tutor(1), far], criteria)
    expect(groups.tutors.map(row => row.tutor.id)).toEqual([1])
    const online = groups.onlineAlternatives.find(row => row.tutor.id === 2).match
    expect(online.distanceKm).toBeNull()
    expect(online.reasons).toContain('Offers online lessons')
    expect(online.reasons.join(' ')).not.toMatch(/30 km away|your area/)
    expect(scoreTutor(far, criteria).reasons.join(' ')).not.toContain('30 km away')
  })

  test('online eligibility ignores distance and coordinates but excludes physical-only tutors', () => {
    const groups = groupTutorCandidates([tutor(1, { offersOnline: false }), tutor(2, { latitude: 5, longitude: 116 }), tutor(3, { latitude: null, longitude: null })], { ...criteria, mode: 'ONLINE' })
    expect(groups.tutors.map(row => row.id)).toEqual([2, 3])
    expect(groups.onlineAlternatives).toEqual([])
  })

  test('physical results respect a smaller radius, exclude unknown coordinates and honour the 30 km boundary', () => {
    const candidates = [tutor(1), tutor(2, { latitude: 3.2987 }), tutor(3, { latitude: null, longitude: null }), tutor(4, { latitude: 3.477 }), tutor(5, { latitude: 3.480 })]
    expect(groupTutorCandidates(candidates, criteria).tutors.map(row => row.id)).toEqual([1, 2, 4])
    expect(groupTutorCandidates(candidates, { ...criteria, maxDistance: 5 }).tutors.map(row => row.id)).toEqual([1])
  })

  test('a physical search without an area asks for one instead of claiming any tutor is nearby', () => {
    const groups = groupTutorCandidates([tutor(1)], { ...criteria, lat: undefined, lng: undefined, mode: 'PHYSICAL' })
    expect(groups.searchScope.needsLocation).toBe(true)
    expect(groups.tutors).toEqual([])
    expect(groups.onlineAlternatives).toEqual([])
  })
})

describe('parent, public, wizard and AI integration', () => {
  let family, other, near, far, online, unknown
  const path = '/parent/tutors?subject=English&level=PRIMARY&grade=5'
  const remoteArea = 'Kuala Terengganu, Terengganu'
  beforeAll(async () => {
    await resetDb(); await startServer()
    family = await makeParent(); other = await makeParent()
    near = await makeTutor({ rate: 70 })
    far = await makeTutor({ rate: 50 })
    online = await makeTutor({ rate: 55, physical: false })
    unknown = await makeTutor({ rate: 60 })
    await prisma.tutorSubject.updateMany({ data: { subject: 'English' } })
    await prisma.tutorProfile.update({ where: { id: far.tutor.id }, data: { location: 'Banting, Selangor', latitude: 2.8167, longitude: 101.5 } })
    await prisma.tutorProfile.update({ where: { id: unknown.tutor.id }, data: { latitude: null, longitude: null } })
  })
  afterAll(async () => { _clearAll(); await stopServer() })

  test('local results contain only nearby physical tutors, with no online mixing', async () => {
    const response = await api(family.token).get(path + '&location=' + encodeURIComponent(criteria.location))
    expect(response.status).toBe(200)
    expect(response.tutors.map(row => row.id)).toEqual([near.tutor.id])
    expect(response.tutors[0].searchMode).toBe('PHYSICAL')
    expect(response.searchScope.radiusKm).toBe(30)
    expect(response.onlineAlternatives.total).toBe(0)
    const publicResponse = await api().get('/public/tutors?subject=English&level=PRIMARY&grade=5&location=' + encodeURIComponent(criteria.location))
    expect(publicResponse.tutors.map(row => row.id)).toEqual([near.tutor.id])
  })

  test('no local match returns separately paginated online alternatives that keep all chosen price filters', async () => {
    const query = '&mode=PHYSICAL&location=' + encodeURIComponent(remoteArea) + '&maxPrice=60&sort=price_asc&pageSize=2'
    const first = await api(family.token).get(path + query)
    const second = await api(family.token).get(path + query + '&page=2')
    expect(first.total).toBe(0)
    expect(first.tutors).toEqual([])
    expect(first.onlineAlternatives).toMatchObject({ total: 3, page: 1, totalPages: 2 })
    expect(second.onlineAlternatives).toMatchObject({ total: 3, page: 2, totalPages: 2 })
    const cards = [...first.onlineAlternatives.tutors, ...second.onlineAlternatives.tutors]
    expect(new Set(cards.map(row => row.id)).size).toBe(3)
    expect(cards.map(row => row.hourlyRate)).toEqual([50, 55, 60])
    expect(cards.every(row => row.searchMode === 'ONLINE' && row.distanceKm === null)).toBe(true)
    const publicResponse = await api().get('/public/tutors?subject=English&level=PRIMARY&mode=PHYSICAL&location=' + encodeURIComponent(remoteArea))
    expect(publicResponse.total).toBe(0)
    expect(publicResponse.onlineAlternatives.total).toBe(4)
  })

  test('explicit online searches are nationwide even when a location and distance were supplied', async () => {
    const response = await api(family.token).get(path + '&mode=ONLINE&maxDistance=5&location=' + encodeURIComponent(remoteArea))
    expect(response.total).toBe(4)
    expect(response.tutors.every(row => row.searchMode === 'ONLINE' && row.distanceKm === null)).toBe(true)
    expect(response.tutors.some(row => row.id === unknown.tutor.id)).toBe(true)
    expect(response.rankedBy.join(' ')).not.toContain('distance')
  })

  test('mode-specific availability is preserved in online alternatives', async () => {
    try {
      await prisma.availabilitySlot.updateMany({ where: { tutorId: near.tutor.id }, data: { mode: 'ONLINE' } })
      const response = await api(family.token).get(path + '&mode=PHYSICAL&location=' + encodeURIComponent(criteria.location) + '&date=' + nextDate(MONDAY) + '&time=17:00')
      expect(response.total).toBe(0)
      expect(response.onlineAlternatives.tutors.map(row => row.id)).toContain(near.tutor.id)
    } finally { await prisma.availabilitySlot.updateMany({ where: { tutorId: near.tutor.id }, data: { mode: 'BOTH' } }) }
  })

  test('wizard, read-only preview, latest search and child ownership use the same groups', async () => {
    const input = { subject: 'English', level: 'PRIMARY', grade: 5, mode: 'PHYSICAL', location: remoteArea }
    const before = await prisma.matchingRequest.count()
    const preview = await api(family.token).post('/parent/matching/preview', { criteria: input })
    expect(preview).toMatchObject({ status: 200, total: 0, onlineAlternatives: { total: 4 } })
    expect(await prisma.matchingRequest.count()).toBe(before)
    expect((await api(family.token).post('/parent/matching/preview', { criteria: { ...input, childId: other.child.publicId } })).status).toBe(404)
    const saved = await api(family.token).post('/parent/matching', { criteria: input })
    expect(saved).toMatchObject({ status: 201, total: 0, onlineAlternatives: { total: 4 } })
    expect((await api(family.token).get('/parent/matching/latest')).matching.onlineAlternatives.total).toBe(4)
    expect((await api(family.token).post('/parent/matching/preview', { criteria: { ...input, mode: 'ONLINE' } })).total).toBe(4)
  })

  test('AI tools and grounded answers label online alternatives without saving a search or inventing proximity', async () => {
    const ctx = { user: family.user, parent: family.parent, db: prisma, session: createSession(family.user, family.parent), cards: [], sources: [], evidence: [] }
    const before = await prisma.matchingRequest.count()
    const result = await executeTool(ctx, 'search_tutors', { subject: 'English', level: 'PRIMARY', grade: 5, mode: 'PHYSICAL', location: remoteArea })
    expect(result).toMatchObject({ ok: true, result: { total: 0, onlineAlternative: true, onlineAlternativeTotal: 4 } })
    expect(ctx.cards[0].onlineAlternative).toBe(true)
    expect(ctx.cards[0].tutors.every(row => row.link.endsWith('?mode=ONLINE'))).toBe(true)
    expect(composeFromEvidence(ctx, 'en')).toContain('online alternatives')
    expect(JSON.stringify(ctx.cards)).not.toMatch(/30 km away|Teaches.*your area/)
    expect(ctx.matchResult.total).toBe(0)
    expect(ctx.matchResult.onlineAlternatives.total).toBe(4)
    expect(await prisma.matchingRequest.count()).toBe(before)
  })
})
