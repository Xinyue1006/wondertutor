// Real read tools/templates with a fake database. These tests make no Prisma
// queries, external AI requests or persistent changes.
import { jest } from '@jest/globals'
import { executeTool } from '../services/assistant/tools.js'
import { composeFromEvidence } from '../services/assistant/answers.js'
import { cardSchema } from '../services/assistant/schemas.js'
import { _clearAll, createSession, refFor } from '../services/assistant/session.js'
import { mytToDate } from '../utils/time.js'

const user = { id: 801, fullName: 'Synthetic Parent' }, parent = { id: 802 }
const child = { id: 803, parentId: parent.id, publicId: '0cc408ef-6770-49b8-8fae-3bbc1b50e928', name: 'Synthetic Child', educationLevel: 'PRIMARY', grade: 4 }
const privatePhoto = 'https://private.invalid/PRIVATE_ATTENDANCE_PHOTO'
const privateSignature = 'PRIVATE_UPLOAD_RECEIPT_SIGNATURE'
const privateLatitude = 3.123456789, privateLongitude = 101.987654321
const privateLessonAddress = '12 PRIVATE LESSON STREET, Kuala Lumpur'
const recorded = {
  checkInAt: mytToDate('2026-11-10', '17:02'), checkOutAt: mytToDate('2026-11-10', '18:03'),
  checkInLat: privateLatitude, checkInLng: privateLongitude, checkInDistance: 12.3456789,
  checkOutLat: privateLatitude, checkOutLng: privateLongitude,
  checkInPhotoUrl: privatePhoto, signature: privateSignature,
}
const baseBooking = {
  id: 804, publicId: '3aeef26f-017c-416f-8951-3e7dbd243186', parentId: parent.id, childId: child.id, tutorId: 805,
  subject: 'Mathematics', status: 'COMPLETED', teachingMode: 'ONLINE',
  startAt: mytToDate('2026-11-10', '17:00'), endAt: mytToDate('2026-11-10', '18:00'),
  child, tutor: { user: { fullName: 'Synthetic Tutor' } }, attendance: recorded, review: null,
  summary: { content: 'Equivalent fractions.', topics: 'Fractions', homework: 'Complete page 12.', recommendations: 'Practise division.', progressNote: 'Explains the method.' },
}
beforeEach(_clearAll)
function context(booking = baseBooking) {
  const ctx = {
    user, parent, now: new Date('2026-11-13T04:00:00Z'), session: createSession(user, parent),
    cards: [], sources: [], evidence: [],
    db: {
      booking: { findFirst: jest.fn(async () => booking), findMany: jest.fn(async () => [booking]) },
      child: { findMany: jest.fn(async () => [child]) },
    },
  }
  refFor(ctx.session, 'booking', baseBooking.id)
  return ctx
}
const lookup = ctx => executeTool(ctx, 'get_lesson_details', { bookingRef: 'booking_1' })
function expectPrivateEvidenceAbsent(value) {
  const json = JSON.stringify(value)
  for (const privateValue of [privatePhoto, privateSignature, privateLessonAddress, String(privateLatitude), String(privateLongitude), 'checkInLat', 'checkOutLat', 'checkInDistance', 'checkInPhotoUrl', 'signature'])
    expect(json).not.toContain(privateValue)
}

test('actual online check-in/out reaches the card, evidence, provider result and grounded answer', async () => {
  const ctx = context()
  const out = await lookup(ctx)
  expect(ctx.db.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: baseBooking.id, parentId: parent.id } }))
  expect(out).toMatchObject({ ok: true, result: { mode: 'ONLINE', attendance: { recorded: true, checkInTime: '17:02', checkOutTime: '18:03' }, tutorRecorded: { homework: 'Complete page 12.' } } })
  expect(out.result.attendance.note).toMatch(/without GPS or a photo/)
  expect(ctx.evidence[0]).toMatchObject({ kind: 'lesson', attendanceRecorded: true, checkInTime: '17:02', checkOutTime: '18:03' })
  expect(ctx.cards[0].checkIn).toEqual({ recorded: true, checkInTime: '17:02', checkOutTime: '18:03' })
  expect(ctx.cards[0].summary.homework).toBe('Complete page 12.')
  expect(cardSchema.safeParse(ctx.cards[0]).success).toBe(true)
  for (const lang of ['en', 'ms', 'zh']) {
    const answer = composeFromEvidence(ctx, lang)
    expect(answer).toContain('17:02')
    expect(answer).toContain('18:03')
  }
  expectPrivateEvidenceAbsent({ providerResult: out.result, cards: ctx.cards, evidence: ctx.evidence, answer: composeFromEvidence(ctx, 'en') })
})

test('legacy online lessons without attendance stay unknown instead of claiming absent', async () => {
  const ctx = context({ ...baseBooking, attendance: null })
  const out = await lookup(ctx)
  expect(out.result.attendance).toMatchObject({ recorded: null, checkInTime: null, checkOutTime: null })
  expect(out.result.attendance.note).toMatch(/No online attendance record is available/)
  expect(ctx.evidence[0].attendanceRecorded).toBeNull()
  expect(ctx.cards[0].checkIn.recorded).toBeNull()
  expect(composeFromEvidence(ctx, 'en')).toContain('No online check-in record is available for this lesson.')
  expect(composeFromEvidence(ctx, 'en')).not.toMatch(/absent|did not attend|No check-in is recorded for this lesson/)
})

test('an existing online tracking record with no check-in is recorded as false, not legacy unknown', async () => {
  const ctx = context({ ...baseBooking, attendance: { ...recorded, checkInAt: null, checkOutAt: null } })
  const out = await lookup(ctx)
  expect(out.result.attendance.recorded).toBe(false)
  expect(ctx.cards[0].checkIn).toEqual({ recorded: false, checkInTime: null, checkOutTime: null })
  expect(ctx.evidence[0].attendanceRecorded).toBe(false)
  expect(composeFromEvidence(ctx, 'en')).toContain('No check-in is recorded for this lesson.')
})

test('physical attendance shares its times without exposing the exact lesson venue or private GPS/photo receipt', async () => {
  const ctx = context({ ...baseBooking, teachingMode: 'PHYSICAL', location: privateLessonAddress,
    latitude: privateLatitude, longitude: privateLongitude, locationConfirmedAt: new Date() })
  const out = await lookup(ctx)
  expect(out.result.attendance).toEqual({ recorded: true, checkInTime: '17:02', checkOutTime: '18:03' })
  expect(cardSchema.safeParse(ctx.cards[0]).success).toBe(true)
  expectPrivateEvidenceAbsent({ providerResult: out.result, cards: ctx.cards, evidence: ctx.evidence })
  const list = await executeTool(ctx, 'list_bookings', { when: 'past' })
  expectPrivateEvidenceAbsent({ providerResult: list.result, cards: ctx.cards, evidence: ctx.evidence, answer: composeFromEvidence(ctx, 'en') })
})

test('unknown and unavailable booking references reveal no attendance', async () => {
  const unknown = context()
  const invalid = await executeTool(unknown, 'get_lesson_details', { bookingRef: 'booking_999' })
  expect(invalid.result.error).toBe('not_found')
  expect(unknown.db.booking.findFirst).not.toHaveBeenCalled()
  const missing = context(null)
  expect((await lookup(missing)).result.error).toBe('not_found')
  expect(missing.db.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: baseBooking.id, parentId: parent.id } }))
  expect(missing.cards).toEqual([])
  expect(missing.evidence).toEqual([])
})

test('progress card and provider totals count actual online tracking while excluding unknown legacy rows', async () => {
  const ctx = context()
  ctx.db.booking.findMany.mockResolvedValue([
    baseBooking,
    { ...baseBooking, id: 806, summary: null, attendance: null }, // legacy online
    { ...baseBooking, id: 807, teachingMode: 'PHYSICAL', summary: null, attendance: null },
  ])
  const out = await executeTool(ctx, 'get_learning_progress', {})
  expect(ctx.db.child.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { parentId: parent.id } }))
  expect(ctx.db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { childId: child.id, status: 'COMPLETED' } }))
  expect(out.result.totals).toMatchObject({ lessons: 3, physicalLessons: 1, attendanceTrackedLessons: 2, checkedIn: 1 })
  expect(out.result.recentLessons.map(l => l.attended)).toEqual([true, null, false])
  expect(ctx.cards[0].totals).toMatchObject({ lessons: 3, physicalLessons: 1, attendanceTrackedLessons: 2, checkedIn: 1 })
  expect(cardSchema.safeParse(ctx.cards[0]).success).toBe(true)
  expectPrivateEvidenceAbsent({ providerResult: out.result, card: ctx.cards[0], evidence: ctx.evidence })
})
