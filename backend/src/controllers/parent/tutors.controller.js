import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { CHARACTERISTICS, LOCATIONS, MAX_GRADE, SUBJECTS, findLocation } from '../../data/catalog.js'
import { rankTutors, distanceKm } from '../../services/matching.service.js'
import { tutorInclude, toTutorCard, toTutorProfile } from '../../services/tutor.service.js'
import { SLOT_BLOCKING, getTutorSlots } from '../../services/booking.service.js'
import { addDays, mondayOf, mytParts, mytToDate, toMinutes, todayMyt } from '../../utils/time.js'
import { preferencesToCriteria } from '../../utils/preferences.js'
import { hhmm, ymd } from '../../utils/validators.js'

// GET /parent/catalog: option lists for the filter bar, wizard and chatbot
export function catalog(req, res) {
  res.json({
    subjects: SUBJECTS,
    maxGrade: MAX_GRADE,
    characteristics: CHARACTERISTICS,
    locations: LOCATIONS.map((l) => l.name),
    // The parent's saved address, used as the default "Location" filter when it is a known area
    homeLocation: LOCATIONS.some((l) => l.name === req.parent.address) ? req.parent.address : null,
    // Saved signup/profile preferences: the matching wizard starts from these
    preferences: req.parent.preferences ?? null,
  })
}

// Query params -> matching criteria (also the browse filter set)
const browseSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(60),
  level: z.enum(['KINDERGARTEN', 'PRIMARY', 'SECONDARY'], { message: 'Education level is required' }),
  grade: z.coerce.number().int().min(1).optional(),
  location: z.string().trim().max(100).optional(),
  date: ymd().optional(),
  time: hhmm().optional(),
  mode: z.enum(['ONLINE', 'PHYSICAL']).optional(),
  minPrice: z.coerce.number().min(0).max(1000).optional(),
  maxPrice: z.coerce.number().min(0).max(1000).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  days: z.string().regex(/^[0-6](,[0-6])*$/, 'Invalid days').optional(), // "1,3,5" (0 = Sunday)
  maxDistance: z.coerce.number().positive().max(500).optional(), // km
  characteristics: z.string().max(200).optional() // "Structured,Interactive"
    .refine((s) => !s || s.split(',').every((c) => CHARACTERISTICS.includes(c)), 'Unknown teaching style'),
  sort: z.enum(['recommended', 'price_asc', 'price_desc', 'rating', 'experience', 'nearest']).default('recommended'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(30).default(9),
})
  .refine((q) => !q.grade || q.grade <= MAX_GRADE[q.level], { message: 'That grade does not exist for the chosen level', path: ['grade'] })
  .refine((q) => q.minPrice == null || q.maxPrice == null || q.minPrice <= q.maxPrice, { message: 'The minimum price cannot be more than the maximum', path: ['maxPrice'] })

// Tutors whose account is active and who teach the subject at the level (the DB-side part of the mandatory filter)
export async function activeTutors(subject, level) {
  return prisma.tutorProfile.findMany({
    where: {
      user: { status: 'ACTIVE' },
      subjects: { some: { subject, educationLevel: level } },
    },
    include: tutorInclude,
  })
}

// Which of these tutors are free for a 1-hour lesson at date+time? (date & time filter on the search bar)
// One query for the clashing bookings of all candidates, instead of one query per tutor.
async function freeAt(tutors, date, time) {
  const start = mytToDate(date, time)
  const end = new Date(start.getTime() + 3600000)
  if (start <= new Date()) return new Set()
  const { dow } = mytParts(start)
  const covering = tutors.filter((t) =>
    t.availability.some((a) => a.dayOfWeek === dow && toMinutes(a.startTime) <= toMinutes(time) && toMinutes(a.endTime) >= toMinutes(time) + 60),
  )
  const busy = await prisma.booking.findMany({
    where: { tutorId: { in: covering.map((t) => t.id) }, status: { in: SLOT_BLOCKING }, startAt: { lt: end }, endAt: { gt: start } },
    select: { tutorId: true },
  })
  const busyIds = new Set(busy.map((b) => b.tutorId))
  return new Set(covering.filter((t) => !busyIds.has(t.id)).map((t) => t.id))
}

// GET /parent/tutors: browse + filter + sort + page
//
// Two different jobs, kept separate on purpose:
//  - FILTERS (subject, level, and anything the parent picks in the filter bar) decide WHO is shown.
//  - The RECOMMENDATION score decides the ORDER. Besides the search itself it uses the parent's saved
//    preferences (gender, teaching style, days, time of day, budget, teaching mode) and their home area,
//    as soft criteria in the approved weighted score. So two parents searching the same subject can see a
//    different order, and every card carries its own match %, label and "why we recommend" reasons.
export async function browseTutors(req, res) {
  const q = browseSchema.parse(req.query)
  const loc = q.location ? findLocation(q.location) : null
  const prefs = preferencesToCriteria(req.parent.preferences)
  const explicitDays = q.days ? q.days.split(',').map(Number) : []
  const explicitStyles = q.characteristics ? q.characteristics.split(',') : []

  // What the search asked for wins; otherwise the saved preference is used (for scoring only)
  const criteria = {
    ...prefs,
    subject: q.subject,
    level: q.level,
    grade: q.grade,
    lat: loc?.lat ?? req.parent.latitude ?? undefined,
    lng: loc?.lng ?? req.parent.longitude ?? undefined,
    mode: q.mode || prefs.mode || 'EITHER',
    days: explicitDays.length ? explicitDays : prefs.days || [],
    characteristics: explicitStyles.length ? explicitStyles : prefs.characteristics || [],
    budgetMax: q.maxPrice ?? prefs.budgetMax ?? null,
  }

  const tutors = await activeTutors(q.subject, q.level)
  // Mandatory filters (subject + level/grade) + weighted score, best match first
  let ranked = rankTutors(tutors, criteria)

  // Hard filters: only what the parent explicitly chose in the filter bar
  ranked = ranked.filter(({ tutor }) => {
    const rate = Number(tutor.hourlyRate)
    if (q.minPrice != null && rate < q.minPrice) return false
    if (q.maxPrice != null && rate > q.maxPrice) return false
    if (q.minRating != null && tutor.ratingAvg < q.minRating) return false
    if (q.mode === 'ONLINE' && !tutor.offersOnline) return false
    if (q.mode === 'PHYSICAL' && !tutor.offersPhysical) return false
    if (explicitDays.length && !explicitDays.some((d) => tutor.availability.some((a) => a.dayOfWeek === d))) return false
    if (explicitStyles.length && !explicitStyles.some((c) => (tutor.characteristics || []).includes(c))) return false
    if (q.maxDistance != null && loc && tutor.offersPhysical && !tutor.offersOnline) {
      const km = distanceKm(loc.lat, loc.lng, tutor.latitude, tutor.longitude)
      if (km != null && km > q.maxDistance) return false
    }
    return true
  })

  if (q.date && q.time) {
    const free = await freeAt(ranked.map((r) => r.tutor), q.date, q.time)
    ranked = ranked.filter(({ tutor }) => free.has(tutor.id))
  }

  // "Recommended" keeps the score order; the other sorts re-order the same list (ties fall back to the score)
  const byFn = {
    price_asc: (a, b) => Number(a.tutor.hourlyRate) - Number(b.tutor.hourlyRate),
    price_desc: (a, b) => Number(b.tutor.hourlyRate) - Number(a.tutor.hourlyRate),
    rating: (a, b) => b.tutor.ratingAvg - a.tutor.ratingAvg,
    experience: (a, b) => b.tutor.yearsExperience - a.tutor.yearsExperience,
    nearest: (a, b) => (a.match.distanceKm ?? 999) - (b.match.distanceKm ?? 999),
  }[q.sort]
  if (byFn) ranked = ranked.map((r, i) => ({ ...r, i })).sort((a, b) => byFn(a, b) || a.i - b.i)

  // Page of results. A page past the end returns the last page instead of an empty list.
  const total = ranked.length
  const totalPages = Math.max(1, Math.ceil(total / q.pageSize))
  const page = Math.min(q.page, totalPages)
  const pageRows = ranked.slice((page - 1) * q.pageSize, page * q.pageSize)

  const favourites = new Set(
    (await prisma.favouriteTutor.findMany({ where: { parentId: req.parent.id }, select: { tutorId: true } })).map((f) => f.tutorId),
  )

  // Tell the parent what the order is based on (explainability)
  const p = req.parent.preferences
  const basis = []
  if (loc) basis.push(`distance from ${q.location}`)
  else if (req.parent.latitude != null && req.parent.address) basis.push(`distance from your home area (${req.parent.address})`)
  if (p && (p.gender !== 'ANY' || p.characteristics?.length || p.days?.length || p.timePreset || p.budgetMax != null || p.mode !== 'EITHER')) basis.push('your saved preferences')

  res.json({
    total,
    page,
    pageSize: q.pageSize,
    totalPages,
    rankedBy: basis,
    tutors: pageRows.map(({ tutor, match }) => ({
      ...toTutorCard(tutor, q.subject),
      isFavourite: favourites.has(tutor.id),
      distanceKm: match.distanceKm,
      match: { score: match.score, label: match.label, reasons: match.reasons },
    })),
  })
}

// GET /parent/tutors/:id: public profile
export async function getTutor(req, res) {
  const id = Number(req.params.id)
  const tutor = await prisma.tutorProfile.findFirst({
    where: { id, user: { status: 'ACTIVE' } },
    include: tutorInclude,
  })
  if (!tutor) throw new AppError(404, 'Tutor not found')

  const [grouped, fav, week] = await Promise.all([
    prisma.review.groupBy({ by: ['rating'], where: { tutorId: id }, _count: { _all: true } }),
    prisma.favouriteTutor.findUnique({ where: { parentId_tutorId: { parentId: req.parent.id, tutorId: id } } }),
    getTutorSlots(id, todayMyt(), 7),
  ])
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: grouped.find((g) => g.rating === stars)?._count._all ?? 0,
  }))

  res.json({
    tutor: toTutorProfile(tutor, { isFavourite: Boolean(fav), ratingDistribution: distribution, upcomingAvailability: week }),
  })
}

const levelWord = { KINDERGARTEN: 'Kindergarten', PRIMARY: 'Primary', SECONDARY: 'Form' }

// GET /parent/tutors/:id/reviews?sort=recent|highest|lowest&page=1
export async function tutorReviews(req, res) {
  const tutorId = Number(req.params.id)
  const sort = z.enum(['recent', 'highest', 'lowest']).default('recent').parse(req.query.sort)
  const page = Math.max(1, Number(req.query.page) || 1)
  const take = 5
  const orderBy = { recent: { createdAt: 'desc' }, highest: { rating: 'desc' }, lowest: { rating: 'asc' } }[sort]
  const [total, reviews] = await Promise.all([
    prisma.review.count({ where: { tutorId } }),
    prisma.review.findMany({
      where: { tutorId },
      orderBy,
      skip: (page - 1) * take,
      take,
      include: { parent: { include: { user: { select: { fullName: true } } } }, booking: { include: { child: true } } },
    }),
  ])
  res.json({
    total,
    hasMore: page * take < total,
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      parentName: r.parent.user.fullName,
      // "Parent of Primary 5 student": shown instead of the child's name to protect the child's privacy
      parentOf: `${levelWord[r.booking.child.educationLevel]} ${r.booking.child.grade} student`,
    })),
  })
}

// GET /parent/tutors/:id/slots?from=YYYY-MM-DD: 7-day grid for the Book a Lesson page
export async function tutorSlots(req, res) {
  const id = Number(req.params.id)
  const exists = await prisma.tutorProfile.findFirst({ where: { id, user: { status: 'ACTIVE' } }, select: { id: true } })
  if (!exists) throw new AppError(404, 'Tutor not found')
  const from = ymd().default(mondayOf(todayMyt())).parse(req.query.from)
  res.json({ from, to: addDays(from, 6), days: await getTutorSlots(id, from, 7) })
}

// POST /parent/favourites/:tutorId: toggle
// GET /parent/favourites: the parent's saved tutors (deactivated tutors are left out)
export async function listFavourites(req, res) {
  const rows = await prisma.favouriteTutor.findMany({
    where: { parentId: req.parent.id, tutor: { user: { status: 'ACTIVE' } } },
    include: { tutor: { include: tutorInclude } },
  })
  const tutors = rows.map((r) => ({ ...toTutorCard(r.tutor), isFavourite: true })).sort((a, b) => a.name.localeCompare(b.name))
  res.json({ total: tutors.length, tutors })
}

export async function toggleFavourite(req, res) {
  const tutorId = Number(req.params.tutorId)
  const key = { parentId_tutorId: { parentId: req.parent.id, tutorId } }
  // deleteMany (not delete) so a double click that already removed it is not an error
  const removed = await prisma.favouriteTutor.deleteMany({ where: { parentId: req.parent.id, tutorId } })
  if (removed.count) return res.json({ isFavourite: false })
  const tutor = await prisma.tutorProfile.findFirst({ where: { id: tutorId, user: { status: 'ACTIVE' } }, select: { id: true } })
  if (!tutor) throw new AppError(404, 'Tutor not found')
  // upsert: if a second click saved it a moment ago, it simply stays saved
  await prisma.favouriteTutor.upsert({ where: key, update: {}, create: { parentId: req.parent.id, tutorId } })
  res.json({ isFavourite: true })
}
