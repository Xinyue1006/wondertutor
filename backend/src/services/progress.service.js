// Child progress report built from COMPLETED lessons (shared by GET /parent/children/:id/report and the AI assistant's
// get_learning_progress tool, so the page and the assistant can never disagree). Read-only.
import { prisma } from '../config/prisma.js'
import { addDays, mytToDate } from '../utils/time.js'

// What the tutor wrote after a lesson. Empty parts are null so the screens show only what exists.
export const toSummaryDto = (s) => ({
  content: s.content,
  progressNote: s.progressNote, // the tutor's observations
  topics: s.topics,
  homework: s.homework, // homework and follow-up work for the child
  recommendations: s.recommendations,
})

// child: an already ownership-checked Child row. q: { from?, to?, subject? } with YYYY-MM-DD dates (Malaysian days,
// both ends included). Returns the report body without the page-only fields (child DTO, parent name, generatedAt).
export async function buildChildReport(child, q = {}, db = prisma) {
  const tutorSelect = { include: { user: { select: { fullName: true } } } }
  const all = await db.booking.findMany({
    where: { childId: child.id, status: 'COMPLETED' },
    include: { tutor: tutorSelect, attendance: true, summary: true, review: true },
    orderBy: { startAt: 'desc' },
  })
  const start = q.from ? mytToDate(q.from, '00:00') : null
  const end = q.to ? mytToDate(addDays(q.to, 1), '00:00') : null
  const lessons = all.filter((b) => (!start || b.startAt >= start) && (!end || b.startAt < end) && (!q.subject || b.subject === q.subject))

  const hours = (b) => (b.endAt - b.startAt) / 3_600_000
  const round1 = (n) => Math.round(n * 10) / 10
  const bySubject = {}
  for (const b of lessons) {
    const s = (bySubject[b.subject] ||= { subject: b.subject, lessons: 0, hours: 0, tutors: new Set() })
    s.lessons++
    s.hours += hours(b)
    s.tutors.add(b.tutor.user.fullName)
  }
  const physical = lessons.filter((b) => b.teachingMode === 'PHYSICAL')
  const rated = lessons.filter((b) => b.review)

  return {
    period: { from: q.from ?? null, to: q.to ?? null, subject: q.subject ?? null },
    subjectsAvailable: [...new Set(all.map((b) => b.subject))].sort(),
    totals: {
      lessons: lessons.length,
      hours: round1(lessons.reduce((t, b) => t + hours(b), 0)),
      tutors: new Set(lessons.map((b) => b.tutorId)).size,
      summaries: lessons.filter((b) => b.summary).length,
      homeworkSet: lessons.filter((b) => b.summary?.homework).length,
      physicalLessons: physical.length,
      checkedIn: physical.filter((b) => b.attendance?.checkInAt).length,
      averageRating: rated.length ? round1(rated.reduce((t, b) => t + b.review.rating, 0) / rated.length) : null,
    },
    subjects: Object.values(bySubject)
      .map((s) => ({ subject: s.subject, lessons: s.lessons, hours: round1(s.hours), tutors: [...s.tutors] }))
      .sort((a, b) => b.lessons - a.lessons),
    lessons: lessons.map((b) => ({
      bookingId: b.id,
      tutorId: b.tutorId,
      subject: b.subject,
      startAt: b.startAt,
      endAt: b.endAt,
      teachingMode: b.teachingMode,
      tutor: b.tutor.user.fullName,
      attended: b.teachingMode === 'PHYSICAL' ? Boolean(b.attendance?.checkInAt) : null, // online lessons have no attendance record
      summary: b.summary && toSummaryDto(b.summary),
    })),
  }
}
