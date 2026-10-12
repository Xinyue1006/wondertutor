import { WEIGHTS, isEligible, rankTutors, scoreTutor, distanceKm } from '../services/matching.service.js'

// Minimal tutor factory: only the fields the matching service reads
const tutor = (over = {}) => ({
  id: 1,
  gender: 'FEMALE',
  yearsExperience: 4,
  hourlyRate: 50,
  latitude: 3.2087, // Kepong
  longitude: 101.6366,
  offersPhysical: true,
  offersOnline: true,
  characteristics: ['Structured'],
  isVerified: true,
  ratingAvg: 4.8,
  ratingCount: 100,
  subjects: [{ subject: 'Mathematics', educationLevel: 'PRIMARY', minGrade: 4, maxGrade: 6 }],
  availability: [{ dayOfWeek: 1, startTime: '17:00', endTime: '21:00' }],
  qualifications: [{ status: 'APPROVED' }],
  ...over,
})

const base = { subject: 'Mathematics', level: 'PRIMARY', grade: 5, lat: 3.2087, lng: 101.6366 }

describe('weights', () => {
  test('approved weights add up to 100', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100)
  })
})

describe('mandatory filters', () => {
  test('tutor must teach the subject', () => {
    expect(isEligible(tutor(), { ...base, subject: 'English' })).toBe(false)
  })
  test('child grade must be inside the tutor range', () => {
    expect(isEligible(tutor(), { ...base, grade: 2 })).toBe(false)
    expect(isEligible(tutor(), { ...base, grade: 6 })).toBe(true)
  })
  test('level must match', () => {
    expect(isEligible(tutor(), { ...base, level: 'SECONDARY', grade: 2 })).toBe(false)
  })
  test('ineligible tutors are not ranked at all', () => {
    expect(rankTutors([tutor()], { ...base, subject: 'Chinese' })).toEqual([])
  })
})

describe('scoring', () => {
  test('a perfect fit scores high and explains why', () => {
    const m = scoreTutor(tutor(), { ...base, days: [1], timeStart: '18:00', timeEnd: '20:00', mode: 'PHYSICAL', budgetMax: 60, characteristics: ['Structured'] })
    expect(m.score).toBeGreaterThanOrEqual(90)
    expect(m.reasons).toEqual(expect.arrayContaining(['Available on your preferred days', 'Within your budget', 'Matches your preferred teaching style']))
  })

  test('unavailable on the preferred day lowers the score', () => {
    const good = scoreTutor(tutor(), { ...base, days: [1] })
    const bad = scoreTutor(tutor(), { ...base, days: [3] })
    expect(good.score).toBeGreaterThan(bad.score)
    // availability is worth 15 points
    expect(good.score - bad.score).toBeLessThanOrEqual(WEIGHTS.availability)
  })

  test('a tutor free that day but at the wrong time gets partial credit', () => {
    const wrongTime = scoreTutor(tutor(), { ...base, days: [1], timeStart: '08:00', timeEnd: '10:00' })
    const noDay = scoreTutor(tutor(), { ...base, days: [3], timeStart: '08:00', timeEnd: '10:00' })
    const rightTime = scoreTutor(tutor(), { ...base, days: [1], timeStart: '18:00', timeEnd: '20:00' })
    expect(rightTime.parts.availability).toBe(1)
    expect(wrongTime.parts.availability).toBe(0.5)
    expect(noDay.parts.availability).toBe(0)
  })

  test('nearer physical tutors score higher on location', () => {
    const near = scoreTutor(tutor(), { ...base, mode: 'PHYSICAL' })
    const far = scoreTutor(tutor({ latitude: 2.8167, longitude: 101.5 }), { ...base, mode: 'PHYSICAL' }) // Banting
    expect(near.parts.location).toBeGreaterThan(far.parts.location)
  })

  test('online-only tutors cannot satisfy a physical request', () => {
    expect(scoreTutor(tutor({ offersPhysical: false }), { ...base, mode: 'PHYSICAL' }).parts.location).toBe(0)
  })

  test('budget is a preference: above budget decays but does not exclude', () => {
    const over = scoreTutor(tutor({ hourlyRate: 70 }), { ...base, budgetMax: 50 })
    expect(over).not.toBeNull()
    expect(over.parts.fee).toBeLessThan(1)
    expect(scoreTutor(tutor({ hourlyRate: 45 }), { ...base, budgetMax: 50 }).parts.fee).toBe(1)
  })

  test('gender preference is soft, not a hard filter', () => {
    const m = scoreTutor(tutor({ gender: 'MALE' }), { ...base, gender: 'FEMALE' })
    expect(m).not.toBeNull()
    expect(m.parts.characteristics).toBe(0)
  })

  test('preferences left blank do not reduce the score', () => {
    const m = scoreTutor(tutor(), base)
    expect(m.parts.availability).toBe(1)
    expect(m.parts.characteristics).toBe(1)
    expect(m.parts.fee).toBe(1)
  })

  test('new tutors without reviews get a neutral rating score', () => {
    expect(scoreTutor(tutor({ ratingCount: 0, ratingAvg: 0 }), base).parts.rating).toBe(0.6)
  })
})

describe('ranking', () => {
  test('higher score first', () => {
    const a = tutor({ id: 1, ratingAvg: 3.0 })
    const b = tutor({ id: 2, ratingAvg: 5.0 })
    expect(rankTutors([a, b], base).map((x) => x.tutor.id)).toEqual([2, 1])
  })

  test('ties are broken by approved qualifications, then experience', () => {
    const a = tutor({ id: 1, qualifications: [], yearsExperience: 4 })
    const b = tutor({ id: 2, qualifications: [{ status: 'APPROVED' }, { status: 'APPROVED' }], yearsExperience: 4 })
    // identical score inputs except qualifications (not scored) => qualification count decides
    const ranked = rankTutors([a, b], base)
    expect(ranked[0].match.score).toBe(ranked[1].match.score)
    expect(ranked[0].tutor.id).toBe(2)
  })
})

describe('distance', () => {
  test('Kepong to Banting is roughly 45-55 km', () => {
    const km = distanceKm(3.2087, 101.6366, 2.8167, 101.5)
    expect(km).toBeGreaterThan(40)
    expect(km).toBeLessThan(60)
  })
  test('returns null when coordinates are missing', () => {
    expect(distanceKm(null, null, 1, 1)).toBeNull()
  })
})
