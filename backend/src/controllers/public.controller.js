import { prisma } from '../config/prisma.js'
import { SUBJECTS, LOCATIONS } from '../data/catalog.js'
import { tutorInclude, toTutorCard } from '../services/tutor.service.js'

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
    locations: LOCATIONS.map((l) => l.name),
  })
}
