import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { MAX_GRADE, SUBJECTS } from '../../data/catalog.js'

const childSchema = z
  .object({
    name: z.string().trim().min(1, 'Child name is required').max(60),
    educationLevel: z.enum(['KINDERGARTEN', 'PRIMARY', 'SECONDARY'], { message: 'Choose an education level' }),
    grade: z.coerce.number().int().min(1, 'Choose a grade'),
    subject: z.enum(SUBJECTS).optional().nullable(),
    notes: z.string().trim().max(500, 'Notes must be 500 characters or fewer').optional().nullable(),
    photoUrl: z.string().url().startsWith('https://res.cloudinary.com/', 'Invalid photo').optional().nullable(),
  })
  .refine((d) => d.grade <= MAX_GRADE[d.educationLevel], { message: 'That grade does not exist for the chosen level', path: ['grade'] })

export const toChildDto = (c) => ({
  id: c.id,
  name: c.name,
  educationLevel: c.educationLevel,
  grade: c.grade,
  subject: c.subject,
  notes: c.notes,
  photoUrl: c.photoUrl,
  bookingCount: c._count?.bookings ?? undefined,
})

// Ownership check used by every child route: a parent can only touch their own children
async function ownChild(req) {
  const child = await prisma.child.findFirst({ where: { id: Number(req.params.id), parentId: req.parent.id } })
  if (!child) throw new AppError(404, 'Child not found')
  return child
}

export async function listChildren(req, res) {
  const children = await prisma.child.findMany({
    where: { parentId: req.parent.id },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { bookings: true } } },
  })
  res.json({ children: children.map(toChildDto) })
}

export async function createChild(req, res) {
  const data = childSchema.parse(req.body)
  const child = await prisma.child.create({ data: { ...data, parentId: req.parent.id } })
  res.status(201).json({ child: toChildDto(child) })
}

export async function updateChild(req, res) {
  const existing = await ownChild(req)
  const data = childSchema.parse(req.body)
  const child = await prisma.child.update({ where: { id: existing.id }, data })
  res.json({ child: toChildDto(child) })
}

export async function deleteChild(req, res) {
  const existing = await ownChild(req)
  // Bookings keep a reference to the child (lesson history, payments), so a child with bookings can't be removed
  const bookings = await prisma.booking.count({ where: { childId: existing.id } })
  if (bookings > 0) throw new AppError(409, 'This child has lesson history and cannot be removed.')
  await prisma.child.delete({ where: { id: existing.id } })
  res.json({ message: 'Child removed' })
}

// GET /parent/children/:id/progress : the child's learning journey, built from completed lessons.
// Attendance (check-in photo, times) and session summaries are written by the Tutor Portal; parents only read them.
// Online lessons have no attendance tracking (project scope), so the attendance figure only counts physical lessons.
export async function childProgress(req, res) {
  const child = await ownChild(req)
  const tutorSelect = { include: { user: { select: { fullName: true, profilePhotoUrl: true } } } }
  const [lessons, next] = await Promise.all([
    prisma.booking.findMany({
      where: { childId: child.id, status: 'COMPLETED' },
      include: { tutor: tutorSelect, attendance: true, summary: true, review: true },
      orderBy: { startAt: 'desc' },
    }),
    prisma.booking.findFirst({
      where: { childId: child.id, status: 'CONFIRMED', startAt: { gt: new Date() } },
      include: { tutor: tutorSelect },
      orderBy: { startAt: 'asc' },
    }),
  ])

  const hours = (b) => (b.endAt - b.startAt) / 3_600_000
  const bySubject = {}
  for (const b of lessons) {
    const s = (bySubject[b.subject] ||= { subject: b.subject, lessons: 0, hours: 0, tutors: new Set(), lastLessonAt: b.startAt })
    s.lessons++
    s.hours += hours(b)
    s.tutors.add(b.tutor.user.fullName)
  }
  const physical = lessons.filter((b) => b.teachingMode === 'PHYSICAL')
  const checkedIn = physical.filter((b) => b.attendance?.checkInAt)

  res.json({
    child: toChildDto(child),
    stats: {
      completedLessons: lessons.length,
      totalHours: Math.round(lessons.reduce((t, b) => t + hours(b), 0) * 10) / 10,
      physicalLessons: physical.length,
      checkedInLessons: checkedIn.length,
      summariesReceived: lessons.filter((b) => b.summary).length,
      firstLessonAt: lessons.length ? lessons[lessons.length - 1].startAt : null,
    },
    subjects: Object.values(bySubject)
      .map((s) => ({ ...s, hours: Math.round(s.hours * 10) / 10, tutors: [...s.tutors] }))
      .sort((a, b) => b.lessons - a.lessons),
    nextLesson: next && { id: next.id, subject: next.subject, startAt: next.startAt, endAt: next.endAt, tutorName: next.tutor.user.fullName, teachingMode: next.teachingMode },
    timeline: lessons.map((b) => ({
      bookingId: b.id,
      subject: b.subject,
      startAt: b.startAt,
      endAt: b.endAt,
      teachingMode: b.teachingMode,
      tutor: { id: b.tutorId, name: b.tutor.user.fullName, photoUrl: b.tutor.user.profilePhotoUrl },
      attendance: b.attendance && { checkInAt: b.attendance.checkInAt, checkOutAt: b.attendance.checkOutAt, checkInPhotoUrl: b.attendance.checkInPhotoUrl },
      summary: b.summary && { content: b.summary.content, progressNote: b.summary.progressNote },
      rating: b.review?.rating ?? null,
    })),
  })
}
