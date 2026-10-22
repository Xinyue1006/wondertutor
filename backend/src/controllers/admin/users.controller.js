import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { notify } from '../../services/notification.service.js'
import { recomputeVerified } from '../../services/tutorSetup.service.js'

// Suspicious-account rules (FR 8.5): an account needs the Admin's attention when any of these is true.
// The limits are small on purpose: they only raise a flag, a person decides what to do.
export const COMPLAINTS_LIMIT = 3 // complaints filed against the account
export const WARNINGS_LIMIT = 2 // warnings already issued to the account

export function suspiciousReasons(u, threshold, { complaintsAgainst = 0, warnings = 0 } = {}) {
  const reasons = []
  if (u.tutor && u.tutor.ratingCount >= 3 && u.tutor.ratingAvg < threshold) reasons.push('Rating below the threshold')
  if (complaintsAgainst >= COMPLAINTS_LIMIT) reasons.push(`${complaintsAgainst} complaints filed against this account`)
  if (warnings >= WARNINGS_LIMIT) reasons.push(`${warnings} warnings already issued`)
  return reasons
}

// How many complaints were filed against, and warnings given to, each of these users
async function signalsFor(ids) {
  if (!ids.length) return new Map()
  const [complaints, warnings] = await Promise.all([
    prisma.complaint.groupBy({ by: ['againstUserId'], where: { againstUserId: { in: ids } }, _count: { _all: true } }),
    prisma.accountWarning.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: { _all: true } }),
  ])
  const map = new Map(ids.map((id) => [id, { complaintsAgainst: 0, warnings: 0 }]))
  for (const c of complaints) map.get(c.againstUserId).complaintsAgainst = c._count._all
  for (const w of warnings) map.get(w.userId).warnings = w._count._all
  return map
}

const dto = (u, threshold, signals = {}) => ({
  id: u.id,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  role: u.role,
  status: u.status,
  profilePhotoUrl: u.profilePhotoUrl,
  createdAt: u.createdAt,
  deleted: Boolean(u.deletedAt), // the owner deleted the account: personal details are gone, records remain
  complaintsAgainst: signals.complaintsAgainst ?? 0,
  warnings: signals.warnings ?? 0,
  suspicious: suspiciousReasons(u, signals.threshold ?? 3, signals), // why this account needs a look (empty = nothing)
  tutor: u.tutor && {
    id: u.tutor.id,
    isVerified: u.tutor.isVerified,
    ratingAvg: Math.round(u.tutor.ratingAvg * 10) / 10,
    ratingCount: u.tutor.ratingCount,
    // Rating-threshold rule: below the Admin-set threshold (with at least 3 reviews) => flagged for review
    flagged: u.tutor.ratingCount >= 3 && u.tutor.ratingAvg < threshold,
    pendingQualifications: u.tutor.qualifications.filter((q) => q.status === 'PENDING').length,
  },
})

const getThreshold = async () => Number((await prisma.systemSetting.findUnique({ where: { key: 'RATING_THRESHOLD' } }))?.value ?? 3)

// GET /admin/users?role=&status=&q=&flagged=1
export async function listUsers(req, res) {
  const { role, status, q, flagged, review } = z
    .object({
      role: z.enum(['PARENT', 'TUTOR', 'ADMIN']).optional(),
      status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
      q: z.string().trim().max(100, 'Search text is too long').optional(),
      flagged: z.enum(['1', 'true']).optional(), // tutors below the rating threshold (the dashboard link)
      review: z.enum(['1', 'true']).optional(), // any account with a suspicious-account signal
    })
    .parse(Object.fromEntries(Object.entries(req.query).filter(([, v]) => v !== '')))

  const threshold = await getThreshold()
  const users = await prisma.user.findMany({
    where: {
      ...(role && { role }),
      ...(status && { status }),
      ...(q && { OR: [{ fullName: { contains: q } }, { email: { contains: q } }] }),
    },
    include: { tutor: { include: { qualifications: { select: { status: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  const signals = await signalsFor(users.map((u) => u.id))
  let items = users.map((u) => dto(u, threshold, { ...signals.get(u.id), threshold }))
  if (flagged) items = items.filter((u) => u.tutor?.flagged)
  if (review) items = items.filter((u) => u.suspicious.length > 0)
  res.json({ threshold, users: items })
}

// GET /admin/users/:id: profile + qualifications to approve
export async function getUser(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      tutor: { include: { qualifications: { orderBy: { createdAt: 'desc' } }, subjects: true } },
      parent: { include: { children: true } },
    },
  })
  if (!user) throw new AppError(404, 'User not found')
  const threshold = await getThreshold()
  // Lessons still to come, so Admin knows who is affected before deactivating the account
  const who = user.tutor ? { tutorId: user.tutor.id } : user.parent ? { parentId: user.parent.id } : null
  const upcomingLessons = who
    ? await prisma.booking.count({ where: { ...who, status: { in: ['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT', 'CONFIRMED'] }, startAt: { gt: new Date() } } })
    : 0
  const [signals, warnings] = await Promise.all([
    signalsFor([user.id]),
    prisma.accountWarning.findMany({ where: { userId: user.id }, include: { issuedBy: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' } }),
  ])
  res.json({
    user: {
      ...dto(user, threshold, { ...signals.get(user.id), threshold }),
      warningHistory: warnings.map((w) => ({ id: w.id, reason: w.reason, issuedBy: w.issuedBy.fullName, createdAt: w.createdAt, complaintId: w.complaintId })),
      upcomingLessons,
      qualifications: user.tutor?.qualifications ?? [],
      subjects: user.tutor?.subjects ?? [],
      children: user.parent?.children.map((c) => ({ id: c.id, name: c.name, educationLevel: c.educationLevel, grade: c.grade })) ?? [],
    },
  })
}

// POST /admin/users/:id/deactivate  and  /reactivate
// Reactivation is Admin-only: there is no self-service reactivation.
export async function setStatus(req, res) {
  const status = req.path.endsWith('/deactivate') ? 'DEACTIVATED' : 'ACTIVE'
  const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } })
  if (!user) throw new AppError(404, 'User not found')
  if (user.role === 'ADMIN') throw new AppError(400, 'Admin accounts cannot be deactivated here')
  // Nothing is left to switch back on: the name, email and password were removed when the owner deleted it
  if (user.deletedAt) throw new AppError(400, 'This account was deleted by its owner and cannot be changed')
  if (user.status === status) throw new AppError(400, `This account is already ${status.toLowerCase()}`)
  await prisma.user.update({ where: { id: user.id }, data: { status } })
  if (status === 'ACTIVE')
    await notify(user.id, { type: 'ACCOUNT_REACTIVATED', title: 'Account reactivated', message: 'Your WonderTutor account is active again.' })
  res.json({ ok: true, status })
}

// POST /admin/qualifications/:id/review { status, note }: grants the "verified" badge
export async function reviewQualification(req, res) {
  const { status, note } = z
    .object({ status: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(300).optional() })
    .refine((d) => d.status === 'APPROVED' || d.note, { message: 'Please give a reason for rejecting', path: ['note'] })
    .parse(req.body)

  const q = await prisma.qualification.findUnique({ where: { id: Number(req.params.id) }, include: { tutor: true } })
  if (!q) throw new AppError(404, 'Qualification not found')

  const verified = await prisma.$transaction(async (tx) => {
    await tx.qualification.update({ where: { id: q.id }, data: { status, reviewNote: note || null } })
    // A tutor is "verified" while an identity document AND at least one qualification are approved
    return recomputeVerified(tx, q.tutorId)
  })
  await notify(q.tutor.userId, {
    type: 'QUALIFICATION_REVIEWED',
    title: status === 'APPROVED' ? 'Qualification approved' : 'Qualification rejected',
    message: status === 'APPROVED'
      ? `"${q.title}" was approved.${verified ? ' Your profile now shows the verified badge.' : ''}`
      : `"${q.title}" was rejected: ${note}. Please upload a new document.`,
    link: '/tutor/verification', // shows the decision and, after a rejection, the reason and the re-upload button
  })
  res.json({ ok: true })
}

// GET /admin/dashboard: counts for the Admin home page (user management + complaints)
export async function dashboard(req, res) {
  const threshold = await getThreshold()
  const [parents, tutors, deactivated, openComplaints, pendingQuals, tutorRows] = await Promise.all([
    prisma.user.count({ where: { role: 'PARENT' } }),
    prisma.user.count({ where: { role: 'TUTOR' } }),
    prisma.user.count({ where: { status: 'DEACTIVATED' } }),
    prisma.complaint.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
    prisma.qualification.count({ where: { status: 'PENDING' } }),
    prisma.tutorProfile.findMany({ where: { ratingCount: { gte: 3 } }, select: { ratingAvg: true } }),
  ])
  // Accounts with at least one suspicious-account signal (low rating, many complaints against, repeated warnings)
  const [againstRows, warnedRows] = await Promise.all([
    prisma.complaint.groupBy({ by: ['againstUserId'], where: { againstUserId: { not: null } }, _count: { _all: true } }),
    prisma.accountWarning.groupBy({ by: ['userId'], _count: { _all: true } }),
  ])
  const flaggedIds = new Set([
    ...againstRows.filter((r) => r._count._all >= COMPLAINTS_LIMIT).map((r) => r.againstUserId),
    ...warnedRows.filter((r) => r._count._all >= WARNINGS_LIMIT).map((r) => r.userId),
  ])
  const lowRated = await prisma.tutorProfile.findMany({ where: { ratingCount: { gte: 3 }, ratingAvg: { lt: threshold } }, select: { userId: true } })
  lowRated.forEach((t) => flaggedIds.add(t.userId))
  res.json({ parents, tutors, deactivated, openComplaints, pendingQuals, flagged: tutorRows.filter((t) => t.ratingAvg < threshold).length, needsReview: flaggedIds.size })
}

// POST /admin/users/:id/warn { reason, complaintId? }: a formal warning (FR 8.2), usually the step before a deactivation.
// It is recorded, and the user is told in-app what they did and that more warnings can lead to deactivation.
export async function warnUser(req, res) {
  const { reason, complaintId } = z
    .object({
      reason: z.string().trim().min(10, 'Please explain the warning (at least 10 characters)').max(500, 'The reason must be 500 characters or fewer'),
      complaintId: z.number().int().positive().optional(),
    })
    .parse(req.body)
  const user = await prisma.user.findUnique({ where: { id: Number(req.params.id) } })
  if (!user) throw new AppError(404, 'User not found')
  if (user.role === 'ADMIN') throw new AppError(400, 'Admin accounts cannot be warned here')
  if (user.deletedAt) throw new AppError(400, 'This account was deleted by its owner and cannot be warned')
  if (complaintId && !(await prisma.complaint.findUnique({ where: { id: complaintId } }))) throw new AppError(404, 'Complaint not found')

  const warning = await prisma.accountWarning.create({ data: { userId: user.id, issuedById: req.user.id, reason, complaintId: complaintId ?? null } })
  await notify(user.id, {
    type: 'ACCOUNT_WARNING',
    title: 'Warning from WonderTutor',
    message: `${reason} Further problems may lead to your account being deactivated.`,
  })
  const count = await prisma.accountWarning.count({ where: { userId: user.id } })
  res.status(201).json({ warning: { id: warning.id, createdAt: warning.createdAt }, warnings: count })
}
