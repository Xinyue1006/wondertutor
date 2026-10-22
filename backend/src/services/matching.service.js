// Rule-based tutor matching (NOT machine learning).
//
// Step 1 — mandatory filters: the tutor must teach the subject AND the child's grade must fall
//          inside the tutor's range for that subject/level.
// Step 2 — weighted score using the criteria and weights approved in Form 2.
// Step 3 — every score is returned with human-readable reasons ("why we recommend this tutor"),
//          because the client asked for explainability, not just a number.
//
// The functions are pure (no DB access) so they can be unit-tested and reused by the browse page,
// the 3-step wizard and the chatbot.

import { toMinutes } from '../utils/time.js'

// Approved weights (must add up to 100)
export const WEIGHTS = {
  subject: 30,
  level: 20,
  availability: 15,
  location: 15,
  characteristics: 10,
  fee: 5,
  rating: 5,
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LEVEL_LABEL = { KINDERGARTEN: 'Kindergarten', PRIMARY: 'Primary', SECONDARY: 'Secondary' }
const MAX_GRADE = { KINDERGARTEN: 3, PRIMARY: 6, SECONDARY: 5 }

export function gradeLabel(level, grade) {
  if (level === 'KINDERGARTEN') return `Kindergarten ${grade}`
  return `${LEVEL_LABEL[level]} ${grade}`
}

// Great-circle distance in km (haversine)
export function distanceKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v == null)) return null
  const rad = (d) => (d * Math.PI) / 180
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

// A place is known to within a few kilometres (a postcode or a town, not a street), so a distance is said as a band,
// "within 8 km", never as an exact "5.3 km". The limits are the same ones the score uses just below.
export const DISTANCE_BANDS = [3, 8, 15, 30]
export function distanceBand(km) {
  if (km == null) return null
  const limit = DISTANCE_BANDS.find((b) => km <= b)
  return limit ? `within ${limit} km` : 'more than 30 km away'
}

// ───────────── Step 1: mandatory filters ─────────────

// The TutorSubject row that satisfies subject + level (+ grade). Returns undefined if none.
export function matchingSubjectRow(tutor, c) {
  return tutor.subjects.find(
    (s) =>
      s.subject === c.subject &&
      s.educationLevel === c.level &&
      (c.grade == null || (c.grade >= s.minGrade && c.grade <= s.maxGrade)),
  )
}

export const isEligible = (tutor, c) => Boolean(matchingSubjectRow(tutor, c))

// ───────────── Step 2: individual criteria (each returns 0..1) ─────────────

// Subject expertise: teaching the subject is the baseline; years of experience and a verified
// qualification make a tutor more of a specialist.
function subjectScore(tutor) {
  const years = Math.min(tutor.yearsExperience / 6, 1)
  return 0.5 + 0.3 * years + 0.2 * (tutor.isVerified ? 1 : 0)
}

// Education level: inside the range is guaranteed by the filter, so reward specialisation —
// a tutor focused on a narrow range of grades scores higher than a "teaches everything" tutor.
function levelScore(row, c) {
  const span = row.maxGrade - row.minGrade + 1
  const maxSpan = MAX_GRADE[c.level]
  return 0.75 + 0.25 * (1 - (span - 1) / Math.max(maxSpan - 1, 1))
}

// Availability: for every preferred day, 1 if the tutor has a slot overlapping the preferred time window
// for at least one lesson hour, 0.5 if free that day but at another time, 0 otherwise.
function availabilityScore(tutor, c) {
  if (!c.days?.length) return { value: 1, matchedDays: [], total: 0 }
  const ws = c.timeStart ? toMinutes(c.timeStart) : 0
  const we = c.timeEnd ? toMinutes(c.timeEnd) : 24 * 60
  let sum = 0
  const matchedDays = []
  for (const day of c.days) {
    const slots = tutor.availability.filter((s) => s.dayOfWeek === day)
    if (!slots.length) continue
    const overlap = Math.max(
      ...slots.map((s) => Math.min(we, toMinutes(s.endTime)) - Math.max(ws, toMinutes(s.startTime))),
    )
    if (!c.timeStart || overlap >= 60) {
      sum += 1
      matchedDays.push(day)
    } else {
      sum += 0.5
    }
  }
  return { value: sum / c.days.length, matchedDays, total: c.days.length }
}

// Location: distance from the preferred area to the tutor's area. Online tutors are
// location-independent. Physical lessons need a tutor who offers them.
function locationScore(tutor, c) {
  const mode = c.mode || 'EITHER'
  const km = c.lat != null ? distanceKm(c.lat, c.lng, tutor.latitude, tutor.longitude) : null
  const byDistance =
    km == null ? 0.6 : km <= 3 ? 1 : km <= 8 ? 0.8 : km <= 15 ? 0.55 : km <= 30 ? 0.3 : 0.1
  if (mode === 'ONLINE') return { value: tutor.offersOnline ? 1 : 0, km }
  if (mode === 'PHYSICAL') return { value: tutor.offersPhysical ? byDistance : 0, km }
  // EITHER: online is an acceptable fallback, but a nearby physical tutor is still the best fit
  const online = tutor.offersOnline ? 0.7 : 0
  const physical = tutor.offersPhysical ? byDistance : 0
  return { value: Math.max(online, physical), km }
}

// Tutor characteristics: gender, teaching style. Parts the parent didn't specify are ignored.
function characteristicsScore(tutor, c) {
  const parts = []
  let genderMatch = false
  if (c.gender && c.gender !== 'ANY') {
    genderMatch = tutor.gender === c.gender
    parts.push(genderMatch ? 1 : 0)
  }
  let styleMatches = []
  if (c.characteristics?.length) {
    const own = tutor.characteristics || []
    styleMatches = c.characteristics.filter((x) => own.includes(x))
    parts.push(styleMatches.length / c.characteristics.length)
  }
  const value = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 1
  return { value, genderMatch, styleMatches }
}

// Fee: full marks inside the budget; above budget the score decays; budget is a preference, not a hard limit
function feeScore(tutor, c) {
  const rate = Number(tutor.hourlyRate)
  if (c.budgetMax == null) return { value: 1, within: false }
  if (rate <= c.budgetMax) return { value: 1, within: true }
  return { value: Math.max(0, 1 - (rate - c.budgetMax) / c.budgetMax), within: false }
}

// Rating: tutors with no reviews yet get a neutral score so new tutors aren't buried
function ratingScore(tutor) {
  return tutor.ratingCount > 0 ? tutor.ratingAvg / 5 : 0.6
}

// ───────────── Step 3: total + reasons ─────────────

export function scoreTutor(tutor, c) {
  const row = matchingSubjectRow(tutor, c)
  if (!row) return null

  const avail = availabilityScore(tutor, c)
  const loc = locationScore(tutor, c)
  const chars = characteristicsScore(tutor, c)
  const fee = feeScore(tutor, c)

  const parts = {
    subject: subjectScore(tutor),
    level: levelScore(row, c),
    availability: avail.value,
    location: loc.value,
    characteristics: chars.value,
    fee: fee.value,
    rating: ratingScore(tutor),
  }

  let total = 0
  for (const key of Object.keys(WEIGHTS)) total += parts[key] * WEIGHTS[key]
  const score = Math.round(total)

  // Reasons, strongest contribution first. Only strengths are listed.
  const reasons = []
  const add = (weight, text) => reasons.push({ weight, text })

  if (parts.subject >= 0.7)
    add(parts.subject * WEIGHTS.subject, tutor.subjects.filter((s) => s.educationLevel === c.level).length <= 2
      ? `${c.subject} specialist` : `Experienced ${c.subject} tutor`)
  else add(parts.subject * WEIGHTS.subject, `Teaches ${c.subject}`)

  if (c.grade != null) add(parts.level * WEIGHTS.level, `${gradeLabel(c.level, c.grade)} experience`)

  if (c.days?.length && avail.matchedDays.length) {
    add(
      parts.availability * WEIGHTS.availability,
      avail.matchedDays.length === avail.total
        ? 'Available on your preferred days'
        : `Available on ${avail.matchedDays.length} of your ${avail.total} preferred days`,
    )
  }

  if (parts.location >= 0.55) {
    if (c.mode === 'ONLINE') add(parts.location * WEIGHTS.location, 'Offers online lessons')
    else if (loc.km != null && tutor.offersPhysical)
      add(parts.location * WEIGHTS.location, `Teaches ${distanceBand(loc.km)} of your area`)
    else if (tutor.offersOnline) add(parts.location * WEIGHTS.location, 'Offers online lessons')
  }

  if (chars.styleMatches.length) add(parts.characteristics * WEIGHTS.characteristics, 'Matches your preferred teaching style')
  if (chars.genderMatch) add(parts.characteristics * WEIGHTS.characteristics - 0.1, 'Matches your preferred tutor gender')
  if (fee.within) add(parts.fee * WEIGHTS.fee, 'Within your budget')
  if (tutor.ratingCount > 0 && tutor.ratingAvg >= 4.5) add(parts.rating * WEIGHTS.rating, 'Highly rated by parents')

  reasons.sort((a, b) => b.weight - a.weight)

  return {
    tutorId: tutor.id,
    score,
    label: score >= 88 ? 'Highly suitable' : score >= 70 ? 'Good match' : 'Fair match',
    parts,
    reasons: reasons.map((r) => r.text),
    distanceKm: loc.km == null ? null : Math.round(loc.km * 10) / 10,
  }
}

// Eligible tutors ranked by score. Verified tutors are listed before unverified ones (the score and its
// Form 2 weights stay the same; only the order changes). Ties: more approved qualifications, then more experience.
export function rankTutors(tutors, c) {
  return tutors
    .map((tutor) => ({ tutor, match: scoreTutor(tutor, c) }))
    .filter((x) => x.match)
    .sort(
      (a, b) =>
        Number(Boolean(b.tutor.isVerified)) - Number(Boolean(a.tutor.isVerified)) ||
        b.match.score - a.match.score ||
        approvedQualifications(b.tutor) - approvedQualifications(a.tutor) ||
        b.tutor.yearsExperience - a.tutor.yearsExperience,
    )
}

const approvedQualifications = (t) => (t.qualifications || []).filter((q) => q.status === 'APPROVED').length

export const dayName = (d) => DAY_NAMES[d]
