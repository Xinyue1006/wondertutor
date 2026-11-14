// Strict Zod schemas for the assistant API: the request body, every tool's arguments, and every card sent to the
// browser. Anything that does not match is rejected (tools) or dropped (cards): the assistant fails closed.
import { z } from 'zod'
import { CHARACTERISTICS, LANGUAGES, SUBJECTS } from '../../data/catalog.js'
import { ymd } from '../../utils/validators.js'

const REF = (kind) => z.string().regex(new RegExp(`^${kind}_\\d{1,6}$`), `Invalid ${kind} reference`)
const day = ymd('Use a real date in YYYY-MM-DD format')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm')

// ───────────── HTTP request ─────────────
// .strict(): no identity, history, system or tool-result fields can be smuggled in by the client
export const messageRequestSchema = z
  .object({
    conversationId: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional(),
    message: z.string().trim().min(1, 'Type a message').max(2000, 'Messages can be at most 2,000 characters'),
    selection: z.object({ kind: z.literal('child'), ref: REF('child') }).strict().optional(),
  })
  .strict()

// ───────────── tool arguments ─────────────
const BOOKING_STATUSES = ['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DISPUTED']
const CRITERIA_FIELDS = ['grade', 'days', 'timeStart', 'timeEnd', 'mode', 'location', 'maxDistance', 'budgetMin', 'budgetMax', 'gender', 'language', 'characteristics']

export const toolArgs = {
  finish_lookup: z.object({}).strict(),
  list_children: z.object({}).strict(),
  get_matching_catalog: z.object({}).strict(),
  search_tutors: z
    .object({
      newSearch: z.boolean().optional(),
      childRef: REF('child').optional(),
      subject: z.enum(SUBJECTS).optional(),
      level: z.enum(['KINDERGARTEN', 'PRIMARY', 'SECONDARY']).optional(),
      grade: z.number().int().min(1).max(6).optional(),
      days: z.array(z.number().int().min(0).max(6)).max(7).optional(),
      timeStart: time.optional(),
      timeEnd: time.optional(),
      mode: z.enum(['ONLINE', 'PHYSICAL', 'EITHER']).optional(),
      location: z.string().trim().min(2).max(100).optional(),
      maxDistance: z.number().positive().max(30).optional(),
      budgetMin: z.number().min(0).max(1000).optional(),
      budgetMax: z.number().min(0).max(1000).optional(),
      gender: z.enum(['MALE', 'FEMALE', 'ANY']).optional(),
      language: z.enum(LANGUAGES).optional(),
      characteristics: z.array(z.enum(CHARACTERISTICS)).max(CHARACTERISTICS.length).optional(),
      clear: z.array(z.enum(CRITERIA_FIELDS)).max(CRITERIA_FIELDS.length).optional(),
    })
    .strict(),
  explain_tutor_match: z.object({ searchRef: REF('search'), tutorRef: REF('tutor') }).strict(),
  list_bookings: z
    .object({
      childRef: REF('child').optional(),
      subject: z.enum(SUBJECTS).optional(),
      when: z.enum(['upcoming', 'past', 'any']).optional(),
      status: z.enum(BOOKING_STATUSES).optional(),
      from: day.optional(),
      to: day.optional(),
      limit: z.number().int().min(1).max(10).optional(),
    })
    .strict(),
  get_lesson_details: z.object({ bookingRef: REF('booking') }).strict(),
  get_learning_progress: z
    .object({ childRef: REF('child').optional(), from: day.optional(), to: day.optional(), subject: z.enum(SUBJECTS).optional() })
    .strict(),
  get_payment_summary: z.object({ from: day.optional(), to: day.optional() }).strict(),
  list_payment_refunds: z.object({ bookingRef: REF('booking').optional(), limit: z.number().int().min(1).max(10).optional() }).strict(),
  list_complaints: z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED']).optional(), limit: z.number().int().min(1).max(10).optional() }).strict(),
  list_notifications: z.object({ limit: z.number().int().min(1).max(20).optional(), unreadOnly: z.boolean().optional() }).strict(),
  search_faq: z.object({ question: z.string().trim().min(2).max(300) }).strict(),
}

// ───────────── cards (server-built, validated before sending) ─────────────
const route = z.string().regex(/^\/parent(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&_-]*)?$/) // only in-app parent routes
const str = (n = 400) => z.string().max(n)
const nstr = (n = 400) => z.string().max(n).nullable()
const money = z.number().min(0).max(1_000_000)

export const cardSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('child_choices'), title: str(120), choices: z.array(z.object({ ref: REF('child'), name: str(80), label: str(80) }).strict()).max(20) }).strict(),
  z.object({
    type: z.literal('booking_list'),
    title: str(120),
    link: route,
    bookings: z.array(z.object({
      ref: REF('booking'), childName: str(80), tutorName: str(120), subject: str(80), status: str(30),
      date: day, time, mode: z.enum(['ONLINE', 'PHYSICAL']), hourlyPrice: money.nullable(), link: route,
    }).strict()).max(10),
  }).strict(),
  z.object({
    type: z.literal('lesson_detail'),
    ref: REF('booking'), childName: str(80), tutorName: str(120), subject: str(80), status: str(30), date: day, time,
    mode: z.enum(['ONLINE', 'PHYSICAL']), checkIn: z.object({ recorded: z.boolean().nullable(), checkInTime: nstr(10), checkOutTime: nstr(10) }).strict(),
    summary: z.object({ content: nstr(1200), topics: nstr(400), homework: nstr(800), recommendations: nstr(800), progressNote: nstr(800) }).strict().nullable(),
    link: route,
  }).strict(),
  z.object({
    type: z.literal('progress_summary'),
    childName: str(80), period: z.object({ from: day.nullable(), to: day.nullable(), subject: nstr(80) }).strict(),
    totals: z.object({ lessons: z.number().int(), hours: z.number(), summaries: z.number().int(), homeworkSet: z.number().int(), physicalLessons: z.number().int(), attendanceTrackedLessons: z.number().int().optional(), checkedIn: z.number().int() }).strict(),
    subjects: z.array(z.object({ subject: str(80), lessons: z.number().int(), hours: z.number() }).strict()).max(20),
    recentLessons: z.array(z.object({ date: day, subject: str(80), tutorName: str(120), homework: nstr(800), summary: nstr(800) }).strict()).max(5),
    link: route,
  }).strict(),
  z.object({
    type: z.literal('payment_summary'),
    periodLabel: str(80), paidAmount: money, paidCount: z.number().int(), pendingAmount: money, pendingCount: z.number().int(),
    totalPaidAllTime: money, basis: str(300),
    refunds: z.array(z.object({ status: str(20), count: z.number().int(), amount: money }).strict()).max(10),
    link: route,
  }).strict(),
  z.object({
    type: z.literal('refund_list'),
    link: route,
    payments: z.array(z.object({
      subject: str(80), date: day, amount: money, status: str(30),
      refunds: z.array(z.object({ amount: money, status: str(20), type: str(20) }).strict()).max(10),
    }).strict()).max(10),
  }).strict(),
  z.object({
    type: z.literal('complaint_list'),
    link: route,
    complaints: z.array(z.object({ category: str(80), status: str(20), createdAt: day, adminResponse: nstr(600) }).strict()).max(10),
  }).strict(),
  z.object({
    type: z.literal('notification_list'),
    unread: z.number().int(),
    items: z.array(z.object({ title: str(200), createdAt: day, isRead: z.boolean() }).strict()).max(20),
  }).strict(),
  z.object({ type: z.literal('faq'), entries: z.array(z.object({ id: str(60), topic: str(120), answer: str(1200) }).strict()).max(5) }).strict(),
  z.object({
    type: z.literal('tutor_results'),
    onlineAlternative: z.boolean().optional(), needsLocation: z.boolean().optional(), radiusKm: z.number().positive().max(30).nullable().optional(),
    searchRef: REF('search'), total: z.number().int(), link: route, temporary: z.literal(true),
    criteriaSummary: z.array(str(120)).max(20),
    tutors: z.array(z.object({
      id: z.number().int().positive(), ref: REF('tutor'), name: str(120), photoUrl: nstr(500), verified: z.boolean(),
      score: z.number().int().min(0).max(100), label: str(40), reasons: z.array(str(160)).max(10),
      hourlyRate: money, rating: z.number().min(0).max(5), reviewCount: z.number().int(), offersOnline: z.boolean(), offersPhysical: z.boolean(),
      location: nstr(120), link: route,
    }).strict()).max(10),
  }).strict(),
  z.object({
    type: z.literal('match_explanation'),
    onlineAlternative: z.boolean().optional(),
    name: str(120), score: z.number().int().min(0).max(100), label: str(40), reasons: z.array(str(160)).max(10),
    rank: z.number().int().positive(), total: z.number().int(), verified: z.boolean(), link: route,
  }).strict(),
])

export const sourceSchema = z.object({ id: str(80), kind: str(30), label: str(160), link: route.nullable() }).strict()
