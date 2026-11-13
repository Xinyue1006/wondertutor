import { v2 as cloudinary } from 'cloudinary'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import { api, makeBooking, makeParent, makeTutor, MONDAY, WEDNESDAY, nextDate, resetDb, startServer, stopServer } from './helpers.js'

const exact = { address: '  12 Jalan Test, Taman Desa, Kuala Lumpur  ', latitude: 3.10001, longitude: 101.68001, confirmed: true }
const corrected = { ...exact, address: '15 Jalan Test, Taman Desa, Kuala Lumpur', latitude: 3.10011 }
const oldCloudinary = { ...env.cloudinary }
let p, other, t
beforeAll(async () => {
  await resetDb()
  await startServer()
  p = await makeParent()
  other = await makeParent()
  t = await makeTutor()
  await prisma.parentProfile.update({ where: { id: p.parent.id }, data: { latitude: 3.2087, longitude: 101.6366 } })
  Object.assign(env.cloudinary, { cloudName: 'lesson-location-test', apiKey: 'test-key', apiSecret: 'test-secret' })
})
afterAll(async () => { Object.assign(env.cloudinary, oldCloudinary); await stopServer() })

const create = (over = {}) => ({ tutorId: t.tutor.id, childId: p.child.publicId,
  date: nextDate(MONDAY), startTime: '16:00', teachingMode: 'PHYSICAL', proposedPrice: 50, ...over })
const path = b => '/parent/bookings/' + b.publicId + '/location'
const put = (b, location = exact, token = p.token) => api(token).put(path(b), { ...location, version: b.updatedAt.toISOString() })
async function legacy(status = 'CONFIRMED', extra = {}) {
  return makeBooking({ parent: p.parent, child: p.child, tutor: t.tutor, date: nextDate(WEDNESDAY), status,
    extra: { teachingMode: 'PHYSICAL', location: 'Kepong, Kuala Lumpur', latitude: 3.2087, longitude: 101.6366, ...extra } })
}
const current = b => prisma.booking.findUnique({ where: { id: b.id } })
function proof(id) {
  const public_id = 'wondertutor/attendance/' + id + '/lesson'
  const version = 1700000000
  return { version, url: 'https://res.cloudinary.com/lesson-location-test/image/authenticated/v' + version + '/' + public_id + '.jpg',
    signature: cloudinary.utils.api_sign_request({ public_id, version }, env.cloudinary.apiSecret) }
}

test('physical requests require an explicit address and confirmed pin; matching area never supplies it', async () => {
  const before = await prisma.booking.count()
  expect((await api(p.token).post('/parent/bookings', create())).status).toBe(400)
  expect((await api(p.token).post('/parent/bookings', create({ location: exact.address, latitude: exact.latitude, longitude: exact.longitude }))).status).toBe(400)
  expect(await prisma.booking.count()).toBe(before)
})

test.each([
  { ...exact, address: '   area   ' }, { ...exact, address: 'a'.repeat(192) },
  { ...exact, latitude: 91 }, { ...exact, longitude: -181 }, { ...exact, latitude: '3.1' },
  { ...exact, longitude: null }, { ...exact, confirmed: false }, { ...exact, injected: true },
])('malformed or unconfirmed lesson location is rejected without creating rows: %p', async lessonLocation => {
  const before = await prisma.booking.count()
  expect((await api(p.token).post('/parent/bookings', create({ lessonLocation }))).status).toBe(400)
  expect(await prisma.booking.count()).toBe(before)
})

test('all selected physical lessons snapshot the explicit point, with no change to matching area', async () => {
  const beforeArea = await prisma.parentProfile.findUnique({ where: { id: p.parent.id } })
  const response = await api(p.token).post('/parent/bookings', create({ date: undefined, startTime: undefined, lessonLocation: exact,
    slots: [{ date: nextDate(MONDAY), startTime: '16:00' }, { date: nextDate(WEDNESDAY), startTime: '16:00' }] }))
  expect(response.status).toBe(201)
  expect(response.bookings).toHaveLength(2)
  for (const b of response.bookings) {
    expect(b).toMatchObject({ location: exact.address.trim(), latitude: exact.latitude, longitude: exact.longitude,
      locationNeedsConfirmation: false, locationCanBeEdited: true })
    expect(b.locationConfirmedAt).toBeTruthy()
    expect(b.updatedAt).toBeTruthy()
  }
  expect(await prisma.parentProfile.findUnique({ where: { id: p.parent.id } })).toEqual(beforeArea)
})

test('online requests reject a physical address and never copy profile coordinates', async () => {
  expect((await api(p.token).post('/parent/bookings', create({ teachingMode: 'ONLINE', lessonLocation: exact }))).status).toBe(400)
  const response = await api(p.token).post('/parent/bookings', create({ teachingMode: 'ONLINE', startTime: '18:00' }))
  expect(response.status).toBe(201)
  expect(response.booking).toMatchObject({ location: null, latitude: null, longitude: null, locationConfirmedAt: null, locationNeedsConfirmation: false })
})

test('legacy coordinates stay unconfirmed and are hidden from parent, tutor list and session', async () => {
  const b = await legacy()
  const parent = await api(p.token).get('/parent/bookings/' + b.publicId)
  const tutor = await api(t.token).get('/tutor/bookings')
  const session = await api(t.token).get('/tutor/bookings/' + b.publicId + '/session')
  for (const view of [parent.booking, tutor.bookings.find(row => row.publicId === b.publicId), session]) {
    expect(view).toMatchObject({ latitude: null, longitude: null, locationConfirmedAt: null, locationNeedsConfirmation: true })
    expect(view.updatedAt).toBeTruthy()
  }
  expect(parent.booking.locationCanBeEdited).toBe(true)
})

test.each(['CONFIRMED', 'AWAITING_PAYMENT'])('a legacy %s lesson can be confirmed once without changing its payment/status', async status => {
  const b = await legacy(status)
  const response = await put(b)
  expect(response.status).toBe(200)
  expect(response.booking).toMatchObject({ status, location: exact.address.trim(), latitude: exact.latitude,
    longitude: exact.longitude, locationNeedsConfirmation: false, locationCanBeEdited: false })
  const stored = await current(b)
  expect(stored.agreedPrice).toEqual(b.agreedPrice)
  expect(stored.payBy).toEqual(b.payBy)
  const notice = await prisma.notification.findFirst({ where: { userId: t.user.id, link: '/tutor/bookings?booking=' + b.publicId } })
  expect(notice.message).not.toContain('Jalan')
  expect(notice.message).not.toContain(String(exact.latitude))
  expect((await put(stored, corrected)).status).toBe(409)
  expect((await current(b)).location).toBe(exact.address.trim())
})

test('only the owning parent can confirm with a current version and a strict valid body', async () => {
  const b = await legacy('PENDING')
  expect((await put(b, exact, other.token)).status).toBe(404)
  expect((await put(b, exact, t.token)).status).toBe(403)
  expect((await api(p.token).put(path(b), { ...exact, version: 'yesterday' })).status).toBe(400)
  expect((await api(p.token).put(path(b), { ...exact, version: b.updatedAt.toISOString(), status: 'CONFIRMED' })).status).toBe(400)
  const first = await put(b)
  expect(first.status).toBe(200)
  expect((await put(b, corrected)).status).toBe(409)
  const fresh = await current(b)
  expect((await put(fresh, corrected)).status).toBe(200)
  expect((await current(b)).latitude).toBe(corrected.latitude)
})

test.each(['PENDING', 'COUNTER_OFFERED'])('confirming a %s venue lets the tutor review it before accepting', async status => {
  const b = await legacy(status, { counterPrice: status === 'COUNTER_OFFERED' ? 55 : null })
  const response = await put(b)
  expect(response.status).toBe(200)
  expect(response.booking).toMatchObject({ status: 'PENDING', counterPrice: null, locationCanBeEdited: true })
  // An already-open tutor tab cannot accept the earlier venue/version.
  expect((await api(t.token).post('/tutor/bookings/' + b.publicId, { action: 'accept', version: b.updatedAt.toISOString() })).status).toBe(409)
})

test.each([
  { status: 'CANCELLED' }, { status: 'COMPLETED' }, { status: 'DISPUTED' }, { status: 'REJECTED' },
  { teachingMode: 'ONLINE' }, { endAt: new Date(Date.now() - 1) },
])('inactive, historical and online records cannot acquire a physical venue: %p', async changes => {
  const b = await legacy(changes.status || 'CONFIRMED', changes)
  expect((await put(b)).status).toBe(409)
  expect((await current(b)).locationConfirmedAt).toBeNull()
})

test('simultaneous location corrections use one version exactly once', async () => {
  const b = await legacy('PENDING')
  const responses = await Promise.all([put(b), put(b, corrected)])
  expect(responses.map(r => r.status).sort()).toEqual([200, 409])
  expect(await prisma.notification.count({ where: { userId: t.user.id, link: '/tutor/bookings?booking=' + b.publicId } })).toBe(1)
})

test('GPS rejects a legacy area centre before requiring a photo, then checks the exact confirmed point', async () => {
  const b = await legacy('CONFIRMED', { startAt: new Date(Date.now() - 60000), endAt: new Date(Date.now() + 120000) })
  const sessionPath = '/tutor/bookings/' + b.publicId + '/session'
  const unconfirmed = await api(t.token).post(sessionPath, { action: 'check-in' })
  expect(unconfirmed.status).toBe(409)
  expect(unconfirmed.message).toContain('parent must confirm')
  expect((await put(b)).status).toBe(200)
  const areaCentre = await api(t.token).post(sessionPath, { action: 'check-in', coords: { lat: 3.2087, lng: 101.6366 }, photo: proof(b.id) })
  expect(areaCentre.status).toBe(409)
  expect(areaCentre.message).toContain('100 metres')
  const checkedIn = await api(t.token).post(sessionPath, { action: 'check-in', coords: { lat: exact.latitude, lng: exact.longitude }, photo: proof(b.id) })
  expect(checkedIn.status).toBe(200)
  expect(checkedIn.attendance.distance).toBe(0)
  expect((await put(await current(b), corrected)).status).toBe(409)
})

test('a legacy booking with an existing check-in cannot be relocated or retroactively confirmed', async () => {
  const b = await legacy('CONFIRMED')
  await prisma.attendance.create({ data: { bookingId: b.id, checkInAt: new Date() } })
  expect((await put(b)).status).toBe(409)
  expect((await current(b)).locationConfirmedAt).toBeNull()
})

test('editing the matching area and mutually rescheduling preserve the confirmed venue snapshot', async () => {
  const family = await makeParent()
  const tutor = await makeTutor()
  const marker = new Date()
  const b = await makeBooking({ parent: family.parent, child: family.child, tutor: tutor.tutor, date: nextDate(MONDAY), status: 'CONFIRMED',
    extra: { teachingMode: 'PHYSICAL', location: exact.address.trim(), latitude: exact.latitude, longitude: exact.longitude, locationConfirmedAt: marker } })
  expect((await api(family.token).put('/parent/profile', { fullName: family.user.fullName, address: 'Cheras, Kuala Lumpur' })).status).toBe(200)
  const request = await api(family.token).post('/parent/bookings/' + b.publicId + '/reschedule', {
    date: nextDate(WEDNESDAY), startTime: '18:00', reason: 'School activity',
  })
  expect(request.status).toBe(201)
  const approval = await api(tutor.token).post('/tutor/bookings/' + b.publicId, { action: 'approve-time', requestId: request.booking.reschedule.id })
  expect(approval.status).toBe(200)
  const moved = await current(b)
  expect(moved.startAt.getTime()).not.toBe(b.startAt.getTime())
  expect(moved).toMatchObject({ location: exact.address.trim(), latitude: exact.latitude, longitude: exact.longitude, locationConfirmedAt: marker })
})

test('a check-in racing legacy venue confirmation uses only the committed explicit point', async () => {
  const b = await legacy('CONFIRMED', { startAt: new Date(Date.now() - 60000), endAt: new Date(Date.now() + 120000) })
  const sessionPath = '/tutor/bookings/' + b.publicId + '/session'
  const checkIn = () => api(t.token).post(sessionPath, { action: 'check-in', coords: { lat: exact.latitude, lng: exact.longitude }, photo: proof(b.id) })
  const [confirmed, attendance] = await Promise.all([put(b), checkIn()])
  expect(confirmed.status).toBe(200)
  expect([200, 409]).toContain(attendance.status)
  if (attendance.status === 409) {
    expect(attendance.message).toContain('parent must confirm')
    expect((await checkIn()).status).toBe(200)
  }
  const recorded = await prisma.attendance.findUnique({ where: { bookingId: b.id } })
  expect(recorded.checkInDistance).toBe(0)
  expect((await put(await current(b), corrected)).status).toBe(409)
})
