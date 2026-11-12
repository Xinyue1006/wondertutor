import { v2 as cloudinary } from 'cloudinary'
import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import { api, makeAdmin, makeBooking, makeParent, makeTutor, nextDate, MONDAY, resetDb, startServer, stopServer } from './helpers.js'

let p, t, admin
const previous = { ...env.cloudinary }
beforeAll(async () => {
  await resetDb()
  await startServer()
  p = await makeParent()
  t = await makeTutor()
  admin = await makeAdmin()
  Object.assign(env.cloudinary, { cloudName: 'session-test', apiKey: 'test-key', apiSecret: 'test-secret' })
})
afterAll(async () => { Object.assign(env.cloudinary, previous); await stopServer() })

async function lesson(extra = {}) {
  const b = await makeBooking({ tutor: t.tutor, child: p.child, parent: p.parent, date: nextDate(MONDAY), status: 'CONFIRMED',
    extra: { startAt: new Date(Date.now() - 60000), endAt: new Date(Date.now() + 60000), ...extra } })
  const path = '/tutor/bookings/' + b.id + '/session'
  return { b, path, send: fields => api(t.token).post(path, fields) }
}
function proof(id) {
  const public_id = 'wondertutor/attendance/' + id + '/lesson'
  const version = 1700000000
  return { version, url: 'https://res.cloudinary.com/session-test/image/authenticated/v' + version + '/' + public_id + '.jpg',
    signature: cloudinary.utils.api_sign_request({ public_id, version }, env.cloudinary.apiSecret) }
}

test('physical check-in rechecks the saved radius, photo receipt, and lesson ownership', async () => {
  const { b, path, send } = await lesson({ teachingMode: 'PHYSICAL', latitude: 3, longitude: 101 })
  const coords = { lat: 3.001, lng: 101 }
  const payload = { action: 'check-in', coords, photo: proof(b.id) }
  expect((await api(p.token).get(path)).status).toBe(403)
  expect((await api((await makeTutor()).token).post(path, payload)).status).toBe(404)
  expect((await send(payload)).message).toContain('100 metres')
  await api(admin.token).patch('/admin/settings', { key: 'GPS_RADIUS_METRES', value: 150 })
  expect((await send({ ...payload, photo: proof(b.id + 1) })).status).toBe(400)
  expect((await send({ ...payload, photo: { ...payload.photo, signature: '0'.repeat(40) } })).status).toBe(400)
  expect((await send({ ...payload, distance: 0 })).status).toBe(400)
  const view = await send(payload)
  expect(view.attendance.distance).toBeCloseTo(111.19, 1)
  expect(view.attendance.photo).toContain('signature=')
  expect((await send(payload)).status).toBe(409)
  expect((await send({ action: 'check-out' })).status).toBe(409)
})

test('online attendance needs no location and completing the report publishes it to the parent once', async () => {
  const { b, send } = await lesson()
  const report = { action: 'report', content: 'Fractions', progressNote: 'Adds mixed fractions independently.', recommendations: 'Practise division.' }
  expect((await send(report)).status).toBe(409)
  expect((await send({ action: 'check-in' })).attendance.distance).toBeNull()
  expect((await send(report)).status).toBe(409)
  await prisma.booking.update({ where: { id: b.id }, data: { endAt: new Date(Date.now() - 1) } })
  expect((await send({ action: 'check-out' })).attendance.checkOutAt).toBeTruthy()
  expect((await send({ ...report, progressNote: '  ' })).status).toBe(400)
  const results = await Promise.all([send(report), send(report)])
  expect(results.map(r => r.status).sort()).toEqual([200, 409])
  const parentView = await api(p.token).get('/parent/bookings/' + b.publicId)
  expect(parentView.booking).toMatchObject({ status: 'COMPLETED', summary: { content: report.content, progressNote: report.progressNote } })
  expect(await prisma.notification.count({ where: { userId: p.user.id, type: 'LESSON_COMPLETED', link: '/parent/bookings?booking=' + b.publicId } })).toBe(1)
})

test('missing coordinates, unconfirmed bookings and future lessons cannot check in', async () => {
  const physical = await lesson({ teachingMode: 'PHYSICAL' })
  expect((await physical.send({ action: 'check-in', coords: { lat: 0, lng: 0 }, photo: proof(physical.b.id) })).status).toBe(409)
  const unpaid = await lesson({ status: 'AWAITING_PAYMENT' })
  expect((await unpaid.send({ action: 'check-in' })).status).toBe(409)
  const future = await lesson({ startAt: new Date(Date.now() + 30000) })
  expect((await future.send({ action: 'check-in' })).status).toBe(409)
})
