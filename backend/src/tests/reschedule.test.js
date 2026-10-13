// Rescheduling: mutual agreement moves the lesson; no agreement escalates to Admin.
import { prisma } from '../config/prisma.js'
import { requestReschedule, respondReschedule } from '../services/reschedule.service.js'
import { bookingInclude } from '../services/booking.dto.js'
import { MONDAY, api, makeAdmin, makeBooking, makeChild, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

let parent, tutor, admin, date
beforeAll(async () => {
  await resetDb()
  await startServer()
  parent = await makeParent()
  tutor = await makeTutor() // Mondays + Wednesdays 16:00-20:00
  admin = await makeAdmin()
  date = nextDate(MONDAY)
})
afterAll(stopServer)

const confirmed = (start = '17:00', child = parent.child) =>
  makeBooking({ parent: parent.parent, child, tutor: tutor.tutor, date, start, status: 'CONFIRMED' })
const full = (b) => prisma.booking.findUnique({ where: { id: b.id }, include: bookingInclude })
const ask = (b, body) => api(parent.token).post(`/parent/bookings/${b.id}/reschedule`, body)
const answer = (b, rid, action) => api(parent.token).post(`/parent/bookings/${b.id}/reschedule/${rid}/${action}`)
const hhmm = (d) => new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' })

describe('parent asks to reschedule', () => {
  let b, rid
  test('asking creates a pending request and tells the tutor', async () => {
    b = await confirmed('17:00')
    const res = await ask(b, { date, startTime: '19:00', reason: 'School event' })
    expect(res.status).toBe(201)
    expect(res.booking.reschedule).toMatchObject({ status: 'PENDING', requestedBy: 'PARENT', reason: 'School event' })
    expect(hhmm(res.booking.startAt)).toBe('17:00') // nothing moves until the tutor agrees
    rid = res.booking.reschedule.id
    expect(await prisma.notification.count({ where: { userId: tutor.user.id, type: 'RESCHEDULE_REQUESTED' } })).toBe(1)
  })

  test('only one open request at a time, and the parent cannot approve their own request', async () => {
    expect((await ask(b, { date, startTime: '18:00' })).status).toBe(409)
    expect((await answer(b, rid, 'accept')).status).toBe(403)
  })

  test('when the tutor agrees, the lesson moves to the new time and the parent is told', async () => {
    await respondReschedule({ booking: await full(b), requestId: rid, byUserId: tutor.user.id, accept: true })
    const moved = await prisma.booking.findUnique({ where: { id: b.id } })
    expect(hhmm(moved.startAt)).toBe('19:00')
    expect(hhmm(moved.endAt)).toBe('20:00') // same lesson length
    expect(await prisma.notification.count({ where: { userId: parent.user.id, type: 'RESCHEDULE_APPROVED' } })).toBe(1)
  })

  test('a lesson can be moved into a time that overlaps its own old time', async () => {
    const own = await confirmed('16:00', await makeChild(parent.parent.id, { name: 'Mia' }))
    expect((await ask(own, { date, startTime: '16:30' })).status).toBe(201)
  })

  test('the new time must be inside the tutor availability and free', async () => {
    const other = await confirmed('18:00', await makeChild(parent.parent.id, { name: 'Ken' }))
    expect((await ask(other, { date, startTime: '21:00' })).status).toBe(400) // tutor not available
    expect((await ask(other, { date, startTime: '19:00' })).status).toBe(409) // taken by the lesson moved above
  })

  test('the parent can withdraw their own request', async () => {
    const c = await confirmed('17:00', await makeChild(parent.parent.id, { name: 'Zoe' }))
    const r = await ask(c, { date: nextDate(3), startTime: '17:00' })
    const w = await answer(c, r.booking.reschedule.id, 'withdraw')
    expect(w.status).toBe(200)
    expect(w.booking.reschedule.status).toBe('REJECTED')
  })

  test('requests that are not yet agreed (PENDING) cannot be rescheduled; cancel and rebook instead', async () => {
    const p = await makeBooking({ parent: parent.parent, child: await makeChild(parent.parent.id, { name: 'Leo' }), tutor: tutor.tutor, date, start: '16:00', status: 'PENDING' })
    expect((await ask(p, { date, startTime: '17:00' })).status).toBe(400)
  })
})

describe('tutor asks to reschedule', () => {
  test('the parent declining escalates to Admin and the lesson keeps its time', async () => {
    const child = await makeChild(parent.parent.id, { name: 'Ivy' })
    const b = await makeBooking({ parent: parent.parent, child, tutor: tutor.tutor, date: nextDate(3), start: '16:00', status: 'CONFIRMED' })
    const req = await requestReschedule({ booking: await full(b), byUserId: tutor.user.id, date: nextDate(3), startTime: '18:00', reason: 'Clinic appointment' })

    const view = await api(parent.token).get(`/parent/bookings/${b.id}`)
    expect(view.booking.reschedule).toMatchObject({ status: 'PENDING', requestedBy: 'TUTOR' })

    const declined = await answer(b, req.id, 'decline')
    expect(declined.status).toBe(200)
    expect(declined.booking.reschedule.status).toBe('ESCALATED')
    expect(hhmm(declined.booking.startAt)).toBe('16:00')
    expect(await prisma.notification.count({ where: { userId: admin.user.id, type: 'RESCHEDULE_ESCALATED' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: tutor.user.id, type: 'RESCHEDULE_ESCALATED' } })).toBe(1)
  })

  test('another parent cannot touch the booking', async () => {
    const stranger = await makeParent()
    const b = await confirmed('19:00', await makeChild(parent.parent.id, { name: 'Max' }))
    expect((await api(stranger.token).post(`/parent/bookings/${b.id}/reschedule`, { date, startTime: '16:00' })).status).toBe(404)
  })
})
