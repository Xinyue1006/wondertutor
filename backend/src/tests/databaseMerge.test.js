import { Prisma } from '@prisma/client'
import { planDatabaseMerge } from '../services/databaseMerge/plan.js'

// Entirely synthetic in-memory snapshots: these tests never connect to or reset a database.
const stamp = '2026-11-13 01:02:03.123'
const now = new Date('2026-11-13T06:00:00.000Z')
const uuid = n => `b626645a-7001-4001-8001-${String(n).padStart(12, '0')}`
const models = Prisma.dmmf.datamodel.models
const emptyTarget = () => Object.fromEntries(models.map(model => [model.name, []]))
const user = (id, role, email, extra = {}) => ({
  id, email, passwordHash: 'synthetic-source-password-hash', googleId: null, role, fullName: role === 'TUTOR' ? 'Example Tutor' : 'Example Parent',
  phone: null, profilePhotoUrl: null, isEmailVerified: 1, status: 'ACTIVE', privacyAcceptedAt: null,
  emailReminders: 1, deletedAt: null, createdAt: stamp, updatedAt: stamp, ...extra,
})
const tutor = (id = 1, userId = 2, extra = {}) => ({
  id, userId, gender: 'FEMALE', emergencyContactName: null, emergencyContactPhone: null, bio: 'Synthetic demo tutor',
  teachingApproach: null, characteristics: '["Structured"]', languages: '["English"]', achievements: null,
  yearsExperience: 4, hourlyRate: '50.00', location: 'Kepong, Kuala Lumpur', latitude: '3.2087', longitude: '101.6366',
  offersPhysical: 1, offersOnline: 1, quickAdd: null, commissionRate: null, isVerified: 0,
  verificationSubmittedAt: null, ratingAvg: 0, ratingCount: 0, ...extra,
})
const child = (extra = {}) => ({ id: 1, publicId: uuid(101), parentId: 1, name: 'Example Child', educationLevel: 'PRIMARY', grade: 5,
  subject: 'Mathematics', subjects: '["Mathematics"]', notes: null, photoUrl: null, createdAt: stamp, goals: null,
  gradeYear: 2026, preferredLanguage: null, ...extra })
const booking = (extra = {}) => ({ id: 1, publicId: uuid(201), parentId: 1, childId: 1, tutorId: 1, subject: 'Mathematics',
  startAt: '2026-10-20 08:00:00.000', endAt: '2026-10-20 09:00:00.000', teachingMode: 'ONLINE', location: null,
  latitude: null, longitude: null, locationConfirmedAt: null, meetingLink: null, isTrial: 0, messageToTutor: null,
  proposedPrice: '50.00', counterPrice: null, agreedPrice: '50.00', status: 'COMPLETED', rejectionReason: null,
  cancelReason: null, cancelledById: null, createdAt: stamp, updatedAt: stamp, payBy: null, ...extra })
const payment = (extra = {}) => ({ id: 1, publicId: uuid(301), bookingId: 1, amount: '50.00', commissionRate: '10.00',
  commissionAmount: '5.00', method: 'FPX', gatewayRef: 'synthetic-demo-bill', status: 'PAID', paidAt: stamp, createdAt: stamp, ...extra })
const review = (extra = {}) => ({ id: 1, bookingId: 1, parentId: 1, tutorId: 1, rating: 5, comment: 'Helpful explanations.',
  photoUrl: null, createdAt: stamp, isHidden: 0, moderationReason: null, moderatedAt: null, moderatedById: null, ...extra })

function graph(changes = {}) {
  return {
    User: [user(1, 'PARENT', 'parent@example.test'), user(2, 'TUTOR', 'tutor@example.test')],
    ParentProfile: [{ id: 1, userId: 1, address: 'Kepong', latitude: null, longitude: null, preferences: null }],
    TutorProfile: [tutor()], Child: [child()], Booking: [booking()], ...changes,
  }
}
function source(rows) {
  return Object.fromEntries(Object.entries(rows).map(([model, values]) => [model.toLowerCase(), {
    columns: [...new Set(values.flatMap(row => Object.keys(row)))], rows: values,
  }]))
}
function dbRows(rows) {
  const target = emptyTarget()
  for (const [name, values] of Object.entries(rows)) {
    const fields = Object.fromEntries(models.find(model => model.name === name).fields.map(field => [field.name, field]))
    target[name] = values.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      const type = fields[key]?.type
      if (value != null && type === 'DateTime') value = new Date(String(value).replace(' ', 'T') + (String(value).endsWith('Z') ? '' : 'Z'))
      else if (value != null && type === 'Boolean') value = Boolean(value)
      else if (value != null && type === 'Json' && typeof value === 'string') value = JSON.parse(value)
      else if (value != null && type === 'Float') value = Number(value)
      return [key, value]
    })))
  }
  return target
}
const plan = (rows, target = emptyTarget()) => planDatabaseMerge({ source: source(rows), target, now })
const inserted = (result, model) => result.inserts.filter(item => item.model === model).map(item => item.data)
const clone = value => value instanceof Date ? new Date(value)
  : Array.isArray(value) ? value.map(clone)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value
function materialize(target, result) {
  const next = clone(target)
  for (const item of result.inserts) next[item.model].push(clone(item.data))
  for (const item of result.updates) {
    const row = next[item.model].find(row => Object.entries(item.where).every(([key, value]) => row[key] === value))
    if (!row) throw new Error('Update refers to an absent row in the synthetic target')
    Object.assign(row, clone(item.data))
  }
  return next
}

test('colliding numeric user IDs are remapped by identity, never attached to an unrelated local account', () => {
  const target = dbRows({ User: [user(1, 'PARENT', 'different@example.test')] })
  const before = JSON.stringify(target)
  const result = plan({ User: [user(1, 'TUTOR', 'new-tutor@example.test')], TutorProfile: [tutor(1, 1)] }, target)
  const mapped = result.mappings.User[1]
  expect(mapped).not.toBe(1)
  expect(inserted(result, 'User')[0]).toMatchObject({ id: mapped, email: 'new-tutor@example.test' })
  expect(inserted(result, 'TutorProfile')[0].userId).toBe(mapped)
  expect(result.updates.filter(item => item.model === 'User')).toEqual([])
  expect(JSON.stringify(target)).toBe(before)
})

test('matching an existing account preserves credentials, role, status and deletion state', () => {
  const existing = user(9, 'TUTOR', 'same@example.test', { passwordHash: 'local-password-must-stay', status: 'DEACTIVATED', googleId: 'local-google-identity' })
  const target = dbRows({ User: [existing], TutorProfile: [tutor(8, 9)] })
  const before = JSON.stringify(target)
  const result = plan({ User: [user(2, 'TUTOR', 'same@example.test')], TutorProfile: [tutor(1, 2)] }, target)
  expect(inserted(result, 'User')).toEqual([])
  expect(result.updates.filter(item => item.model === 'User')).toEqual([])
  expect(JSON.stringify(target)).toBe(before)
})

test.each(['/img/people/tutor.jpg', 'img/people/tutor.jpg', 'https://example.test/img/people/tutor.jpg'])('new imports discard the legacy demo portrait %s', profilePhotoUrl => {
  const incoming = user(1, 'TUTOR', 'new@example.test', { profilePhotoUrl })
  const result = plan({ User: [incoming] })
  expect(inserted(result, 'User')[0].profilePhotoUrl).toBeNull()
  expect(incoming.profilePhotoUrl).toBe(profilePhotoUrl)
})

test('new imports keep genuine uploaded profile photos', () => {
  const profilePhotoUrl = 'https://res.cloudinary.com/demo/image/upload/real-tutor.jpg'
  const result = plan({ User: [user(1, 'TUTOR', 'new@example.test', { profilePhotoUrl })] })
  expect(inserted(result, 'User')[0].profilePhotoUrl).toBe(profilePhotoUrl)
})

test.each([null, 'https://res.cloudinary.com/demo/image/upload/local-tutor.jpg'])('an existing local photo setting is preserved when a dump contains a demo portrait (%s)', profilePhotoUrl => {
  const target = dbRows({ User: [user(9, 'TUTOR', 'same@example.test', { profilePhotoUrl })] })
  const before = JSON.stringify(target)
  const result = plan({ User: [user(1, 'TUTOR', 'same@example.test', { profilePhotoUrl: '/img/people/tutor.jpg' })] }, target)
  expect(inserted(result, 'User')).toEqual([])
  expect(result.updates.filter(item => item.model === 'User')).toEqual([])
  expect(JSON.stringify(target)).toBe(before)
})

test.each(['/img/people/child.jpg', 'img/people/child.jpg', 'https://example.test/img/people/child.jpg'])('new child imports discard the legacy demo portrait %s', photoUrl => {
  const incoming = child({ photoUrl })
  const result = plan(graph({ Child: [incoming] }))
  expect(inserted(result, 'Child')[0].photoUrl).toBeNull()
  expect(incoming.photoUrl).toBe(photoUrl)
})

test('new child imports retain genuine private photos when the owner mapping is unchanged', () => {
  const photoUrl = 'https://res.cloudinary.com/demo/image/authenticated/v1/wondertutor/children/1/real-child.jpg'
  const result = plan(graph({ Child: [child({ photoUrl })] }))
  expect(inserted(result, 'Child')[0].photoUrl).toBe(photoUrl)
})

test.each([null, 'https://res.cloudinary.com/demo/image/authenticated/v1/wondertutor/children/1/real-child.jpg'])('existing child photo settings remain local when importing a demo portrait (%s)', photoUrl => {
  const target = dbRows(graph({ Child: [child({ photoUrl })] }))
  const before = JSON.stringify(target)
  const result = plan(graph({ Child: [child({ photoUrl: '/img/people/child.jpg' })] }), target)
  expect(inserted(result, 'Child')).toEqual([])
  expect(result.updates.filter(item => item.model === 'Child')).toEqual([])
  expect(JSON.stringify(target)).toBe(before)
})

test('an email belonging to another role cannot be repurposed by the incoming tutor profile', () => {
  const target = dbRows({ User: [user(7, 'ADMIN', 'same@example.test')] })
  const result = plan({ User: [user(2, 'TUTOR', 'same@example.test')], TutorProfile: [tutor()] }, target)
  expect(inserted(result, 'User')).toEqual([])
  expect(inserted(result, 'TutorProfile')).toEqual([])
  expect(result.report.conflicts.length).toBeGreaterThan(0)
})

test('an existing Google identity cannot be duplicated under an unrelated imported email', () => {
  const target = dbRows({ User: [user(7, 'TUTOR', 'local@example.test', { googleId: 'synthetic-google-id' })] })
  const result = plan({ User: [user(2, 'TUTOR', 'different@example.test', { googleId: 'synthetic-google-id' })], TutorProfile: [tutor()] }, target)
  expect(inserted(result, 'User')).toEqual([])
  expect(inserted(result, 'TutorProfile')).toEqual([])
  expect(result.report.conflicts.length).toBeGreaterThan(0)
})

test('a public child UUID with different ownership blocks that child and its booking subtree', () => {
  const target = dbRows({ User: [user(9, 'PARENT', 'other@example.test')], ParentProfile: [{ id: 9, userId: 9 }], Child: [child({ id: 9, parentId: 9 })] })
  const result = plan(graph(), target)
  expect(inserted(result, 'Child')).toEqual([])
  expect(inserted(result, 'Booking')).toEqual([])
  expect(result.report.conflicts.some(item => item.model === 'Child')).toBe(true)
})

test('unambiguous natural identities deduplicate independently generated child and booking UUIDs', () => {
  const existing = graph({ Child: [child({ publicId: uuid(102) })], Booking: [booking({ publicId: uuid(202) })] })
  const result = plan(graph(), dbRows(existing))
  expect(inserted(result, 'User')).toEqual([])
  expect(inserted(result, 'Child')).toEqual([])
  expect(inserted(result, 'Booking')).toEqual([])
  expect(result.mappings.Child[1]).toBe(1)
  expect(result.mappings.Booking[1]).toBe(1)
  expect(result.updates.filter(item => ['Child', 'Booking'].includes(item.model))).toEqual([])
})

test('a booking status conflict cannot silently attach imported paid history or evidence to a cancelled local record', () => {
  const target = dbRows(graph({ Booking: [booking({ status: 'CANCELLED', cancelReason: 'Local cancellation' })] }))
  const result = plan(graph({
    Payment: [payment()], Attendance: [{ id: 1, bookingId: 1, checkInAt: stamp }],
    SessionSummary: [{ id: 1, bookingId: 1, content: 'Imported report', createdAt: stamp }], Review: [review()],
  }), target)
  for (const model of ['Payment', 'Attendance', 'SessionSummary', 'Review']) expect(inserted(result, model)).toEqual([])
  expect(result.updates.filter(item => item.model === 'Booking')).toEqual([])
  expect(result.report.conflicts.some(item => item.model === 'Booking')).toBe(true)
})

test('missing source foreign-key mappings are not resolved from coincidentally matching local numeric IDs', () => {
  const target = dbRows({ User: [user(22, 'TUTOR', 'unrelated@example.test')], TutorProfile: [tutor(999, 22)] })
  const result = plan({ Qualification: [{ id: 1, tutorId: 999, kind: 'QUALIFICATION', title: 'Synthetic degree', institution: null,
    year: null, documentUrl: 'seed://sample-certificate', status: 'PENDING', reviewNote: null, createdAt: stamp }] }, target)
  expect(inserted(result, 'Qualification')).toEqual([])
  expect(result.report.conflicts.length).toBeGreaterThan(0)
})

test('local authentication sessions, verification codes, settings and migration history are never imported', () => {
  const result = plan({
    User: [user(2, 'TUTOR', 'tutor@example.test')],
    AuthSession: [{ id: 'source-session', userId: 2, credentialTag: 'source-tag', createdAt: stamp, expiresAt: stamp }],
    EmailOtp: [{ id: 1, email: 'tutor@example.test', codeHash: 'source-code', attempts: 0, createdAt: stamp, expiresAt: stamp }],
    SystemSetting: [{ key: 'GPS_RADIUS_METRES', value: '5000', updatedAt: stamp }],
    _prisma_migrations: [{ id: 'source-migration', migration_name: 'untrusted' }],
  })
  expect(result.inserts.some(item => ['AuthSession', 'EmailOtp', 'SystemSetting', '_prisma_migrations'].includes(item.model))).toBe(false)
  expect(result.updates).toEqual([])
})

test('database literal conversion preserves UTC timestamps, JSON structure, booleans and monetary precision', () => {
  const result = plan({ User: [user(2, 'TUTOR', 'tutor@example.test')], TutorProfile: [tutor(1, 2, { hourlyRate: '123.45', characteristics: '["Patient","Structured"]' })] })
  const importedUser = inserted(result, 'User')[0]
  const importedTutor = inserted(result, 'TutorProfile')[0]
  expect(importedUser.createdAt.toISOString()).toBe('2026-11-13T01:02:03.123Z')
  expect(importedUser.isEmailVerified).toBe(true)
  expect(importedTutor.characteristics).toEqual(['Patient', 'Structured'])
  expect(String(importedTutor.hourlyRate)).toBe('123.45')
})

test('different incoming weekly hours never extend or replace an existing tutor calendar', () => {
  const target = dbRows(graph({ AvailabilitySlot: [{ id: 1, tutorId: 1, dayOfWeek: 1, startTime: '16:00', endTime: '20:00', mode: 'BOTH' }] }))
  const result = plan(graph({ AvailabilitySlot: [{ id: 1, tutorId: 1, dayOfWeek: 1, startTime: '09:00', endTime: '12:00', mode: 'ONLINE' }] }), target)
  expect(inserted(result, 'AvailabilitySlot')).toEqual([])
  expect(result.updates.filter(item => item.model === 'AvailabilitySlot')).toEqual([])
  expect(target.AvailabilitySlot[0]).toMatchObject({ startTime: '16:00', endTime: '20:00', mode: 'BOTH' })
})

test('a new active tutor booking cannot overlap an existing confirmed lesson for another child', () => {
  const existing = graph({ Booking: [booking({ status: 'CONFIRMED', startAt: '2026-12-01 08:00:00.000', endAt: '2026-12-01 09:00:00.000' })] })
  const target = dbRows(existing)
  const result = plan(graph({ Child: [child({ id: 2, publicId: uuid(103), name: 'Other Child' })],
    Booking: [booking({ id: 2, publicId: uuid(203), childId: 2, status: 'CONFIRMED', startAt: '2026-12-01 08:30:00.000', endAt: '2026-12-01 09:30:00.000' })],
  }), target)
  expect(inserted(result, 'Booking')).toEqual([])
  expect(result.report.conflicts.some(item => item.model === 'Booking')).toBe(true)
})

test('review imports recompute only the affected tutor rating and exclude hidden reviews', () => {
  const target = dbRows(graph({ Booking: [booking({ id: 11, publicId: uuid(211), startAt: '2026-10-10 08:00:00.000', endAt: '2026-10-10 09:00:00.000' }), booking({ id: 12, publicId: uuid(212), startAt: '2026-10-11 08:00:00.000', endAt: '2026-10-11 09:00:00.000' })],
    TutorProfile: [tutor(1, 2, { ratingAvg: 4, ratingCount: 99 })],
    Review: [review({ id: 11, bookingId: 11, rating: 2 }), review({ id: 12, bookingId: 12, rating: 1, isHidden: 1 })],
  }))
  const result = plan(graph({ Review: [review()] }), target)
  expect(inserted(result, 'Review')).toHaveLength(1)
  const update = result.updates.find(item => item.model === 'TutorProfile' && item.where.id === 1)
  expect(update.data).toMatchObject({ ratingAvg: 3.5, ratingCount: 2 })
})

test('repeating a completed merge creates no duplicate accounts, records or financial entries', () => {
  const rows = graph({ Payment: [payment()], Review: [review()],
    TutorSubject: [{ id: 1, tutorId: 1, subject: 'Mathematics', educationLevel: 'PRIMARY', minGrade: 4, maxGrade: 6 }],
    AvailabilitySlot: [{ id: 1, tutorId: 1, dayOfWeek: 1, startTime: '16:00', endTime: '20:00', mode: 'BOTH' }],
  })
  const target = emptyTarget()
  const first = plan(rows, target)
  expect(inserted(first, 'User')).toHaveLength(2)
  expect(inserted(first, 'Payment')).toHaveLength(1)
  const second = plan(rows, materialize(target, first))
  expect(second.inserts).toEqual([])
})

test.each(['parent@wondertutor.local', 'reviewer1@seed.wondertutor.local'])('independently reseeded shared-demo history is not duplicated for %s', email => {
  const shared = graph({ User: [user(1, 'PARENT', email), user(2, 'TUTOR', 'tutor@example.test')] })
  const target = dbRows(shared)
  const incoming = { ...shared,
    Booking: [booking({ publicId: uuid(999), startAt: '2026-10-27 08:00:00.000', endAt: '2026-10-27 09:00:00.000' })],
    Payment: [payment()], Review: [review()],
  }
  const result = plan(incoming, target)
  expect(inserted(result, 'Booking')).toEqual([])
  expect(inserted(result, 'Payment')).toEqual([])
  expect(inserted(result, 'Review')).toEqual([])
  expect(result.report.conflicts.some(item => item.model === 'Booking' && item.reason === 'existing_demo_history')).toBe(true)
})

test('an ordinary parent may import a genuinely different dated booking without an ID-based match', () => {
  const target = dbRows(graph())
  const result = plan(graph({ Booking: [booking({ publicId: uuid(999), startAt: '2026-10-27 08:00:00.000', endAt: '2026-10-27 09:00:00.000' })], Payment: [payment()] }), target)
  const added = inserted(result, 'Booking')
  expect(added).toHaveLength(1)
  expect(added[0].id).not.toBe(1)
  expect(added[0].publicId).toBe(uuid(999))
  expect(inserted(result, 'Payment')[0].bookingId).toBe(added[0].id)
})

test('ambiguous same-name children are reported instead of arbitrarily choosing a local child', () => {
  const target = dbRows(graph({ Child: [child({ id: 2, publicId: uuid(102) }), child({ id: 3, publicId: uuid(103) })], Booking: [] }))
  const result = plan(graph(), target)
  expect(inserted(result, 'Child')).toEqual([])
  expect(inserted(result, 'Booking')).toEqual([])
  expect(result.report.conflicts.some(item => item.model === 'Child')).toBe(true)
})

test('a shared booking UUID cannot move the record to another mapped child', () => {
  const target = dbRows(graph())
  const result = plan(graph({ Child: [child({ id: 2, publicId: uuid(102), name: 'Second Child' })], Booking: [booking({ childId: 2 })], Payment: [payment()] }), target)
  expect(inserted(result, 'Booking')).toEqual([])
  expect(inserted(result, 'Payment')).toEqual([])
  expect(result.updates.filter(item => item.model === 'Booking')).toEqual([])
  expect(result.report.conflicts.some(item => item.model === 'Booking')).toBe(true)
})

test('a shared payment UUID cannot attach a local payment to a different imported booking', () => {
  const target = dbRows(graph({ Payment: [payment()] }))
  const result = plan(graph({ Booking: [booking({ id: 2, publicId: uuid(202), startAt: '2026-10-21 08:00:00.000', endAt: '2026-10-21 09:00:00.000' })],
    Payment: [payment({ bookingId: 2 })], Refund: [{ id: 1, paymentId: 1, amount: '50.00', type: 'ADMIN_REVIEW', reason: 'Synthetic refund', status: 'PENDING', createdAt: stamp }],
  }), target)
  expect(inserted(result, 'Booking')).toHaveLength(1)
  expect(inserted(result, 'Payment')).toEqual([])
  expect(inserted(result, 'Refund')).toEqual([])
  expect(result.updates.filter(item => item.model === 'Payment')).toEqual([])
  expect(result.report.conflicts.some(item => item.model === 'Payment')).toBe(true)
})

test('an ID-remapped child photo is unavailable rather than falsely rewritten to a different private owner folder', () => {
  const target = dbRows({ User: [user(1, 'PARENT', 'other@example.test')], ParentProfile: [{ id: 1, userId: 1 }] })
  const result = plan(graph({ Child: [child({ photoUrl: 'https://res.cloudinary.com/synthetic/image/authenticated/wondertutor/children/1/photo.jpg' })], Booking: [] }), target)
  const imported = inserted(result, 'Child')[0]
  expect(imported.parentId).not.toBe(1)
  expect(imported.photoUrl).toBeNull()
  expect(result.report.mediaWarnings.some(item => item.model === 'Child' && item.field === 'photoUrl')).toBe(true)
})

test('a private qualification with a remapped user folder does not fabricate a verified new tutor', () => {
  const target = dbRows({ User: [user(2, 'PARENT', 'unrelated@example.test')] })
  const result = plan({ User: [user(2, 'TUTOR', 'tutor@example.test')], TutorProfile: [tutor(1, 2, { isVerified: 1 })],
    Qualification: [{ id: 1, tutorId: 1, kind: 'QUALIFICATION', title: 'Synthetic degree', institution: null, year: null,
      documentUrl: 'https://res.cloudinary.com/synthetic/image/authenticated/wondertutor/qualifications/2/degree.pdf', status: 'APPROVED', reviewNote: null, createdAt: stamp }],
  }, target)
  expect(inserted(result, 'User')[0].id).not.toBe(2)
  expect(inserted(result, 'Qualification')).toEqual([])
  expect(inserted(result, 'TutorProfile')[0].isVerified).toBe(false)
  expect(result.report.mediaWarnings.some(item => item.model === 'Qualification')).toBe(true)
})
