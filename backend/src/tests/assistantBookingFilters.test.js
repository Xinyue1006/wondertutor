// Tool correctness against a fake database: no Prisma queries, provider calls or
// test-database reset are needed to check filters and ownership boundaries.
import { jest } from '@jest/globals'
import { SUBJECTS } from '../data/catalog.js'
import { executeTool, toolDeclarations } from '../services/assistant/tools.js'
import { _clearAll, createSession, refFor } from '../services/assistant/session.js'
import { mytToDate } from '../utils/time.js'

const user = { id: 901, fullName: 'Synthetic Parent' }, parent = { id: 902 }
const now = new Date('2026-11-13T04:00:00Z')
beforeEach(_clearAll)
function context(rows = []) {
  return {
    user, parent, now, session: createSession(user, parent),
    db: { booking: { findMany: jest.fn(async () => rows) } },
    cards: [], sources: [], evidence: [],
  }
}

test('the model declaration advertises the strict optional subject filter', () => {
  const tool = toolDeclarations().find(t => t.name === 'list_bookings')
  expect(tool.description).toMatch(/filter by subject/)
  expect(tool.parameters.properties.subject).toMatchObject({ type: 'STRING', enum: SUBJECTS })
  expect(tool.parameters.required || []).not.toContain('subject')
})

test('a subject-specific past lesson query retains owner, child, dates, order and limit', async () => {
  const row = {
    id: 30, publicId: '0cc408ef-6770-49b8-8fae-3bbc1b50e928', childId: 903, tutorId: 904,
    subject: 'Mathematics', status: 'COMPLETED', teachingMode: 'ONLINE',
    startAt: mytToDate('2026-11-04', '17:00'), endAt: mytToDate('2026-11-04', '18:00'),
    agreedPrice: 55, proposedPrice: 55, child: { name: 'Synthetic Child' }, tutor: { user: { fullName: 'Synthetic Tutor' } },
  }
  const ctx = context([row]), childRef = refFor(ctx.session, 'child', row.childId, row.child.name)
  const result = await executeTool(ctx, 'list_bookings', {
    subject: 'Mathematics', childRef, when: 'past', status: 'COMPLETED', from: '2026-11-02', to: '2026-11-08', limit: 1,
  })
  expect(result.ok).toBe(true)
  expect(ctx.db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { parentId: parent.id, subject: 'Mathematics', childId: row.childId, status: 'COMPLETED',
      startAt: { lt: mytToDate('2026-11-09', '00:00'), gte: mytToDate('2026-11-02', '00:00') } },
    orderBy: { startAt: 'desc' }, take: 1,
  }))
  expect(result.result.filter).toEqual({ when: 'past', status: 'COMPLETED', subject: 'Mathematics', from: '2026-11-02', to: '2026-11-08', timezone: 'Asia/Kuala_Lumpur' })
  expect(result.result.bookings[0].subject).toBe('Mathematics')
  expect(ctx.cards[0].link).toBe('/parent/bookings?tab=all')
  expect(ctx.cards[0].bookings[0].link).toContain(row.publicId)
  expect(ctx.evidence[0].items[0].subject).toBe('Mathematics')
})

test('omitting subject preserves the next-confirmed-lesson default across all subjects', async () => {
  const ctx = context()
  const result = await executeTool(ctx, 'list_bookings', {})
  expect(ctx.db.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { parentId: parent.id, status: 'CONFIRMED', startAt: { gt: now } }, orderBy: { startAt: 'asc' }, take: 5,
  }))
  expect(result.result.filter).toMatchObject({ when: 'upcoming', status: 'CONFIRMED', subject: null })
})

test.each([
  { subject: 'Unknown Subject' },
  { subject: 'Mathematics; DROP TABLE Booking' },
  { subject: 'Mathematics', parentId: 999 },
])('unsupported subjects and identity injection reject before data access: %j', async args => {
  const ctx = context()
  const result = await executeTool(ctx, 'list_bookings', args)
  expect(result).toMatchObject({ ok: false, result: { error: 'invalid_arguments' } })
  expect(ctx.db.booking.findMany).not.toHaveBeenCalled()
  expect(ctx.evidence).toEqual([])
})

test('an unknown child reference cannot turn the subject filter into an unscoped query', async () => {
  const ctx = context()
  const result = await executeTool(ctx, 'list_bookings', { subject: 'Mathematics', childRef: 'child_999', when: 'past' })
  expect(result.result.error).toBe('not_found')
  expect(ctx.db.booking.findMany).not.toHaveBeenCalled()
})

test('a reversed date range returns invalid_range before any lookup or evidence', async () => {
  const ctx = context()
  const result = await executeTool(ctx, 'list_bookings', { subject: 'Mathematics', from: '2026-11-08', to: '2026-11-02' })
  expect(result).toMatchObject({ ok: true, result: { error: 'invalid_range' } })
  expect(ctx.db.booking.findMany).not.toHaveBeenCalled()
  expect(ctx.cards).toEqual([])
  expect(ctx.evidence).toEqual([])
})
