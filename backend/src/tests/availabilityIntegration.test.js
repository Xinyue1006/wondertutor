// Regression coverage for weekly/date overrides, half-hour reschedules and the
// public booking links used by the integrated tutor and parent portals.
import { prisma } from '../config/prisma.js'
import { addDays } from '../utils/time.js'
import { currentWeekStart } from '../utils/week.js'
import { api, makeBooking, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => { await resetDb(); await startServer() })
afterAll(stopServer)
const week = n => addDays(currentWeekStart(), n * 7)
const slot = (startTime, endTime, mode = 'BOTH', dayOfWeek = 1) => ({ dayOfWeek, startTime, endTime, mode })
const view = (actor, date) => actor.get('/tutor/availability?week=' + date)
const saveWeek = (actor, date, slots) => actor.put('/tutor/availability/weeks/' + date, { slots })
const saveUsual = (actor, slots) => actor.put('/tutor/availability', { slots })
async function setup({ usual = [slot('16:00', '19:00')], date = week(1), start = '16:30', mode = 'ONLINE', status = 'CONFIRMED' } = {}) {
  const t = await makeTutor({ availability: usual }), p = await makeParent()
  const b = await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start, status, extra: { teachingMode: mode } })
  return { t, p, b, date, tutor: api(t.token), parent: api(p.token) }
}

test('a half-hour lesson locks every grid hour it touches and cannot be truncated', async () => {
  const { t, tutor, date } = await setup()
  expect((await view(tutor, date)).booked.map(h => h.startTime)).toEqual(['16:00', '17:00'])
  const response = await saveUsual(tutor, [slot('16:00', '17:00')])
  expect(response.status).toBe(409)
  expect(response.message).toContain('17:00 has a booked lesson')
  expect((await prisma.availabilitySlot.findMany({ where: { tutorId: t.tutor.id } }))[0].endTime).toBe('19:00')
})

test.each(['CONFIRMED', 'AWAITING_PAYMENT'])('the final half-hour of a %s lesson keeps its teaching mode', async status => {
  const { tutor, date } = await setup({ status, mode: 'PHYSICAL' })
  const response = await saveWeek(tutor, date, [slot('16:00', '17:00'), slot('17:00', '19:00', 'ONLINE')])
  expect(response.status).toBe(409)
  expect(response.message).toContain('17:00')
  expect((await view(tutor, date)).override).toBeNull()
})

test('reset and copy cannot strand the final half-hour of a lesson', async () => {
  const { tutor, date } = await setup()
  expect((await saveWeek(tutor, date, [slot('16:00', '18:00')])).status).toBe(200)
  // The saved override isolates the lesson, so usual hours can change independently.
  expect((await saveUsual(tutor, [slot('16:00', '17:00')])).status).toBe(200)
  expect((await tutor.del('/tutor/availability/weeks/' + date)).status).toBe(409)
  const copied = await tutor.post('/tutor/availability/weeks/copy', { from: week(2), to: [date] })
  expect(copied.copied).toEqual([])
  expect(copied.skipped[0].reason).toContain('17:00 has a booked lesson')
})

test('adjoining online and physical lessons require BOTH in their shared grid hour', async () => {
  const { t, tutor, date } = await setup({ start: '16:30', mode: 'PHYSICAL' })
  const p = await makeParent()
  await makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date, start: '17:30', status: 'CONFIRMED' })
  const shared = (await view(tutor, date)).booked.find(h => h.startTime === '17:00')
  expect(shared.teachingMode).toBe('BOTH')
  expect((await saveUsual(tutor, [slot('16:00', '17:00', 'PHYSICAL'), slot('17:00', '19:00', 'ONLINE')])).status).toBe(409)
  expect((await saveUsual(tutor, [slot('16:00', '19:00')])).status).toBe(200)
})

test('week and date scopes tell the editor which booked hours protect its current scope', async () => {
  const { tutor, date } = await setup()
  expect((await saveWeek(tutor, date, [slot('16:00', '18:00')])).status).toBe(200)
  expect((await view(tutor, date)).booked.every(h => h.affectsUsual === false && h.affectsWeek !== false)).toBe(true)
  expect((await tutor.put('/tutor/availability/exceptions', { date, ranges: [{ startTime: '16:00', endTime: '18:00' }] })).status).toBe(200)
  expect((await view(tutor, date)).booked.every(h => h.affectsUsual === false && h.affectsWeek === false)).toBe(true)
  expect((await saveWeek(tutor, date, [slot('09:00', '10:00', 'BOTH', 2)])).status).toBe(200)
  expect((await saveUsual(tutor, [])).status).toBe(200)
})

test('a half-hour reschedule may cross touching compatible modes but cannot cross a mode restriction', async () => {
  const { tutor, parent, b, date } = await setup({ start: '18:00' })
  expect((await saveWeek(tutor, date, [slot('16:00', '17:00'), slot('17:00', '18:00', 'ONLINE'), slot('18:00', '19:00')])).status).toBe(200)
  const body = { date, startTime: '16:30', reason: 'School finishes later' }
  expect((await parent.post('/parent/bookings/' + b.publicId + '/reschedule', body)).status).toBe(201)
  const pending = await prisma.rescheduleRequest.findFirst({ where: { bookingId: b.id, status: 'PENDING' } })
  expect((await parent.post('/parent/bookings/' + b.publicId + '/reschedule/' + pending.id + '/withdraw')).status).toBe(200)
  expect((await saveWeek(tutor, date, [slot('16:00', '17:00'), slot('17:00', '18:00', 'PHYSICAL'), slot('18:00', '19:00')])).status).toBe(200)
  const refused = await parent.post('/parent/bookings/' + b.publicId + '/reschedule', body)
  expect(refused.status).toBe(400)
  expect(refused.message).toContain('physical lessons only')
})

test('restoring weekly hours checks the complete lesson across compatible mode ranges', async () => {
  const { tutor, date } = await setup()
  const dated = { date, ranges: [{ startTime: '16:00', endTime: '18:00' }] }
  expect((await tutor.put('/tutor/availability/exceptions', dated)).status).toBe(200)
  expect((await saveWeek(tutor, date, [slot('16:00', '17:00'), slot('17:00', '18:00', 'ONLINE')])).status).toBe(200)
  expect((await tutor.del('/tutor/availability/exceptions/' + date)).status).toBe(200)
  expect((await tutor.put('/tutor/availability/exceptions', dated)).status).toBe(200)
  expect((await saveWeek(tutor, date, [slot('16:00', '17:00'), slot('17:00', '18:00', 'PHYSICAL')])).status).toBe(200)
  expect((await tutor.del('/tutor/availability/exceptions/' + date)).status).toBe(409)
})

test('parent cancellation closes the pending time proposal in both portals', async () => {
  const { parent, tutor, b, date } = await setup()
  const asked = await parent.post('/parent/bookings/' + b.publicId + '/reschedule', { date, startTime: '17:30', reason: 'School timetable changed' })
  expect(asked.status).toBe(201)
  expect((await parent.post('/parent/bookings/' + b.publicId + '/cancel', { reason: 'No longer needed' })).status).toBe(200)
  expect((await prisma.rescheduleRequest.findUnique({ where: { id: asked.booking.reschedule.id } })).status).toBe('REJECTED')
  const listed = (await tutor.get('/tutor/bookings')).bookings.find(row => row.id === b.id)
  expect(listed.status).toBe('CANCELLED')
  expect(listed.reschedule.status).toBe('REJECTED')
})

test('tutor public booking links retain ownership and parent counter-offer notifications use public references', async () => {
  const { tutor, parent, t, b } = await setup({ status: 'PENDING' })
  const listed = (await tutor.get('/tutor/bookings')).bookings.find(row => row.id === b.id)
  expect(listed.publicId).toBe(b.publicId)
  const path = '/tutor/bookings/' + b.publicId
  const body = { action: 'counter', price: 55, version: b.updatedAt.toISOString() }
  expect((await api((await makeTutor()).token).post(path, body)).status).toBe(404)
  expect((await parent.post(path, body)).status).toBe(403)
  expect((await tutor.post('/tutor/bookings/invalid', body)).status).toBe(400)
  expect((await tutor.post(path, body)).status).toBe(200)
  expect((await parent.post('/parent/bookings/' + b.publicId + '/negotiate', { action: 'counter', price: 52 })).status).toBe(200)
  const notification = await prisma.notification.findFirst({ where: { userId: t.user.id, title: 'Parent proposed a new rate' } })
  expect(notification.link).toBe('/tutor/bookings?booking=' + b.publicId)
})
