import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { SUBJECTS, SUBJECT_LEVELS, LOCATIONS } from '../data/catalog.js'
import { tutorInclude, toTutorCard } from '../services/tutor.service.js'
import { STATES, placesInfo, searchPlaces } from '../services/places.service.js'

// GET /public/home: data for the landing page (no login needed). Only public facts:
// the top-rated active tutors (same card shape as the browse page) plus the dropdown lists.
export async function homeData(req, res) {
  const rows = await prisma.tutorProfile.findMany({
    where: { user: { status: 'ACTIVE' }, ratingCount: { gt: 0 } },
    include: tutorInclude,
    orderBy: [{ ratingAvg: 'desc' }, { ratingCount: 'desc' }],
    take: 4,
  })
  res.json({
    tutors: rows.map((t) => toTutorCard(t)),
    subjects: SUBJECTS,
    subjectLevels: SUBJECT_LEVELS,
    locations: LOCATIONS.map((l) => l.name),
  })
}

// GET /public/places?q=kepong&state=Selangor&limit=8: the area picker. Search by town, neighbourhood or postcode; with
// nothing typed it returns the popular places to start from. Public (no login), because the sign-up form uses it too.
// Only labels come back: the coordinates stay on the server and are looked up from the label when it is saved.
const placesQuery = z.object({
  q: z.string().trim().max(60, 'Search text is too long').optional(),
  state: z.enum(STATES, { message: 'Unknown state' }).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
})
export function places(req, res) {
  const { q, state, limit } = placesQuery.parse(req.query)
  res.json({ popular: !q, results: searchPlaces(q, { state, limit }), states: STATES, source: placesInfo.source })
}
