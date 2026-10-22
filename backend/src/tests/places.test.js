// Places across Malaysia: the postcode and town data, the search behind the area picker, and how a saved place turns into
// the coordinates the tutor distance needs.
import { prisma } from '../config/prisma.js'
import { findLocation } from '../data/catalog.js'
import { STATES, popularPlaces, resolvePlace, searchPlaces } from '../services/places.service.js'
import { distanceBand } from '../services/matching.service.js'
import { api, apiBase, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

const labels = (q, o) => searchPlaces(q, o).map((p) => p.label)

describe('place data', () => {
  test('covers every state and territory of Malaysia, not only Kuala Lumpur and Selangor', () => {
    expect(STATES).toEqual(expect.arrayContaining(['Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Labuan', 'Melaka', 'Negeri Sembilan', 'Pahang', 'Perak', 'Perlis', 'Pulau Pinang', 'Putrajaya', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu']))
    expect(STATES).toHaveLength(16)
  })

  test('places on the other side of the country are found, with coordinates inside Malaysia', () => {
    for (const label of ['Kota Kinabalu, Sabah', 'Kuching, Sarawak', 'Ipoh, Perak', 'Kuala Terengganu, Terengganu', 'Langkawi, Kedah', '98000 Miri, Sarawak']) {
      const p = resolvePlace(label)
      expect(p).not.toBeNull()
      expect(p.lat).toBeGreaterThan(0.5)
      expect(p.lat).toBeLessThan(8)
      expect(p.lng).toBeGreaterThan(99)
      expect(p.lng).toBeLessThan(120)
    }
  })
})

describe('search', () => {
  test('before anything is typed, the popular places are offered', () => {
    const popular = labels('')
    expect(popular).toContain('Kepong, Kuala Lumpur')
    expect(popular).toContain('Kuala Lumpur')
    expect(popularPlaces().length).toBeGreaterThanOrEqual(8)
  })

  test('a name matches the start of its words, best match first', () => {
    expect(labels('kep')[0]).toBe('Kepong, Kuala Lumpur')
    expect(labels('shah')[0]).toBe('Shah Alam, Selangor')
    expect(labels('kota k')[0]).toBe('Kota Kinabalu, Sabah')
    expect(labels('KUCHING')[0]).toBe('Kuching, Sarawak') // capital letters do not matter
  })

  test('a postcode (or the start of one) finds the postcode itself', () => {
    expect(labels('52100')).toEqual(['52100 Kuala Lumpur'])
    expect(labels('427')).toEqual(expect.arrayContaining(['42700 Banting, Selangor']))
    expect(labels('427').every((l) => /^427/.test(l))).toBe(true)
  })

  test('the names people actually say work: KL, JB, PJ, Penang, Malacca', () => {
    expect(labels('kl')[0]).toBe('Kuala Lumpur')
    expect(labels('jb')[0]).toBe('Johor Bahru, Johor')
    expect(labels('pj')[0]).toBe('Petaling Jaya, Selangor')
    expect(labels('penang')[0]).toBe('Pulau Pinang')
    expect(labels('pen')[0]).toBe('Pulau Pinang') // the first letters of a nickname are enough
    expect(labels('mal')[0]).toBe('Melaka')
    expect(labels('george town')[0]).toBe('Pulau Pinang')
    expect(labels('malacca')[0]).toBe('Melaka')
  })

  test('can be limited to one state, and the number of results is capped', () => {
    expect(labels('kuala', { state: 'Terengganu' }).every((l) => l.includes('Terengganu'))).toBe(true)
    expect(searchPlaces('a', { limit: 3 })).toHaveLength(3)
    expect(searchPlaces('a', { limit: 500 }).length).toBeLessThanOrEqual(20)
  })

  test('nonsense finds nothing, and strange characters do not break it', () => {
    expect(searchPlaces('zzzzqq')).toEqual([])
    expect(() => searchPlaces('%$#@!(){}[]\\ \u0000 ñ é')).not.toThrow()
    expect(labels('  kep  ')[0]).toBe('Kepong, Kuala Lumpur')
  })
})

describe('saved places become coordinates', () => {
  test('a neighbourhood, a town and a postcode all resolve, and so does an older saved area', () => {
    expect(resolvePlace('Kepong, Kuala Lumpur')).toMatchObject({ lat: 3.2087, lng: 101.6366 })
    expect(resolvePlace('Shah Alam, Selangor')).toMatchObject({ name: 'Shah Alam, Selangor' })
    expect(resolvePlace('52100 Kuala Lumpur')).toMatchObject({ lat: 3.1833, lng: 101.6584 })
    expect(findLocation('Banting, Selangor')).toMatchObject({ lat: 2.8167, lng: 101.5 }) // from the original 20 areas
  })

  test('a place we do not know, or nothing, gives null', () => {
    expect(resolvePlace('Taman Melawati')).toBeNull()
    expect(resolvePlace('')).toBeNull()
    expect(resolvePlace(null)).toBeNull()
    expect(findLocation(undefined)).toBeNull()
  })
})

describe('area picker endpoint', () => {
  test('answers without a login and never sends coordinates', async () => {
    const res = await fetch(`${apiBase()}/public/places?q=kota%20kinabalu`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.popular).toBe(false)
    expect(body.results[0]).toEqual({ label: 'Kota Kinabalu, Sabah', kind: 'town', state: 'Sabah' })
    expect(body.states).toHaveLength(16)
    expect(JSON.stringify(body)).not.toMatch(/"lat"|"lng"|latitude/)
  })

  test('with nothing typed it returns the popular places', async () => {
    const body = await api().get('/public/places')
    expect(body.popular).toBe(true)
    expect(body.results.length).toBeGreaterThan(5)
  })

  test('refuses an unknown state, a too long search and a silly limit', async () => {
    expect((await api().get('/public/places?q=a&state=Atlantis')).status).toBe(400)
    expect((await api().get(`/public/places?q=${'a'.repeat(61)}`)).status).toBe(400)
    expect((await api().get('/public/places?q=a&limit=0')).status).toBe(400)
    expect((await api().get('/public/places?q=a&limit=99')).status).toBe(400)
  })
})

describe('using a place', () => {
  test('a parent who picks a place in Sabah gets its coordinates, and the profile says it is on the map', async () => {
    const p = await makeParent()
    const res = await api(p.token).put('/parent/profile', { fullName: 'Miki Lim', address: '88000 Kota Kinabalu, Sabah' })
    expect(res.status).toBe(200)
    const saved = await prisma.parentProfile.findUnique({ where: { id: p.parent.id } })
    expect(saved).toMatchObject({ address: '88000 Kota Kinabalu, Sabah' })
    expect(saved.latitude).toBeGreaterThan(5)
    expect(saved.longitude).toBeGreaterThan(115)
    const profile = (await api(p.token).get('/parent/profile')).profile
    expect(profile.addressKnown).toBe(true)
    expect((await api(p.token).get('/parent/catalog')).homeLocation).toBe('88000 Kota Kinabalu, Sabah')
  })

  test('a place typed by hand is kept, but has no coordinates and the profile says so', async () => {
    const p = await makeParent()
    await api(p.token).put('/parent/profile', { fullName: 'Miki Lim', address: 'Taman Melawati' })
    const saved = await prisma.parentProfile.findUnique({ where: { id: p.parent.id } })
    expect(saved).toMatchObject({ address: 'Taman Melawati', latitude: null, longitude: null })
    expect((await api(p.token).get('/parent/profile')).profile.addressKnown).toBe(false)
    expect((await api(p.token).get('/parent/catalog')).homeLocation).toBeNull()
  })

  test('searching tutors from another state measures the distance from there', async () => {
    const parent = await makeParent()
    await makeTutor() // teaches in Kepong
    const res = await api(parent.token).get('/parent/tutors?subject=Mathematics&level=PRIMARY&grade=5&location=Kota%20Kinabalu%2C%20Sabah')
    expect(res.status).toBe(200)
    expect(res.tutors[0].distanceKm).toBeGreaterThan(1500) // Kota Kinabalu is across the South China Sea
  })
})

describe('distance is said as a band, not as an exact number', () => {
  test('the bands match the ones the score uses', () => {
    expect(distanceBand(0.4)).toBe('within 3 km')
    expect(distanceBand(3)).toBe('within 3 km')
    expect(distanceBand(5.3)).toBe('within 8 km')
    expect(distanceBand(14)).toBe('within 15 km')
    expect(distanceBand(29.9)).toBe('within 30 km')
    expect(distanceBand(450)).toBe('more than 30 km away')
    expect(distanceBand(null)).toBeNull()
  })

  test('the reason on a tutor card uses the band', async () => {
    const parent = await makeParent()
    await makeTutor()
    const res = await api(parent.token).get('/parent/tutors?subject=Mathematics&level=PRIMARY&grade=5&location=Kepong%2C%20Kuala%20Lumpur')
    const reasons = res.tutors.flatMap((t) => t.match.reasons)
    expect(reasons.some((r) => /^Teaches within \d+ km of your area$/.test(r))).toBe(true)
    expect(reasons.some((r) => /about \d+ km/.test(r))).toBe(false)
  })
})
