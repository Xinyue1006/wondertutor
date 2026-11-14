import { prisma } from '../config/prisma.js'
import { api, makeBooking, makeParent, makeTutor, nextDate, MONDAY, resetDb, startServer, stopServer } from './helpers.js'

let nearby, remote, secondary, inactive, deleted, draft, noSubjects, family, hidden, visible
const route = '/public/tutors'

beforeAll(async () => {
  await resetDb()
  await startServer()
  nearby = await makeTutor({ rate: 60 })
  remote = await makeTutor({ rate: 45, physical: false })
  secondary = await makeTutor({ rate: 80 })
  inactive = await makeTutor()
  deleted = await makeTutor()
  draft = await makeTutor({ rate: 0 })
  noSubjects = await makeTutor()
  await prisma.tutorSubject.deleteMany({ where: { tutorId: noSubjects.tutor.id } })
  await prisma.user.update({ where: { id: nearby.user.id }, data: { fullName: 'Published Tutor', phone: '+60125555555' } })
  await prisma.tutorProfile.update({ where: { id: nearby.tutor.id }, data: { isVerified: true, ratingAvg: 3, ratingCount: 2, bio: 'Patient maths tutor with years of teaching experience.' } })
  await prisma.tutorProfile.update({ where: { id: remote.tutor.id }, data: { location: '12 Private Street, House 7', latitude: 2, longitude: 102 } })
  await prisma.tutorSubject.updateMany({ where: { tutorId: secondary.tutor.id }, data: { subject: 'Chemistry', educationLevel: 'SECONDARY', minGrade: 4, maxGrade: 5 } })
  await prisma.user.update({ where: { id: inactive.user.id }, data: { status: 'DEACTIVATED' } })
  await prisma.user.update({ where: { id: deleted.user.id }, data: { deletedAt: new Date() } })
  await prisma.qualification.createMany({ data: [
    { tutorId: nearby.tutor.id, kind: 'QUALIFICATION', title: 'Approved degree', status: 'APPROVED', institution: 'Test University', year: 2021, documentUrl: '/private/degree.pdf', reviewNote: 'Private approval note' },
    { tutorId: nearby.tutor.id, kind: 'QUALIFICATION', title: 'Pending degree', status: 'PENDING', documentUrl: '/private/pending.pdf' },
    { tutorId: nearby.tutor.id, kind: 'IDENTITY', title: 'Private NRIC', status: 'APPROVED', documentUrl: '/private/nric.pdf' },
  ] })
  family = await makeParent({ child: { name: 'Private Child' } })
  await prisma.user.update({ where: { id: family.user.id }, data: { fullName: 'Siti Secret Hamid' } })
  const date = nextDate(MONDAY)
  const first = await makeBooking({ parent: family.parent, child: family.child, tutor: nearby.tutor, date, status: 'COMPLETED' })
  visible = await prisma.review.create({ data: { bookingId: first.id, parentId: family.parent.id, tutorId: nearby.tutor.id, rating: 5, comment: 'Patient explanations and clear homework guidance.', photoUrl: 'https://example.test/private-family-photo.jpg' } })
  const second = await makeBooking({ parent: family.parent, child: family.child, tutor: nearby.tutor, date, start: '18:00', status: 'COMPLETED' })
  hidden = await prisma.review.create({ data: { bookingId: second.id, parentId: family.parent.id, tutorId: nearby.tutor.id, rating: 1, comment: 'Hidden moderation example.', isHidden: true, moderationReason: 'Private moderation reason' } })
})
afterAll(stopServer)

test('guests browse complete active tutor listings without signing in', async () => {
  const result = await api().get(route)
  expect(result.status).toBe(200)
  expect(result).toMatchObject({ total: 3, page: 1, pageSize: 9, totalPages: 1 })
  expect(result.tutors[0].id).toBe(nearby.tutor.id)
  expect(result.tutors.map(t => t.id)).not.toEqual(expect.arrayContaining([inactive.tutor.id, deleted.tutor.id, draft.tutor.id, noSubjects.tutor.id]))
  for (const tutor of result.tutors) {
    expect(tutor).not.toHaveProperty('isFavourite')
    expect(tutor).not.toHaveProperty('match')
    expect(tutor).not.toHaveProperty('latitude')
    expect(tutor).not.toHaveProperty('userId')
  }
  expect(result.tutors.find(t => t.id === remote.tutor.id).location).toBe('Location not specified')
})

test('guest filters use one teaching row for subject, level and grade, and support mode and prices', async () => {
  const chemistry = await api().get(`${route}?subject=Chemistry&level=SECONDARY&grade=5`)
  expect(chemistry.tutors.map(t => t.id)).toEqual([secondary.tutor.id])
  const primary = await api().get(`${route}?subject=Mathematics&level=PRIMARY&grade=5&mode=PHYSICAL&location=Kepong%2C%20Kuala%20Lumpur`)
  expect(primary.tutors.map(t => t.id)).toEqual([nearby.tutor.id])
  expect((await api().get(`${route}?minPrice=70&maxPrice=90`)).tutors.map(t => t.id)).toEqual([secondary.tutor.id])
  expect((await api().get(`${route}?subject=Mathematics&level=PRIMARY&grade=1`)).total).toBe(0)
})

test('price sorting, bounded pagination and out-of-range pages are deterministic', async () => {
  const first = await api().get(`${route}?sort=price_asc&pageSize=2`)
  const second = await api().get(`${route}?sort=price_asc&pageSize=2&page=999`)
  expect(first).toMatchObject({ total: 3, page: 1, totalPages: 2 })
  expect(first.tutors.map(t => t.hourlyRate)).toEqual([45, 60])
  expect(second).toMatchObject({ page: 2, totalPages: 2 })
  expect(second.tutors.map(t => t.hourlyRate)).toEqual([80])
})

test.each(['page=0', 'pageSize=31', 'grade=5', 'level=PRIMARY&grade=7', 'level=PRIMARY&subject=Chemistry', 'minPrice=80&maxPrice=20', 'sort=unsafe', 'level=UNKNOWN', 'subject=NotASubject', 'location=12%20Private%20Street'])('invalid public filter %s returns a friendly 400', async query => {
  const result = await api().get(`${route}?${query}`)
  expect(result.status).toBe(400)
  expect(typeof result.message).toBe('string')
})

test('anonymous profile exposes safe teaching facts, approved metadata and real available hours only', async () => {
  const result = await api().get(`${route}/${nearby.tutor.id}`)
  expect(result.status).toBe(200)
  expect(result.tutor.name).toBe('Published Tutor')
  expect(result.tutor.qualifications).toEqual([expect.objectContaining({ title: 'Approved degree', status: 'APPROVED' })])
  expect(result.tutor.upcomingAvailability).toHaveLength(7)
  expect(result.tutor.ratingDistribution.find(r => r.stars === 1).count).toBe(0)
  const text = JSON.stringify(result)
  for (const privateValue of ['+60125555555', nearby.user.email, 'Private NRIC', '/private/', 'Pending degree', 'Private approval note', 'Private Child', family.user.email]) expect(text).not.toContain(privateValue)
  for (const forbidden of ['passwordHash', 'googleId', 'userId', 'emergencyContactName', 'emergencyContactPhone', 'commissionRate', 'latitude', 'longitude', 'documentUrl', 'bookingId', 'childId', 'parentId']) expect(text).not.toContain(`"${forbidden}"`)
})

test('inactive, deleted and incomplete direct tutor URLs return 404; malformed IDs return 400', async () => {
  for (const item of [inactive, deleted, draft, noSubjects]) {
    expect((await api().get(`${route}/${item.tutor.id}`)).status).toBe(404)
    expect((await api().get(`${route}/${item.tutor.id}/reviews`)).status).toBe(404)
  }
  expect((await api().get(`${route}/1.5`)).status).toBe(400)
})

test('guest reviews mask parent names and omit children, family photos, moderation notes and hidden records', async () => {
  const result = await api().get(`${route}/${nearby.tutor.id}/reviews`)
  expect(result.status).toBe(200)
  expect(result.reviews).toEqual([expect.objectContaining({ id: visible.id, parentName: 'Parent S.S.H.', rating: 5 })])
  expect(result.total).toBe(1)
  const text = JSON.stringify(result)
  for (const value of ['Siti Secret Hamid', 'Private Child', 'Private moderation reason', 'private-family-photo', 'parentOf', 'photoUrl', 'bookingId', 'childId', 'parentId']) expect(text).not.toContain(value)
  expect((await api().get(`${route}/${nearby.tutor.id}/reviews?page=0`)).status).toBe(400)
  expect((await api().get(`${route}/${nearby.tutor.id}/reviews?sort=invalid`)).status).toBe(400)
})

test('landing reviews come from visible records and the featured tutors use the same public eligibility', async () => {
  const result = await api().get('/public/home')
  expect(result.status).toBe(200)
  expect(result.tutors.map(t => t.id)).toEqual([nearby.tutor.id])
  expect(result.reviews).toEqual([expect.objectContaining({ id: visible.id, parentName: 'Parent S.S.H.', tutorId: nearby.tutor.id, tutorName: 'Published Tutor' })])
  expect(result.reviews.length).toBeLessThanOrEqual(6)
  expect(result.reviews.map(r => r.id)).not.toContain(hidden.id)
})

test('public location choices include tutors in other states without publishing private street addresses', async () => {
  const original = await prisma.tutorProfile.findUnique({ where: { id: secondary.tutor.id }, select: { location: true } })
  try {
    await prisma.tutorProfile.update({ where: { id: secondary.tutor.id }, data: { location: 'Ipoh, Perak' } })
    const result = await api().get('/public/home')
    expect(result.locations).toEqual(expect.arrayContaining(['Kepong, Kuala Lumpur', 'Ipoh, Perak']))
    expect(result.locations).not.toContain('12 Private Street, House 7')
    expect(new Set(result.locations).size).toBe(result.locations.length)
  } finally {
    await prisma.tutorProfile.update({ where: { id: secondary.tutor.id }, data: original })
  }
})

test('legacy comments containing contact details are not republished anonymously', async () => {
  const original = visible.comment
  try {
    await prisma.review.update({ where: { id: visible.id }, data: { comment: 'Contact me at private@example.test' } })
    expect((await api().get(`${route}/${nearby.tutor.id}/reviews`)).reviews[0].comment).toBeNull()
    expect((await api().get('/public/home')).reviews).toHaveLength(0)
  } finally {
    await prisma.review.update({ where: { id: visible.id }, data: { comment: original } })
  }
})

test('landing reviews put five stars first while profile reviews keep their recent-first order', async () => {
  const bookings = [], reviews = []
  try {
    for (const [start, rating, offset] of [['19:00', 4, 60000], ['20:00', 5, -60000]]) {
      const booking = await makeBooking({ parent: family.parent, child: family.child, tutor: nearby.tutor, date: nextDate(MONDAY), start, status: 'COMPLETED' })
      bookings.push(booking.id)
      const review = await prisma.review.create({ data: {
        bookingId: booking.id, parentId: family.parent.id, tutorId: nearby.tutor.id, rating,
        comment: 'Helpful teaching and thoughtful feedback.', createdAt: new Date(visible.createdAt.getTime() + offset),
      } })
      reviews.push(review)
    }
    const landing = await api().get('/public/home')
    expect(landing.reviews.map(review => review.id)).toEqual([visible.id, reviews[1].id, reviews[0].id])
    expect(landing.reviews.map(review => review.rating)).toEqual([5, 5, 4])
    const profile = await api().get(`${route}/${nearby.tutor.id}/reviews`)
    expect(profile.reviews[0].id).toBe(reviews[0].id)
    expect((await prisma.review.findUnique({ where: { id: reviews[0].id } })).rating).toBe(4)
  } finally {
    await prisma.review.deleteMany({ where: { id: { in: reviews.map(review => review.id) } } })
    await prisma.booking.deleteMany({ where: { id: { in: bookings } } })
  }
})

test('public browsing never unlocks bookings, favourites, children or parent-only endpoints', async () => {
  const visitor = api()
  await visitor.get(`${route}/${nearby.tutor.id}`)
  expect((await visitor.post('/parent/bookings', {})).status).toBe(401)
  expect((await visitor.post(`/parent/favourites/${nearby.tutor.id}`)).status).toBe(401)
  expect((await visitor.get('/parent/children')).status).toBe(401)
  expect((await visitor.get('/parent/bookings')).status).toBe(401)
})
