import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { CHARACTERISTICS, MAX_GRADE, SUBJECTS, findLocation } from '../../data/catalog.js'
import { hhmm as hhmmRule, id, optionalText } from '../../utils/validators.js'
import { rankTutors } from '../../services/matching.service.js'
import { toTutorCard } from '../../services/tutor.service.js'
import { activeTutors } from './tutors.controller.js'

const hhmm = hhmmRule()

// What the wizard and the chatbot both collect. Only subject + level are mandatory (FR 2.x).
export const criteriaSchema = z.object({
  childId: id('Child').optional().nullable(),
  subject: z.enum(SUBJECTS, { message: 'Subject is required' }),
  level: z.enum(['KINDERGARTEN', 'PRIMARY', 'SECONDARY'], { message: 'Education level is required' }),
  grade: z.number().int().min(1, 'Choose a grade').optional().nullable(),
  // Duplicates are dropped so a day cannot be counted twice in the availability score
  days: z.array(z.number().int().min(0).max(6)).max(7).default([]).transform((d) => [...new Set(d)]),
  timeStart: hhmm.optional().nullable(),
  timeEnd: hhmm.optional().nullable(),
  mode: z.enum(['ONLINE', 'PHYSICAL', 'EITHER']).default('EITHER'),
  location: z.string().trim().max(100).optional().nullable(),
  budgetMin: z.number().min(0).max(1000, 'Budget cannot be more than RM1000').optional().nullable(),
  budgetMax: z.number().min(0).max(1000, 'Budget cannot be more than RM1000').optional().nullable(),
  gender: z.enum(['MALE', 'FEMALE', 'ANY']).default('ANY'),
  characteristics: z.array(z.enum(CHARACTERISTICS)).max(CHARACTERISTICS.length).default([]),
  notes: optionalText(200, 'Notes'),
})
  // Rules between fields, each reported on the field the parent has to change
  .refine((c) => !c.grade || c.grade <= MAX_GRADE[c.level], { message: 'That grade does not exist for the chosen level', path: ['grade'] })
  .refine((c) => !(c.timeStart && c.timeEnd) || c.timeStart < c.timeEnd, { message: 'The end time must be after the start time', path: ['timeEnd'] })
  .refine((c) => c.budgetMin == null || c.budgetMax == null || c.budgetMin <= c.budgetMax, { message: 'The minimum budget cannot be more than the maximum', path: ['budgetMax'] })

async function runMatching(criteria, parentId) {
  const loc = criteria.location ? findLocation(criteria.location) : null
  const c = { ...criteria, lat: loc?.lat, lng: loc?.lng, grade: criteria.grade ?? undefined, budgetMax: criteria.budgetMax ?? undefined }
  const tutors = await activeTutors(c.subject, c.level)
  const ranked = rankTutors(tutors, c)
  const favourites = new Set(
    (await prisma.favouriteTutor.findMany({ where: { parentId }, select: { tutorId: true } })).map((f) => f.tutorId),
  )
  return ranked.map(({ tutor, match }) => ({
    ...toTutorCard(tutor, c.subject),
    isFavourite: favourites.has(tutor.id),
    match: { score: match.score, label: match.label, reasons: match.reasons, distanceKm: match.distanceKm },
  }))
}

// POST /parent/matching: run the matching and save the search for traceability (MatchingRequest)
export async function createMatching(req, res) {
  const { source = 'WIZARD', criteria: raw } = z
    .object({ source: z.enum(['WIZARD', 'CHATBOT']).optional(), criteria: criteriaSchema })
    .parse(req.body)

  // childId must be one of this parent's children
  const childId = raw.childId
    ? (await prisma.child.findFirst({ where: { id: raw.childId, parentId: req.parent.id } }))?.id ?? null
    : null

  const results = await runMatching(raw, req.parent.id)
  const saved = await prisma.matchingRequest.create({
    data: {
      parentId: req.parent.id,
      childId,
      source,
      criteria: raw,
      results: results.map((r) => ({ tutorId: r.id, score: r.match.score, reasons: r.match.reasons })),
    },
  })
  res.status(201).json({ id: saved.id, criteria: raw, total: results.length, tutors: results })
}

// GET /parent/matching/latest: "Continue where you left off" (re-run so ratings/availability are fresh)
export async function latestMatching(req, res) {
  const last = await prisma.matchingRequest.findFirst({ where: { parentId: req.parent.id }, orderBy: { createdAt: 'desc' } })
  if (!last) return res.json({ matching: null })
  const criteria = criteriaSchema.safeParse(last.criteria)
  if (!criteria.success) return res.json({ matching: null })
  const tutors = await runMatching(criteria.data, req.parent.id)
  res.json({ matching: { id: last.id, criteria: criteria.data, total: tutors.length, tutors, createdAt: last.createdAt } })
}
