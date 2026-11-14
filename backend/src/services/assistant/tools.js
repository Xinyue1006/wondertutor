// Allowlisted, READ-ONLY tools the model may ask for. Nothing else exists: no SQL, no HTTP, no file access, no admin
// data, no writes. Each tool:
//   1. validates its arguments with a strict Zod schema (unknown or extra arguments -> rejected),
//   2. resolves conversation references (child_1, booking_3, ...) to records the logged-in parent OWNS, with the owner in
//      the database query itself (parentId / userId always comes from the session, never from the model),
//   3. returns a minimised, redacted result for the model, and server-built cards/sources for the browser.
// A foreign or missing record always produces the same generic not-found result.
import { prisma } from '../../config/prisma.js'
import { CHARACTERISTICS, LANGUAGES, MAX_GRADE, SUBJECTS, SUBJECT_LEVELS } from '../../data/catalog.js'
import { criteriaSchema } from '../../controllers/parent/matching.controller.js'
import { tutorRecommendationsForParent } from '../matchingApp.service.js'
import { withSavedTutorLocation } from '../tutorSearchScope.js'
import { buildChildReport } from '../progress.service.js'
import { parentPaymentSummary } from '../paymentSummary.service.js'
import { distanceBand } from '../matching.service.js'
import { addDays, mytParts, mytToDate } from '../../utils/time.js'
import { subjectsOf } from '../../utils/childSubjects.js'
import { publicReference } from '../../utils/publicIds.js'
import { searchFaq } from './faq.js'
import { toolArgs } from './schemas.js'
import { refFor, resolveRef } from './session.js'
import { expandNames, namePairs, redactText } from './privacy.js'

const NOT_FOUND = { error: 'not_found', message: 'No matching record was found for this parent.' }
const LEVEL_WORD = { KINDERGARTEN: 'Kindergarten', PRIMARY: 'Primary', SECONDARY: 'Form' }
const gradeText = (level, grade) => `${LEVEL_WORD[level]} ${grade}`
const num = (d) => (d == null ? null : Number(d))
const myt = (d) => (d ? mytParts(new Date(d)) : null)
const cut = (s, n) => (s == null ? null : String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s))

// Free text from records -> safe for the provider (names -> refs, contact details masked, bounded length)
const safe = (ctx, text, max) => redactText(text, { names: expandNames(namePairs(ctx.session, ctx.user.fullName)), max })

// Evidence: what this turn really returned, in a small validated shape. The visible answer is built from it (answers.js).
const evid = (ctx, e) => ctx.evidence.push(e)
const source = (ctx, kind, ref, label, link = null) => {
  const id = `${kind}:${ref}`
  if (!ctx.sources.some((s) => s.id === id)) ctx.sources.push({ id, kind, label, link })
}

// ───────────── child resolution ─────────────
async function ownedChildren(ctx) {
  const kids = await ctx.db.child.findMany({ where: { parentId: ctx.parent.id }, orderBy: { createdAt: 'asc' } })
  for (const k of kids) refFor(ctx.session, 'child', k.id, k.name)
  return kids
}

function childChoices(ctx, kids) {
  const seen = new Map()
  return kids.map((k) => {
    const base = `${k.name} (${gradeText(k.educationLevel, k.grade)})`
    const n = (seen.get(base) || 0) + 1
    seen.set(base, n)
    return { ref: refFor(ctx.session, 'child', k.id, k.name), name: k.name, label: n > 1 ? `${base} #${n}` : base }
  })
}

// childRef given -> that owned child (or not found). No ref -> the child the parent just picked, the only child, or a
// clarification request. Never guesses between several children (including children with the same name).
async function resolveChild(ctx, childRef) {
  const kids = await ownedChildren(ctx)
  const ref = childRef || ctx.selectedChildRef
  if (ref) {
    const id = resolveRef(ctx.session, 'child', ref)
    const child = id && kids.find((k) => k.id === id)
    return child ? { child } : { error: NOT_FOUND }
  }
  if (!kids.length) return { error: { error: 'no_children', message: 'This parent has no child profiles yet.' } }
  if (kids.length === 1) return { child: kids[0] }
  ctx.clarification = { type: 'child_choices', title: 'Which child do you mean?', choices: childChoices(ctx, kids) }
  return { error: { needsClarification: 'child', message: 'Several children: ask the parent which child. The app shows the choices.', choices: ctx.clarification.choices.map((c) => c.ref) } }
}

// ───────────── tools ─────────────
async function listChildren(ctx) {
  const kids = await ownedChildren(ctx)
  for (const k of kids) source(ctx, 'child', refFor(ctx.session, 'child', k.id), 'Child profile', '/parent/children')
  evid(ctx, { kind: 'children', items: kids.map((k) => ({ childRef: refFor(ctx.session, 'child', k.id), gradeLabel: gradeText(k.educationLevel, k.grade), subjects: subjectsOf(k), language: k.preferredLanguage ?? null, goals: safe(ctx, k.goals, 200), preferences: safe(ctx, k.notes, 200) })) })
  return {
    children: kids.map((k) => ({
      childRef: refFor(ctx.session, 'child', k.id, k.name),
      educationLevel: k.educationLevel,
      grade: k.grade,
      gradeLabel: gradeText(k.educationLevel, k.grade),
      subjects: subjectsOf(k),
      preferredLanguage: k.preferredLanguage,
      learningPreferences: safe(ctx, k.notes, 200),
      academicGoals: safe(ctx, k.goals, 200),
    })),
  }
}

function getCatalog() {
  return {
    subjects: SUBJECTS,
    subjectLevels: SUBJECT_LEVELS,
    maxGrade: MAX_GRADE,
    modes: ['ONLINE', 'PHYSICAL', 'EITHER'],
    languages: LANGUAGES,
    characteristics: CHARACTERISTICS,
    genders: ['MALE', 'FEMALE', 'ANY'],
    note: 'Location accepts a Malaysian area, town or postcode. Physical matches must be within 30 km. Online lessons can be nationwide; alternatives are labelled separately when no nearby physical tutor matches.',
  }
}

const DEFAULTS = { grade: null, days: [], timeStart: null, timeEnd: null, mode: 'EITHER', location: null, maxDistance: null, budgetMin: null, budgetMax: null, gender: 'ANY', language: null, characteristics: [] }

// Plain-English lines describing the criteria (shown on the results card so the parent sees what was searched)
function describe(c) {
  const out = [`${c.subject}`, c.grade ? gradeText(c.level, c.grade) : LEVEL_WORD[c.level] === 'Form' ? 'Secondary' : LEVEL_WORD[c.level]]
  if (c.days?.length) out.push(`Days: ${c.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ')}`)
  if (c.timeStart && c.timeEnd) out.push(`Time: ${c.timeStart}–${c.timeEnd}`)
  if (c.mode !== 'EITHER') out.push(c.mode === 'ONLINE' ? 'Online' : 'Physical')
  if (c.location) out.push(`Area: ${c.location}`)
  if (c.budgetMax != null) out.push(`Budget: up to RM${c.budgetMax}/hour`)
  if (c.gender !== 'ANY') out.push(`Tutor: ${c.gender === 'FEMALE' ? 'female' : 'male'}`)
  if (c.language) out.push(`Language: ${c.language}`)
  if (c.characteristics?.length) out.push(`Style: ${c.characteristics.join(', ')}`)
  return out
}

async function searchTutors(ctx, args) {
  // The model still chooses the tool and every other criterion. Preserve an
  // unambiguous school year explicitly typed by the parent if the model omits
  // or miscopies it. Never infer a year from a budget, child or earlier search.
  if (ctx.statedSchoolYear && !args.clear?.some(field => field === 'grade' || field === 'level')) args = { ...args, ...ctx.statedSchoolYear }
  const s = ctx.session
  // Refinements keep the previous search's preferences; explicitly given fields replace them; "clear" resets them
  const base = args.newSearch || !s.lastCriteria ? { ...DEFAULTS, childId: null, subject: null, level: null } : { ...s.lastCriteria }
  const c = { ...base }
  for (const k of Object.keys(DEFAULTS).concat(['subject', 'level'])) if (args[k] !== undefined) c[k] = args[k]
  for (const k of args.clear || []) c[k] = DEFAULTS[k]

  const prefilled = []
  if (args.childRef) {
    const { child, error } = await resolveChild(ctx, args.childRef)
    if (error) return error
    c.childId = child.id
    // Level/grade come from the explicitly selected child only when the model did not give them
    if (args.level === undefined) { c.level = child.educationLevel; prefilled.push('level') }
    if (args.grade === undefined && args.level === undefined) { c.grade = child.grade; prefilled.push('grade') }
  }
  if (!c.subject || !c.level) {
    return { needsClarification: !c.subject ? 'subject' : 'level', message: 'Subject and education level are required before searching.', known: { subject: c.subject, level: c.level } }
  }

  const parsed = criteriaSchema.safeParse({ ...c, notes: null })
  if (!parsed.success) return { error: 'invalid_criteria', message: parsed.error.issues[0]?.message || 'Invalid criteria' }
  const criteria = withSavedTutorLocation(parsed.data, ctx.parent)

  // Same engine and ordering as the wizard, but NOTHING is saved (no MatchingRequest in Phase 1)
  const groups = await tutorRecommendationsForParent(criteria, ctx.parent.id, ctx.db)
  const onlineAlternative = groups.total === 0 && groups.onlineAlternatives.total > 0
  const results = onlineAlternative ? groups.onlineAlternatives.tutors : groups.tutors
  const searchRef = refFor(s, 'search', `${Date.now()}-${s.counters.search + 1}`)
  s.searches.set(searchRef, { criteria, at: Date.now() })
  s.lastCriteria = criteria

  const top = results.slice(0, 10).map((t) => ({ t, ref: refFor(s, 'tutor', t.id, t.name) }))
  ctx.cards.push({
    type: 'tutor_results',
    searchRef,
    total: results.length,
    onlineAlternative,
    needsLocation: groups.searchScope.needsLocation,
    radiusKm: groups.searchScope.radiusKm,
    link: '/parent/find-tutor/results',
    temporary: true,
    criteriaSummary: describe(criteria),
    tutors: top.map(({ t, ref }) => ({
      id: t.id, ref, name: t.name, photoUrl: t.photoUrl ?? null, verified: Boolean(t.verified), score: t.match.score, label: t.match.label,
      reasons: t.match.reasons.slice(0, 6), hourlyRate: t.hourlyRate, rating: t.rating, reviewCount: t.reviewCount,
      offersOnline: t.offersOnline, offersPhysical: t.offersPhysical, location: t.location ?? null, link: `/parent/tutors/${t.id}${t.searchMode === 'ONLINE' ? '?mode=ONLINE' : ''}`,
    })),
  })
  evid(ctx, { kind: 'tutors', total: results.length, onlineAlternative, needsLocation: groups.searchScope.needsLocation, radiusKm: groups.searchScope.radiusKm, top: top.slice(0, 3).map(({ t, ref }) => ({ tutorRef: ref, score: t.match.score, verified: Boolean(t.verified) })) })
  source(ctx, 'search', searchRef, `Tutor search: ${describe(criteria).slice(0, 2).join(', ')}`, '/parent/find-tutor/results')
  ctx.matchResult = { temporary: true, criteria, ...groups, tutors: groups.tutors.slice(0, 30), onlineAlternatives: { total: groups.onlineAlternatives.total, tutors: groups.onlineAlternatives.tutors.slice(0, 30) } }

  const { childId, ...rest } = criteria
  return {
    searchRef,
    total: groups.total,
    onlineAlternativeTotal: groups.onlineAlternatives.total,
    onlineAlternative,
    needsLocation: groups.searchScope.needsLocation,
    scope: groups.searchScope.mode,
    radiusKm: groups.searchScope.radiusKm,
    note: onlineAlternative ? 'No nearby physical tutor matches. The listed tutors are ONLINE alternatives across Malaysia, not nearby physical matches.' : groups.searchScope.needsLocation ? 'Ask for a recognised area, town or postcode before finding physical tutors.' : 'Listed tutors meet the requested lesson mode and location scope.',
    prefilledFromChild: prefilled,
    criteria: { ...rest, childRef: childId ? refFor(s, 'child', childId) : null },
    ordering: 'Verified tutors first, then match score, then approved qualifications, then experience.',
    tutors: top.slice(0, 5).map(({ t, ref }) => ({
      tutorRef: ref,
      score: t.match.score,
      label: t.match.label,
      reasons: t.match.reasons,
      verified: Boolean(t.verified),
      hourlyRate: t.hourlyRate,
      rating: t.rating,
      reviewCount: t.reviewCount,
      offersOnline: t.offersOnline,
      offersPhysical: t.offersPhysical,
      distance: t.match.distanceKm == null ? null : distanceBand(t.match.distanceKm),
    })),
  }
}

async function explainTutorMatch(ctx, { searchRef, tutorRef }) {
  const search = ctx.session.searches.get(searchRef)
  const tutorId = resolveRef(ctx.session, 'tutor', tutorRef)
  if (!search || !tutorId) return NOT_FOUND
  // Recomputed from the stored criteria so ratings/availability are current; never estimated by the model
  const groups = await tutorRecommendationsForParent(search.criteria, ctx.parent.id, ctx.db)
  const onlineAlternative = groups.total === 0 && groups.onlineAlternatives.total > 0
  const results = onlineAlternative ? groups.onlineAlternatives.tutors : groups.tutors
  const idx = results.findIndex((t) => t.id === tutorId)
  if (idx < 0) return { error: 'not_in_results', message: 'This tutor is no longer in the results for that search.' }
  const t = results[idx]
  ctx.cards.push({ type: 'match_explanation', onlineAlternative, name: t.name, score: t.match.score, label: t.match.label, reasons: t.match.reasons.slice(0, 8), rank: idx + 1, total: results.length, verified: Boolean(t.verified), link: `/parent/tutors/${t.id}` })
  evid(ctx, { kind: 'match', onlineAlternative, tutorRef, rank: idx + 1, total: results.length, score: t.match.score, label: t.match.label })
  source(ctx, 'tutor', tutorRef, 'Tutor match details', `/parent/tutors/${t.id}`)
  return {
    tutorRef, searchRef, onlineAlternative, score: t.match.score, label: t.match.label, reasons: t.match.reasons, rank: idx + 1, total: results.length, verified: Boolean(t.verified),
    note: 'The score uses fixed weights: subject 30, level 20, availability 15, location 15, characteristics 10, fee 5, rating 5. Verified tutors are listed before unverified ones regardless of score.',
  }
}

const bookingRefs = (ctx, b) => ({
  bookingRef: refFor(ctx.session, 'booking', b.id),
  childRef: refFor(ctx.session, 'child', b.childId, b.child?.name),
  tutorRef: refFor(ctx.session, 'tutor', b.tutorId, b.tutor?.user?.fullName),
})
const hourly = (b) => num(b.agreedPrice) ?? (b.status === 'COUNTER_OFFERED' ? num(b.counterPrice) : null) ?? num(b.proposedPrice)
const bookingSelect = { include: { child: { select: { name: true } }, tutor: { select: { user: { select: { fullName: true } } } } } }

async function listBookings(ctx, args) {
  if (args.from && args.to && args.from > args.to) return { error: 'invalid_range', message: 'from must be on or before to' }
  const where = { parentId: ctx.parent.id }
  if (args.subject) where.subject = args.subject
  if (args.childRef) {
    const childId = resolveRef(ctx.session, 'child', args.childRef)
    if (!childId) return NOT_FOUND
    where.childId = childId
  }
  const when = args.when || (args.status || args.from || args.to ? 'any' : 'upcoming')
  if (args.status) where.status = args.status
  else if (when === 'upcoming') where.status = 'CONFIRMED' // "next lesson" = the next confirmed (paid) lesson
  const range = {}
  if (when === 'upcoming') range.gt = ctx.now
  if (when === 'past') range.lt = ctx.now
  if (args.from) range.gte = mytToDate(args.from, '00:00')
  if (args.to) range.lt = mytToDate(addDays(args.to, 1), '00:00') // inclusive Malaysian end day
  if (Object.keys(range).length) where.startAt = range
  const rows = await ctx.db.booking.findMany({ where, ...bookingSelect, orderBy: { startAt: when === 'upcoming' ? 'asc' : 'desc' }, take: args.limit || 5 })
  const items = rows.map((b) => {
    const p = myt(b.startAt)
    return { ...bookingRefs(ctx, b), subject: b.subject, status: b.status, date: p.date, time: p.time, endTime: myt(b.endAt).time, mode: b.teachingMode, hourlyPrice: hourly(b) }
  })
  evid(ctx, { kind: 'bookings', count: items.length, items: items.map((b) => ({ bookingRef: b.bookingRef, childRef: b.childRef, tutorRef: b.tutorRef, subject: b.subject, status: b.status, date: b.date, time: b.time, mode: b.mode, hourlyPrice: b.hourlyPrice })) })
  if (items.length) {
    ctx.cards.push({
      type: 'booking_list',
      title: when === 'upcoming' ? 'Upcoming lessons' : 'Lessons',
      link: '/parent/bookings?tab=all',
      bookings: rows.map((b, i) => ({
        ref: items[i].bookingRef, childName: b.child.name, tutorName: b.tutor.user.fullName, subject: b.subject, status: b.status,
        date: items[i].date, time: items[i].time, mode: b.teachingMode, hourlyPrice: items[i].hourlyPrice, link: `/parent/bookings?booking=${publicReference(b)}`,
      })),
    })
    for (const it of items) source(ctx, 'booking', it.bookingRef, `Booking ${it.date} ${it.subject}`, '/parent/bookings')
  }
  return { filter: { when, status: args.status ?? (when === 'upcoming' ? 'CONFIRMED' : null), subject: args.subject ?? null, from: args.from ?? null, to: args.to ?? null, timezone: 'Asia/Kuala_Lumpur' }, count: items.length, bookings: items }
}

async function getLessonDetails(ctx, { bookingRef }) {
  const id = resolveRef(ctx.session, 'booking', bookingRef)
  if (!id) return NOT_FOUND
  const b = await ctx.db.booking.findFirst({
    where: { id, parentId: ctx.parent.id }, // ownership enforced in the query
    include: { child: { select: { name: true } }, tutor: { select: { user: { select: { fullName: true } } } }, attendance: true, summary: true },
  })
  if (!b) return NOT_FOUND
  const refs = bookingRefs(ctx, b)
  const p = myt(b.startAt)
  const a = b.attendance
  const checkIn = b.teachingMode === 'PHYSICAL' || a
    ? { recorded: Boolean(a?.checkInAt), checkInTime: a?.checkInAt ? myt(a.checkInAt).time : null, checkOutTime: a?.checkOutAt ? myt(a.checkOutAt).time : null }
    : { recorded: null, checkInTime: null, checkOutTime: null }
  const sm = b.summary
  ctx.cards.push({
    type: 'lesson_detail', ref: refs.bookingRef, childName: b.child.name, tutorName: b.tutor.user.fullName, subject: b.subject, status: b.status,
    date: p.date, time: p.time, mode: b.teachingMode, checkIn,
    summary: sm ? { content: cut(sm.content, 1200), topics: cut(sm.topics, 400), homework: cut(sm.homework, 800), recommendations: cut(sm.recommendations, 800), progressNote: cut(sm.progressNote, 800) } : null,
    link: `/parent/bookings?booking=${publicReference(b)}`,
  })
  evid(ctx, { kind: 'lesson', bookingRef: refs.bookingRef, childRef: refs.childRef, tutorRef: refs.tutorRef, subject: b.subject, status: b.status, date: p.date, time: p.time, mode: b.teachingMode, attendanceRecorded: checkIn.recorded, checkInTime: checkIn.checkInTime, checkOutTime: checkIn.checkOutTime, hasSummary: Boolean(sm) })
  source(ctx, 'booking', refs.bookingRef, `Lesson ${p.date} ${b.subject}`, `/parent/bookings?booking=${publicReference(b)}`)
  return {
    ...refs, subject: b.subject, status: b.status, date: p.date, time: p.time, mode: b.teachingMode,
    attendance: { ...checkIn, ...(b.teachingMode === 'ONLINE' && { note: checkIn.recorded === null ? 'No online attendance record is available for this lesson.' : 'Online check-in/out is recorded in WonderTutor, without GPS or a photo.' }) },
    tutorRecorded: sm
      ? { summary: safe(ctx, sm.content, 600), topics: safe(ctx, sm.topics, 200), homework: safe(ctx, sm.homework, 400), recommendations: safe(ctx, sm.recommendations, 400), observations: safe(ctx, sm.progressNote, 400) }
      : null,
    missing: sm ? [] : ['The tutor has not submitted a lesson summary for this booking.'],
  }
}

async function getLearningProgress(ctx, args) {
  if (args.from && args.to && args.from > args.to) return { error: 'invalid_range', message: 'from must be on or before to' }
  const { child, error } = await resolveChild(ctx, args.childRef)
  if (error) return error
  const r = await buildChildReport(child, { from: args.from, to: args.to, subject: args.subject }, ctx.db)
  const childRef = refFor(ctx.session, 'child', child.id, child.name)
  const recent = r.lessons.slice(0, 5)
  for (const l of recent) refFor(ctx.session, 'tutor', l.tutorId, l.tutor)
  ctx.cards.push({
    type: 'progress_summary', childName: child.name,
    period: { from: r.period.from, to: r.period.to, subject: r.period.subject },
    totals: { lessons: r.totals.lessons, hours: r.totals.hours, summaries: r.totals.summaries, homeworkSet: r.totals.homeworkSet, physicalLessons: r.totals.physicalLessons, attendanceTrackedLessons: r.totals.attendanceTrackedLessons ?? r.totals.physicalLessons, checkedIn: r.totals.checkedIn },
    subjects: r.subjects.map((x) => ({ subject: x.subject, lessons: x.lessons, hours: x.hours })),
    recentLessons: recent.map((l) => ({ date: myt(l.startAt).date, subject: l.subject, tutorName: l.tutor, homework: cut(l.summary?.homework, 800), summary: cut(l.summary?.content, 800) })),
    link: `/parent/children/${publicReference(child)}/progress`,
  })
  evid(ctx, { kind: 'progress', childRef, period: { from: r.period.from ?? null, to: r.period.to ?? null, subject: r.period.subject ?? null }, lessons: r.totals.lessons, hours: r.totals.hours, summaries: r.totals.summaries, homeworkSet: r.totals.homeworkSet })
  source(ctx, 'child', childRef, 'Learning progress', `/parent/children/${publicReference(child)}/progress`)
  return {
    childRef,
    period: { ...r.period, timezone: 'Asia/Kuala_Lumpur' },
    basis: 'Completed lessons only; numbers are counts of recorded lessons, not marks or grades.',
    totals: r.totals,
    subjects: r.subjects.map((x) => ({ subject: x.subject, lessons: x.lessons, hours: x.hours })),
    recentLessons: recent.map((l) => ({
      bookingRef: refFor(ctx.session, 'booking', l.bookingId),
      date: myt(l.startAt).date,
      subject: l.subject,
      tutorRef: refFor(ctx.session, 'tutor', l.tutorId),
      attended: l.attended,
      tutorRecorded: l.summary ? { summary: safe(ctx, l.summary.content, 300), homework: safe(ctx, l.summary.homework, 300), observations: safe(ctx, l.summary.progressNote, 300) } : null,
    })),
    missing: {
      lessonsWithoutSummary: r.totals.lessons - r.totals.summaries,
      note: r.totals.lessons === 0 ? 'No completed lessons in this period.' : null,
    },
  }
}

async function getPaymentSummary(ctx, args) {
  if (args.from && args.to && args.from > args.to) return { error: 'invalid_range', message: 'from must be on or before to' }
  const s = await parentPaymentSummary(ctx.parent.id, args, ctx.now, ctx.db)
  const periodLabel = s.period.kind === 'CURRENT_MONTH' ? `This month (${s.period.from} to ${s.period.to})` : `${s.period.from ?? 'start'} to ${s.period.to ?? 'today'}`
  ctx.cards.push({
    type: 'payment_summary', periodLabel, paidAmount: s.paidInPeriod.amount, paidCount: s.paidInPeriod.count, pendingAmount: s.pendingPayment.amount,
    pendingCount: s.pendingPayment.count, totalPaidAllTime: s.totalPaidAllTime, basis: s.paidInPeriod.basis, refunds: s.refundRequestsInPeriod, link: '/parent/payments',
  })
  evid(ctx, { kind: 'payments', periodLabel, paid: Number(s.paidInPeriod.amount), paidCount: s.paidInPeriod.count, pending: Number(s.pendingPayment.amount), pendingCount: s.pendingPayment.count })
  source(ctx, 'payments', 'summary', 'Payments summary', '/parent/payments')
  return { ...s, note: 'paidInPeriod is not net of refunds. An APPROVED refund status does not confirm the money has been paid out.' }
}

async function listPaymentRefunds(ctx, args) {
  const where = { booking: { parentId: ctx.parent.id }, status: { in: ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'] } }
  if (args.bookingRef) {
    const bookingId = resolveRef(ctx.session, 'booking', args.bookingRef)
    if (!bookingId) return NOT_FOUND
    where.bookingId = bookingId
  }
  const rows = await ctx.db.payment.findMany({
    where,
    select: { amount: true, status: true, paidAt: true, bookingId: true, booking: { select: { subject: true, startAt: true } }, refunds: { select: { amount: true, status: true, type: true, createdAt: true }, orderBy: { createdAt: 'desc' } } },
    orderBy: { createdAt: 'desc' },
    take: args.limit || 5,
  })
  const items = rows.map((p) => {
    return {
      bookingRef: refFor(ctx.session, 'booking', p.bookingId), subject: p.booking.subject, lessonDate: myt(p.booking.startAt).date,
      amount: num(p.amount), status: p.status, paidDate: p.paidAt ? myt(p.paidAt).date : null,
      refunds: p.refunds.map((r) => ({ amount: num(r.amount), status: r.status, type: r.type, requestedDate: myt(r.createdAt).date })),
    }
  })
  evid(ctx, { kind: 'refunds', items: items.map((p) => ({ subject: p.subject, lessonDate: p.lessonDate, amount: p.amount, status: p.status, refunds: p.refunds.map((r) => ({ amount: r.amount, status: r.status })) })) })
  if (items.length) {
    ctx.cards.push({ type: 'refund_list', link: '/parent/payments', payments: items.map((p) => ({ subject: p.subject, date: p.lessonDate, amount: p.amount, status: p.status, refunds: p.refunds.map(({ amount, status, type }) => ({ amount, status, type })) })) })
    source(ctx, 'payments', 'list', 'Payment history', '/parent/payments')
  }
  return { count: items.length, payments: items, note: 'Refund type ADMIN_REVIEW is decided by the admin team; APPROVED is a status, not proof of payout.' }
}

async function listComplaints(ctx, args) {
  const rows = await ctx.db.complaint.findMany({
    where: { filedById: ctx.user.id, ...(args.status && { status: args.status }) },
    select: { id: true, category: true, status: true, createdAt: true, adminResponse: true },
    orderBy: { createdAt: 'desc' },
    take: args.limit || 5,
  })
  evid(ctx, { kind: 'complaints', items: rows.map((c) => ({ category: c.category, status: c.status, filedDate: myt(c.createdAt).date })) })
  if (rows.length) {
    ctx.cards.push({ type: 'complaint_list', link: '/parent/complaints', complaints: rows.map((c) => ({ category: c.category, status: c.status, createdAt: myt(c.createdAt).date, adminResponse: cut(c.adminResponse, 600) })) })
    source(ctx, 'complaints', 'list', 'My complaints', '/parent/complaints')
  }
  // The complaint narrative is not sent by default: only category, status, date and the admin's reply (redacted)
  return { count: rows.length, complaints: rows.map((c) => ({ complaintRef: refFor(ctx.session, 'complaint', c.id), category: c.category, status: c.status, filedDate: myt(c.createdAt).date, adminReply: safe(ctx, c.adminResponse, 300) })) }
}

async function listNotifications(ctx, args) {
  // Names that may appear in titles (the parent's children and the tutors they booked) are turned into references first
  await ownedChildren(ctx)
  const tutors = await ctx.db.booking.findMany({ where: { parentId: ctx.parent.id }, distinct: ['tutorId'], select: { tutorId: true, tutor: { select: { user: { select: { fullName: true } } } } } })
  for (const t of tutors) refFor(ctx.session, 'tutor', t.tutorId, t.tutor.user.fullName)
  const where = { userId: ctx.user.id, ...(args.unreadOnly && { isRead: false }) }
  const [rows, unread] = await Promise.all([
    ctx.db.notification.findMany({ where, select: { type: true, title: true, createdAt: true, isRead: true }, orderBy: { createdAt: 'desc' }, take: args.limit || 10 }),
    ctx.db.notification.count({ where: { userId: ctx.user.id, isRead: false } }),
  ])
  ctx.cards.push({ type: 'notification_list', unread, items: rows.map((n) => ({ title: cut(n.title, 200), createdAt: myt(n.createdAt).date, isRead: n.isRead })) })
  evid(ctx, { kind: 'notifications', unread })
  source(ctx, 'notifications', 'list', 'Notifications', null)
  // Reading notifications here never marks them as read
  return { unread, notifications: rows.map((n) => ({ type: n.type, title: safe(ctx, n.title, 120), date: myt(n.createdAt).date, isRead: n.isRead })) }
}

function faqTool(ctx, { question }) {
  const hits = searchFaq(question)
  if (hits.length) {
    evid(ctx, { kind: 'faq', entries: hits.map((e) => ({ id: e.id, topic: e.topic, answer: e.answer })) })
    ctx.cards.push({ type: 'faq', entries: hits.map((e) => ({ id: e.id, topic: e.topic, answer: e.answer })) })
    for (const e of hits) source(ctx, 'faq', e.id, e.topic, null)
  }
  return hits.length ? { entries: hits.map((e) => ({ id: e.id, topic: e.topic, answer: e.answer })) } : { entries: [], message: 'No approved answer found. Say you are not sure and suggest contacting the centre.' }
}

// ───────────── registry ─────────────
const S = (type, extra = {}) => ({ type, ...extra })
const childRefP = S('STRING', { description: 'Child reference from list_children, e.g. child_1' })
const dayP = S('STRING', { description: 'Malaysian date YYYY-MM-DD' })

export const TOOLS = {
  finish_lookup: {
    description: 'Control only, no data access: place LAST after all independent read tools that fully answer this question. The server displays their evidence immediately. Do not use before dependent lookups have returned or when more information is needed.',
    parameters: S('OBJECT', { properties: {} }),
    run: () => ({ finished: true }),
  },
  list_children: {
    description: "List the parent's own children (references, level, grade, saved subjects, language, learning preferences, goals).",
    parameters: S('OBJECT', { properties: {} }),
    run: listChildren,
  },
  get_matching_catalog: {
    description: 'Supported subjects, levels, grades, lesson modes, languages and teaching styles for tutor search.',
    parameters: S('OBJECT', { properties: {} }),
    run: getCatalog,
  },
  search_tutors: {
    description: 'Rank tutors with the platform matching engine. Call for tutor searches even with incomplete or empty arguments: returns needsClarification if subject or level is missing. Only use childRef for a child the parent named or selected. Keeps previous preferences unless newSearch=true; use clear to remove a preference.',
    parameters: S('OBJECT', {
      properties: {
        newSearch: S('BOOLEAN'), childRef: childRefP, subject: S('STRING', { enum: SUBJECTS }), level: S('STRING', { enum: ['KINDERGARTEN', 'PRIMARY', 'SECONDARY'] }),
        grade: S('INTEGER', { description: 'Year within the education level. Always include the number stated in Primary/Standard/Darjah/Tahun or Secondary/Form/Tingkatan, including Chinese school years. Do not omit a stated year.' }), days: S('ARRAY', { items: S('INTEGER'), description: '0=Sunday..6=Saturday' }), timeStart: S('STRING', { description: 'HH:mm' }), timeEnd: S('STRING', { description: 'HH:mm' }),
        mode: S('STRING', { enum: ['ONLINE', 'PHYSICAL', 'EITHER'] }), location: S('STRING'), maxDistance: S('NUMBER'), budgetMin: S('NUMBER'), budgetMax: S('NUMBER'),
        gender: S('STRING', { enum: ['MALE', 'FEMALE', 'ANY'] }), language: S('STRING', { enum: LANGUAGES }), characteristics: S('ARRAY', { items: S('STRING', { enum: CHARACTERISTICS }) }),
        clear: S('ARRAY', { items: S('STRING', { enum: Object.keys(DEFAULTS) }) }),
      },
    }),
    run: searchTutors,
  },
  explain_tutor_match: {
    description: "Exact score, label, reasons and rank of one tutor in an earlier search in this conversation.",
    parameters: S('OBJECT', { properties: { searchRef: S('STRING'), tutorRef: S('STRING') }, required: ['searchRef', 'tutorRef'] }),
    run: explainTutorMatch,
  },
  list_bookings: {
    description: "The parent's bookings. Default: upcoming confirmed lessons (the next lesson). Optionally filter by subject and/or childRef; omit subject for all subjects. when=past for earlier lessons; from/to are inclusive Malaysian dates.",
    parameters: S('OBJECT', { properties: { childRef: childRefP, subject: S('STRING', { enum: SUBJECTS }), when: S('STRING', { enum: ['upcoming', 'past', 'any'] }), status: S('STRING', { enum: ['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DISPUTED'] }), from: dayP, to: dayP, limit: S('INTEGER') } }),
    run: listBookings,
  },
  get_lesson_details: {
    description: 'One booking: status, recorded check-in times, and what the tutor recorded (summary, topics, homework, recommendations).',
    parameters: S('OBJECT', { properties: { bookingRef: S('STRING') }, required: ['bookingRef'] }),
    run: getLessonDetails,
  },
  get_learning_progress: {
    description: "A child's recorded learning progress from completed lessons (totals, subjects, recent summaries and homework).",
    parameters: S('OBJECT', { properties: { childRef: childRefP, from: dayP, to: dayP, subject: S('STRING', { enum: SUBJECTS }) } }),
    run: getLearningProgress,
  },
  get_payment_summary: {
    description: 'Paid and pending totals (default: this Malaysian month) plus refund requests by status. Paid totals are not net of refunds.',
    parameters: S('OBJECT', { properties: { from: dayP, to: dayP } }),
    run: getPaymentSummary,
  },
  list_payment_refunds: {
    description: 'Recent payments and their refund requests (amount, status, type).',
    parameters: S('OBJECT', { properties: { bookingRef: S('STRING'), limit: S('INTEGER') } }),
    run: listPaymentRefunds,
  },
  list_complaints: {
    description: "The parent's complaints: category, status, date and the admin team's reply.",
    parameters: S('OBJECT', { properties: { status: S('STRING', { enum: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED'] }), limit: S('INTEGER') } }),
    run: listComplaints,
  },
  list_notifications: {
    description: "The parent's recent notifications and unread count (does not mark anything as read).",
    parameters: S('OBJECT', { properties: { limit: S('INTEGER'), unreadOnly: S('BOOLEAN') } }),
    run: listNotifications,
  },
  search_faq: {
    description: 'Approved WonderTutor help and policy answers: finding bookings, overdue or missed lessons, attendance, payments/refunds, deadlines, and how matching works. The only allowed source for policies.',
    parameters: S('OBJECT', { properties: { question: S('STRING') }, required: ['question'] }),
    run: faqTool,
  },
}

export const toolDeclarations = () => Object.entries(TOOLS).map(([name, t]) => ({
  name, description: t.description,
  parameters: t.parameters.type === 'OBJECT' && Object.keys(t.parameters.properties || {}).length === 0
    ? { ...t.parameters, maxProperties: '0' } // match the server's strict empty-argument schema
    : t.parameters,
}))

// Runs one model-requested tool. Unknown names and invalid arguments fail closed with an error result (no exception
// reaches the model loop, and nothing is executed).
export async function executeTool(ctx, name, rawArgs) {
  if (!Object.hasOwn(TOOLS, name) || !Object.hasOwn(toolArgs, name)) return { ok: false, result: { error: 'unknown_tool', message: 'That tool does not exist. Only the listed read-only tools are available.' } }
  const parsed = toolArgs[name].safeParse(rawArgs ?? {})
  if (!parsed.success) return { ok: false, result: { error: 'invalid_arguments', message: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'arguments'}: ${i.message}`).join('; ') } }
  const result = await TOOLS[name].run(ctx, parsed.data)
  return { ok: true, result }
}

export const DEFAULT_DB = prisma
