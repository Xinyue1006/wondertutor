import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { CHARACTERISTICS, LOCATIONS, MAX_GRADE, SUBJECTS, findLocation } from '../../data/catalog.js'
import { rankTutors, distanceKm } from '../../services/matching.service.js'
import { tutorInclude, toTutorCard, toTutorProfile } from '../../services/tutor.service.js'
import { getTutorSlots } from '../../services/booking.service.js'
import { addDays, mondayOf, mytParts, mytToDate, toMinutes, todayMyt } from '../../utils/time.js'

// GET /parent/catalog: option lists for the filter bar, wizard and chatbot
export function catalog(req, res) {
  res.json({
    subjects: SUBJECTS,
    maxGrade: MAX_GRADE,
    characteristics: CHARACTERISTICS,
    locations: LOCATIONS.map((l) => l.name),
    // The parent's saved address, used as the default "Location" filter when it is a known area
    homeLocation: LOCATIONS.some((l) => l.name === req.parent.address) ? req.parent.address : null,
  })
}

// Query params -> matching criteria (also the browse filter set)
const browseSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  level: z.enum(['KINDERGARTEN', 'PRIMARY', 'SECONDARY'], { message: 'Education level is required' }),
  grade: z.coerce.number().int().optional(),
  location: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  mode: z.enum(['ONLINE', 'PHYSICAL']).optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  minRating: z.coerce.number().optional(),
  days: z.string().optional(), // "1,3,5" (0 = Sunday)
  maxDistance: z.coerce.number().optional(), // km
  characteristics: z.string().optional(), // "Structured,Interactive"
  sort: z.enum(['recommended', 'price_asc', 'price_desc', 'rating', 'experience', 'nearest']).default('recommended'),
})

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

// Is the tutor free for a 1-hour lesson at date+time? (date & time filter on the search bar)
async function isFreeAt(tutor, date, time) {
  const start = mytToDate(date, time)
  const end = new Date(start.getTime() + 3600000)
  const { dow } = mytParts(start)
  const covers = tutor.availability.some(
    (a) => a.dayOfWeek === dow && toMinutes(a.startTime) <= toMinutes(time) && toMinutes(a.endTime) >= toMinutes(time) + 60,
  )
  if (!covers) return false
  const clash = await prisma.booking.findFirst({
    where: { tutorId: tutor.id, status: { in: ['AWAITING_PAYMENT', 'CONFIRMED'] }, startAt: { lt: end }, endAt: { gt: start } },
  })
  return !clash
}

// GET /parent/tutors: browse + filter + sort
export async function browseTutors(req, res) {
  const q = browseSchema.parse(req.query)
  const loc = q.location ? findLocation(q.location) : null
  const criteria = {
    subject: q.subject,
    level: q.level,
    grade: q.grade,
    lat: loc?.lat,
    lng: loc?.lng,
    mode: q.mode || 'EITHER',
    days: q.days ? q.days.split(',').map(Number) : [],
    characteristics: q.characteristics ? q.characteristics.split(',') : [],
  }

  const tutors = await activeTutors(q.subject, q.level)
  // Mandatory filters + weighted score. Browse "Recommended" sorting reuses the matching service.
  let ranked = rankTutors(tutors, criteria)

  ranked = ranked.filter(({ tutor }) => {
    const rate = Number(tutor.hourlyRate)
    if (q.minPrice != null && rate < q.minPrice) return false
    if (q.maxPrice != null && rate > q.maxPrice) return false
    if (q.minRating != null && tutor.ratingAvg < q.minRating) return false
    if (q.mode === 'ONLINE' && !tutor.offersOnline) return false
    if (q.mode === 'PHYSICAL' && !tutor.offersPhysical) return false
    if (criteria.days.length && !criteria.days.some((d) => tutor.availability.some((a) => a.dayOfWeek === d))) return false
    if (criteria.characteristics.length && !criteria.characteristics.some((c) => (tutor.characteristics || []).includes(c))) return false
    if (q.maxDistance != null && loc && tutor.offersPhysical && !tutor.offersOnline) {
      const km = distanceKm(loc.lat, loc.lng, tutor.latitude, tutor.longitude)
      if (km != null && km > q.maxDistance) return false
    }
    return true
  })

  if (q.date && q.time) {
    const free = await Promise.all(ranked.map(({ tutor }) => isFreeAt(tutor, q.date, q.time)))
    ranked = ranked.filter((_, i) => free[i])
  }

  // "Recommended for your child" = the two strongest matches for the current filters (and at least 80%)
  const recommendedIds = new Set(ranked.filter(({ match }) => match.score >= 80).slice(0, 2).map(({ tutor }) => tutor.id))

  const byFn = {
    price_asc: (a, b) => Number(a.tutor.hourlyRate) - Number(b.tutor.hourlyRate),
    price_desc: (a, b) => Number(b.tutor.hourlyRate) - Number(a.tutor.hourlyRate),
    rating: (a, b) => b.tutor.ratingAvg - a.tutor.ratingAvg,
    experience: (a, b) => b.tutor.yearsExperience - a.tutor.yearsExperience,
    nearest: (a, b) => (a.match.distanceKm ?? 999) - (b.match.distanceKm ?? 999),
  }[q.sort]
  if (byFn) ranked.sort(byFn)

  const favourites = new Set(
    (await prisma.favouriteTutor.findMany({ where: { parentId: req.parent.id }, select: { tutorId: true } })).map((f) => f.tutorId),
  )

  res.json({
    total: ranked.length,
    tutors: ranked.map(({ tutor, match }) => ({
      ...toTutorCard(tutor, q.subject),
      isFavourite: favourites.has(tutor.id),
      recommended: recommendedIds.has(tutor.id),
      distanceKm: match.distanceKm,
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
  const from = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(mondayOf(todayMyt())).parse(req.query.from)
  res.json({ from, to: addDays(from, 6), days: await getTutorSlots(id, from, 7) })
}

// POST /parent/favourites/:tutorId: toggle
export async function toggleFavourite(req, res) {
  const tutorId = Number(req.params.tutorId)
  const key = { parentId_tutorId: { parentId: req.parent.id, tutorId } }
  const existing = await prisma.favouriteTutor.findUnique({ where: key })
  if (existing) {
    await prisma.favouriteTutor.delete({ where: key })
    return res.json({ isFavourite: false })
  }
  const tutor = await prisma.tutorProfile.findUnique({ where: { id: tutorId } })
  if (!tutor) throw new AppError(404, 'Tutor not found')
  await prisma.favouriteTutor.create({ data: { parentId: req.parent.id, tutorId } })
  res.json({ isFavourite: true })
}
