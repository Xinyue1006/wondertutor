import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { notify } from '../../services/notification.service.js'

const dto = (u, threshold) => ({
  id: u.id,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  role: u.role,
  status: u.status,
  profilePhotoUrl: u.profilePhotoUrl,
  createdAt: u.createdAt,
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
  const { role, status, q, flagged } = z
    .object({
      role: z.enum(['PARENT', 'TUTOR', 'ADMIN']).optional(),
      status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
      q: z.string().trim().max(100, 'Search text is too long').optional(),
      flagged: z.enum(['1', 'true']).optional(),
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
  let items = users.map((u) => dto(u, threshold))
  if (flagged) items = items.filter((u) => u.tutor?.flagged)
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
  res.json({
    user: {
      ...dto(user, threshold),
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

  await prisma.$transaction(async (tx) => {
    await tx.qualification.update({ where: { id: q.id }, data: { status, reviewNote: note || null } })
    // A tutor is "verified" while at least one qualification is approved
    const approved = await tx.qualification.count({ where: { tutorId: q.tutorId, status: 'APPROVED' } })
    await tx.tutorProfile.update({ where: { id: q.tutorId }, data: { isVerified: approved > 0 } })
  })
  await notify(q.tutor.userId, {
    type: 'QUALIFICATION_REVIEWED',
    title: status === 'APPROVED' ? 'Qualification approved' : 'Qualification rejected',
    message: status === 'APPROVED' ? `"${q.title}" was approved. Your profile now shows the verified badge.` : `"${q.title}" was rejected: ${note}`,
    link: '/tutor',
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
  res.json({ parents, tutors, deactivated, openComplaints, pendingQuals, flagged: tutorRows.filter((t) => t.ratingAvg < threshold).length })
}
