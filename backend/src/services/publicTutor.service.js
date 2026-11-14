// Anonymous visitors get only the information tutors publish for discovery.
// Account/identity evidence, family records and personalised matching stay private.
import { z } from 'zod'
import { prisma } from '../config/prisma.js'
import { MAX_GRADE, SUBJECTS, isSubjectAtLevel, findLocation } from '../data/catalog.js'
import { AppError } from '../utils/AppError.js'
import { toTutorCard, toTutorProfile } from './tutor.service.js'
import { distanceKm } from './matching.service.js'
import { groupTutorCandidates } from './tutorSearchScope.js'
import { getTutorSlots } from './booking.service.js'
import { todayMyt } from '../utils/time.js'
import { reviewContentProblem } from './reviewContent.js'

export const publicTutorWhere = {
  user: { status: 'ACTIVE', deletedAt: null },
  subjects: { some: {} },
  hourlyRate: { gt: 0 },
}

// Explicit selections avoid even loading identity documents or account secrets.
export const publicTutorInclude = {
  user: { select: { fullName: true, profilePhotoUrl: true, status: true } },
  subjects: true,
  availability: { select: { dayOfWeek: true, startTime: true, endTime: true } },
  qualifications: {
    where: { kind: 'QUALIFICATION', status: 'APPROVED' },
    select: { id: true, kind: true, title: true, institution: true, year: true, status: true },
  },
}

export const publicBrowseQuery = z.object({
  subject: z.enum(SUBJECTS).optional(),
  level: z.enum(['KINDERGARTEN', 'PRIMARY', 'SECONDARY']).optional(),
  grade: z.coerce.number().int().min(1).max(6).optional(),
  location: z.string().trim().max(100).optional(),
  mode: z.enum(['ONLINE', 'PHYSICAL']).optional(),
  minPrice: z.coerce.number().min(0).max(1000).optional(),
  maxPrice: z.coerce.number().min(0).max(1000).optional(),
  sort: z.enum(['recommended', 'price_asc', 'price_desc', 'rating', 'experience', 'nearest']).default('recommended'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(30).default(9),
})
  .refine(q => !q.grade || Boolean(q.level), { message: 'Choose an education level before a grade', path: ['grade'] })
  .refine(q => !q.grade || q.grade <= MAX_GRADE[q.level], { message: 'That grade does not exist for the chosen level', path: ['grade'] })
  .refine(q => !q.subject || !q.level || isSubjectAtLevel(q.subject, q.level), { message: 'That subject is not offered at this education level', path: ['subject'] })
  .refine(q => q.minPrice == null || q.maxPrice == null || q.minPrice <= q.maxPrice, { message: 'The minimum price cannot be more than the maximum', path: ['maxPrice'] })
  .refine(q => !q.location || Boolean(findLocation(q.location)), { message: 'Choose a recognised area from the location list', path: ['location'] })

export function publicTutorCard(tutor, subject) {
  return { ...toTutorCard(tutor, subject), location: findLocation(tutor.location)?.name || 'Location not specified' }
}

const recommended = (a, b) => Number(b.isVerified) - Number(a.isVerified) || b.ratingAvg - a.ratingAvg || b.ratingCount - a.ratingCount || b.yearsExperience - a.yearsExperience || a.id - b.id

export async function publicTutorPage(query) {
  const q = publicBrowseQuery.parse(query)
  const teaching = {
    ...(q.subject && { subject: q.subject }),
    ...(q.level && { educationLevel: q.level }),
    ...(q.grade && { minGrade: { lte: q.grade }, maxGrade: { gte: q.grade } }),
  }
  const where = {
    ...publicTutorWhere,
    subjects: { some: teaching },
    hourlyRate: { gt: 0, ...(q.minPrice != null && { gte: q.minPrice }), ...(q.maxPrice != null && { lte: q.maxPrice }) },
    ...(q.mode === 'ONLINE' && { offersOnline: true }),
  }
  const area = q.location ? findLocation(q.location) : null
  // Ordinary discovery is paged in the database. Only explicit area-based
  // discovery needs the candidate distances, just as the parent matching flow.
  if ((!area || q.mode === 'ONLINE') && q.mode !== 'PHYSICAL') {
    const defaults = [{ isVerified: 'desc' }, { ratingAvg: 'desc' }, { ratingCount: 'desc' }, { yearsExperience: 'desc' }, { id: 'asc' }]
    const primary = {
      price_asc: { hourlyRate: 'asc' }, price_desc: { hourlyRate: 'desc' },
      rating: { ratingAvg: 'desc' }, experience: { yearsExperience: 'desc' },
    }[q.sort]
    const total = await prisma.tutorProfile.count({ where })
    const totalPages = Math.max(1, Math.ceil(total / q.pageSize)), page = Math.min(q.page, totalPages)
    const rows = await prisma.tutorProfile.findMany({
      where, include: publicTutorInclude, orderBy: primary ? [primary, ...defaults] : defaults,
      skip: (page - 1) * q.pageSize, take: q.pageSize,
    })
    return { total, page, pageSize: q.pageSize, totalPages, searchScope: { mode: q.mode === 'ONLINE' ? 'ONLINE' : 'ANY', location: q.location || null, radiusKm: null, needsLocation: false }, tutors: rows.map(t => ({ ...publicTutorCard(t, q.subject), searchMode: q.mode || 'ANY' })) }
  }
  const rows = await prisma.tutorProfile.findMany({ where, include: publicTutorInclude })
  const criteria = { ...q, lat: area?.lat, lng: area?.lng }
  const groups = groupTutorCandidates(rows, criteria)
  const distance = tutor => area ? distanceKm(area.lat, area.lng, tutor.latitude, tutor.longitude) ?? Infinity : Infinity
  const sort = {
    recommended: (a, b) => Number(b.isVerified) - Number(a.isVerified) || (area ? distance(a) - distance(b) : 0) || recommended(a, b),
    nearest: (a, b) => distance(a) - distance(b) || recommended(a, b),
    price_asc: (a, b) => Number(a.hourlyRate) - Number(b.hourlyRate) || recommended(a, b),
    price_desc: (a, b) => Number(b.hourlyRate) - Number(a.hourlyRate) || recommended(a, b),
    rating: (a, b) => b.ratingAvg - a.ratingAvg || recommended(a, b),
    experience: (a, b) => b.yearsExperience - a.yearsExperience || recommended(a, b),
  }[q.sort]
  groups.tutors.sort(sort)
  const total = groups.tutors.length, totalPages = Math.max(1, Math.ceil(total / q.pageSize)), page = Math.min(q.page, totalPages)
  const alternatives = total === 0 ? groups.onlineAlternatives.sort(['nearest', 'recommended'].includes(q.sort) ? recommended : sort) : []
  const alternativePages = Math.max(1, Math.ceil(alternatives.length / q.pageSize)), alternativePage = Math.min(q.page, alternativePages)
  return {
    total, page, pageSize: q.pageSize, totalPages, searchScope: groups.searchScope,
    tutors: groups.tutors.slice((page - 1) * q.pageSize, page * q.pageSize).map(t => ({ ...publicTutorCard(t, q.subject), searchMode: groups.searchScope.mode })),
    onlineAlternatives: { total: alternatives.length, page: alternativePage, pageSize: q.pageSize, totalPages: alternativePages, tutors: alternatives.slice((alternativePage - 1) * q.pageSize, alternativePage * q.pageSize).map(t => ({ ...publicTutorCard(t, q.subject), searchMode: 'ONLINE' })) },
  }
}

async function findPublicTutor(id, include = publicTutorInclude) {
  const tutor = await prisma.tutorProfile.findFirst({ where: { id, ...publicTutorWhere }, include })
  if (!tutor) throw new AppError(404, 'Tutor not found')
  return tutor
}

export async function publicTutorProfile(id) {
  const tutor = await findPublicTutor(id)
  const [ratings, upcomingAvailability] = await Promise.all([
    prisma.review.groupBy({ by: ['rating'], where: { tutorId: id, isHidden: false }, _count: { _all: true } }),
    getTutorSlots(id, todayMyt(), 7),
  ])
  return toTutorProfile(tutor, {
    location: findLocation(tutor.location)?.name || 'Location not specified',
    ratingDistribution: [5, 4, 3, 2, 1].map(stars => ({ stars, count: ratings.find(r => r.rating === stars)?._count._all ?? 0 })),
    // Slot DTOs contain only dates, hours, mode and availability status.
    upcomingAvailability,
  })
}

export function parentInitials(name) {
  const initials = String(name || '').trim().split(/\s+/u).filter(Boolean).slice(0, 3).map(part => [...part][0]?.toLocaleUpperCase()).filter(Boolean)
  return initials.length ? `Parent ${initials.join('.')}.` : 'Parent'
}

const reviewSelect = {
  id: true, rating: true, comment: true, createdAt: true,
  parent: { select: { user: { select: { fullName: true, deletedAt: true } } } },
}
export const publicReview = row => ({
  id: row.id, parentName: row.parent.user.deletedAt ? 'Parent' : parentInitials(row.parent.user.fullName),
  // Old imported records may predate the normal review-submission checks.
  rating: row.rating, comment: reviewContentProblem(row.comment) ? null : row.comment, createdAt: row.createdAt,
})

export async function publicTutorReviews(id, query) {
  await findPublicTutor(id)
  const { sort, page } = z.object({
    sort: z.enum(['recent', 'highest', 'lowest']).default('recent'),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  }).parse(query)
  const where = { tutorId: id, isHidden: false }, take = 5
  const order = sort === 'recent' ? [{ createdAt: 'desc' }, { id: 'desc' }] : [{ rating: sort === 'highest' ? 'desc' : 'asc' }, { createdAt: 'desc' }, { id: 'desc' }]
  const [total, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({ where, select: reviewSelect, orderBy: order, skip: (page - 1) * take, take }),
  ])
  return { total, hasMore: page * take < total, reviews: rows.map(publicReview) }
}

export async function landingParentReviews() {
  const rows = await prisma.review.findMany({
    where: { isHidden: false, comment: { not: null }, tutor: publicTutorWhere },
    select: { ...reviewSelect, tutorId: true, tutor: { select: { user: { select: { fullName: true } } } } },
    orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: 24,
  })
  return rows.filter(row => row.comment.trim() && !reviewContentProblem(row.comment)).slice(0, 6).map(row => ({ ...publicReview(row), tutorId: row.tutorId, tutorName: row.tutor.user.fullName }))
}
