// Shared helpers for the integration tests: boot the real Express app against the TEST database,
// create users/tutors/children quickly, and make authenticated requests.
import http from 'node:http'
import bcrypt from 'bcrypt'
import { prisma } from '../config/prisma.js'
import { createSession, csrfForSession, sessionCookieName } from '../services/session.service.js'
import app from '../app.js'
import { addDays, mytParts, mytToDate, todayMyt } from '../utils/time.js'

let server
let baseUrl

export async function startServer() {
  server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
}

// Base URL of the running test server, for requests that are not JSON (e.g. CSV downloads)
export const apiBase = () => baseUrl

export async function stopServer() {
  await new Promise((resolve) => server.close(resolve))
  await prisma.$disconnect()
}

// Test fixtures retain the `token` property name, but its value is an opaque
// cookie credential backed by AuthSession, never a browser JWT/Bearer token.
export const authHeaders = (token) => token ? { Cookie: `${sessionCookieName()}=${token}`, 'X-CSRF-Token': csrfForSession(token) } : {}
export const testSession = async (user) => (await createSession(user)).raw

// A small cookie jar exercises the same CSRF bootstrap/rotation as the browser.
// api(token).post('/parent/bookings', body) -> { ...json, status: <HTTP status code> }
export function api(token) {
  const cookies = new Map(token ? [[sessionCookieName(), token]] : [])
  let csrfToken = token ? csrfForSession(token) : null
  const saveCookies = (res) => {
    for (const header of res.headers.getSetCookie()) {
      const [pair] = header.split(';')
      const split = pair.indexOf('=')
      const name = pair.slice(0, split), value = pair.slice(split + 1)
      if (!value || /max-age=0/i.test(header)) cookies.delete(name)
      else cookies.set(name, value)
    }
  }
  const headers = () => ({ 'Content-Type': 'application/json', ...(cookies.size && { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') }) })
  const call = async (method, path, body) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !csrfToken) {
      const bootstrap = await fetch(baseUrl + '/auth/csrf', { headers: headers() })
      saveCookies(bootstrap)
      csrfToken = (await bootstrap.json()).csrfToken
    }
    const res = await fetch(baseUrl + path, {
      method,
      headers: { ...headers(), ...(csrfToken && { 'X-CSRF-Token': csrfToken }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    saveCookies(res)
    const data = await res.json().catch(() => ({}))
    if (data.csrfToken) csrfToken = data.csrfToken
    // HTTP status last, so a JSON field called "status" (e.g. booking status) can't hide it
    return { ...data, status: res.status }
  }
  return { get session() { return cookies.get(sessionCookieName()) }, get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b), put: (p, b) => call('PUT', p, b), patch: (p, b) => call('PATCH', p, b), del: (p) => call('DELETE', p) }
}

// Empty every table (children first) so each test file starts from a known state
export async function resetDb() {
  for (const model of [
    'authSession',
    'accountWarning', 'refund', 'payment', 'review', 'attendance', 'sessionSummary', 'rescheduleRequest', 'complaint', 'booking',
    'notification', 'matchingRequest', 'favouriteTutor', 'withdrawal', 'bankAccount', 'availabilitySlot',
    'availabilityException', 'portfolioItem', 'qualification', 'tutorSubject', 'child', 'tutorProfile', 'parentProfile', 'emailOtp', 'user', 'systemSetting',
  ]) await prisma[model].deleteMany()
  await prisma.systemSetting.createMany({
    data: [
      { key: 'BASE_COMMISSION_RATE', value: '10' },
      { key: 'RATING_THRESHOLD', value: '3.0' },
      { key: 'GPS_RADIUS_METRES', value: '100' },
    ],
  })
}

let counter = 0
const unique = () => `${Date.now()}${++counter}`
const passwordHash = bcrypt.hashSync('Test1234', 4) // low cost: tests don't need slow hashes

export async function makeParent({ child = {} } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `parent${unique()}@test.local`, passwordHash, role: 'PARENT', fullName: 'Test Parent', phone: '+60123456789', isEmailVerified: true,
      parent: { create: { address: 'Kepong, Kuala Lumpur', children: { create: { name: 'Sarah', educationLevel: 'PRIMARY', grade: 5, subject: 'Mathematics', ...child } } } },
    },
    include: { parent: { include: { children: true } } },
  })
  return { user, parent: user.parent, child: user.parent.children[0], token: await testSession(user) }
}

export async function makeChild(parentId, data = {}) {
  return prisma.child.create({ data: { parentId, name: 'Adam', educationLevel: 'PRIMARY', grade: 5, ...data } })
}

// A tutor teaching Primary 4-6 Maths, available Mondays 16:00-20:00 and Wednesdays 16:00-20:00
export async function makeTutor({ rate = 50, commissionRate = null, online = true, physical = true, availability } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `tutor${unique()}@test.local`, passwordHash, role: 'TUTOR', fullName: 'Test Tutor', isEmailVerified: true,
      tutor: {
        create: {
          gender: 'FEMALE', emergencyContactName: 'X', emergencyContactPhone: '+60120000000', hourlyRate: rate, commissionRate,
          offersOnline: online, offersPhysical: physical, location: 'Kepong, Kuala Lumpur', latitude: 3.2087, longitude: 101.6366,
          subjects: { create: { subject: 'Mathematics', educationLevel: 'PRIMARY', minGrade: 4, maxGrade: 6 } },
          availability: { create: availability ?? [{ dayOfWeek: 1, startTime: '16:00', endTime: '20:00' }, { dayOfWeek: 3, startTime: '16:00', endTime: '20:00' }] },
        },
      },
    },
    include: { tutor: true },
  })
  return { user, tutor: user.tutor, token: await testSession(user) }
}

export async function makeAdmin() {
  const user = await prisma.user.create({
    data: { email: `admin${unique()}@test.local`, passwordHash, role: 'ADMIN', fullName: 'Test Admin', isEmailVerified: true },
  })
  return { user, token: await testSession(user) }
}

// The next date (YYYY-MM-DD, Malaysia time) that falls on `dow` (0 = Sunday), at least 2 days from now
export function nextDate(dow) {
  let d = addDays(todayMyt(), 2)
  while (mytParts(mytToDate(d, '12:00')).dow !== dow) d = addDays(d, 1)
  return d
}
export const MONDAY = 1
export const WEDNESDAY = 3

// Directly insert a booking in any state (the Tutor Portal doesn't exist yet to move bookings along)
export async function makeBooking({ parent, child, tutor, date, start = '17:00', status = 'PENDING', price = 50, extra = {} }) {
  const startAt = mytToDate(date, start)
  const endAt = new Date(startAt.getTime() + 3600000)
  return prisma.booking.create({
    data: {
      parentId: parent.id, childId: child.id, tutorId: tutor.id, subject: 'Mathematics', startAt, endAt,
      teachingMode: 'ONLINE', proposedPrice: price, agreedPrice: ['AWAITING_PAYMENT', 'CONFIRMED', 'COMPLETED'].includes(status) ? price : null,
      status, ...extra,
    },
  })
}
