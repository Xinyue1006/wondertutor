import { prisma } from '../config/prisma.js'
import { api, makeAdmin, makeBooking, makeParent, makeTutor, resetDb, startServer, stopServer } from './helpers.js'

let admin, author, reporter, tutor
beforeAll(async () => {
  await resetDb(); await startServer()
  admin = await makeAdmin()
  author = await makeParent({ child: { name: 'Private child name' } })
  reporter = await makeParent()
  tutor = await makeTutor()
})
afterAll(stopServer)
let slot = 8
const lesson = (parent = author, chosenTutor = tutor) => makeBooking({ parent: parent.parent, child: parent.child, tutor: chosenTutor.tutor, date: '2026-10-01', start: `${String(slot++).padStart(2, '0')}:00`, status: 'COMPLETED' })
const post = (booking, body, parent = author) => api(parent.token).post(`/parent/bookings/${booking.id}/review`, body)

test('negative feedback is allowed while common abuse is rejected without losing the review opportunity', async () => {
  const b = await lesson()
  const rejected = await post(b, { rating: 1, comment: 'This f.u.c.k tutor should go away' })
  expect(rejected.status).toBe(400)
  expect(rejected.issues[0].path).toEqual(['comment'])
  expect(await prisma.review.count({ where: { bookingId: b.id } })).toBe(0)
  expect((await post(b, { rating: 1, photoUrl: 'https://res.cloudinary.com/demo/image/authenticated/private-evidence.jpg' })).status).toBe(400)
  expect((await post(b, { rating: 1, comment: 'The tutor was late and the class was disappointing.' })).status).toBe(201)
  expect((await api(tutor.token).post(`/parent/bookings/${b.id}/review`, { rating: 5 })).status).toBe(403)
})

test('concurrent different-parent reviews keep cached averages and counts correct', async () => {
  const chosenTutor = await makeTutor()
  const a = await lesson(author, chosenTutor), b = await lesson(reporter, chosenTutor)
  const results = await Promise.all([post(a, { rating: 1 }), post(b, { rating: 5 }, reporter)])
  expect(results.map((r) => r.status)).toEqual([201, 201])
  const stored = await prisma.tutorProfile.findUnique({ where: { id: chosenTutor.tutor.id } })
  expect(stored.ratingCount).toBe(2)
  expect(stored.ratingAvg).toBe(3)
  expect((await post(a, { rating: 5 })).status).toBe(409)
})

test('a report is private, deduplicated, and visible in the existing complaint workflow', async () => {
  const b = await lesson()
  const created = await post(b, { rating: 5, comment: 'A useful lesson with clear explanations.' })
  const id = created.review.id
  const path = `/parent/reviews/${id}/report`
  expect((await api().post(path, { reason: 'Other' })).status).toBe(401)
  expect((await api(tutor.token).post(path, { reason: 'Other' })).status).toBe(403)
  const results = await Promise.all([api(reporter.token).post(path, { reason: 'Spam or advertising' }), api(reporter.token).post(path, { reason: 'Spam or advertising' })])
  expect(results.map((r) => r.status).sort()).toEqual([201, 409])
  const report = results.find((r) => r.status === 201)
  expect(report.complaint.review.id).toBe(id)
  expect(report.complaint.booking).toBeNull()
  expect(JSON.stringify(report)).not.toContain('Private child name')
  expect((await api(reporter.token).get('/parent/complaints')).complaints.some((c) => c.review?.id === id)).toBe(true)
  expect((await api(admin.token).get(`/admin/complaints/${report.complaint.id}`)).complaint.review.id).toBe(id)
  expect((await prisma.review.findUnique({ where: { id } })).isHidden).toBe(false)
})

test('admin hide/restore records a reason, excludes hidden ratings, and rejects stale decisions', async () => {
  const chosenTutor = await makeTutor()
  const b = await lesson(author, chosenTutor)
  const created = await post(b, { rating: 1, comment: 'Too little preparation for this lesson.' })
  const id = created.review.id
  const path = `/admin/reviews/${id}/moderation`
  const hide = { isHidden: true, expectedHidden: false, reason: 'Reported photo exposes personal information.' }
  expect((await api(author.token).patch(path, hide)).status).toBe(403)
  expect((await api(admin.token).patch(path, { ...hide, reason: '' })).status).toBe(400)
  expect((await api(admin.token).patch(path, hide)).status).toBe(200)
  expect((await api(admin.token).patch(path, hide)).status).toBe(409)
  const publicReviews = await api(reporter.token).get(`/parent/tutors/${chosenTutor.tutor.id}/reviews`)
  expect(publicReviews.total).toBe(0)
  expect((await prisma.tutorProfile.findUnique({ where: { id: chosenTutor.tutor.id } })).ratingCount).toBe(0)
  const stored = await prisma.review.findUnique({ where: { id } })
  expect(stored.moderatedById).toBe(admin.user.id)
  expect(stored.comment).toBe('Too little preparation for this lesson.')
  expect((await api(admin.token).patch(path, { isHidden: false, expectedHidden: true, reason: 'Investigated; legitimate criticism. Photo is safe.' })).status).toBe(200)
  expect((await api(reporter.token).get(`/parent/tutors/${chosenTutor.tutor.id}/reviews`)).total).toBe(1)
  expect((await prisma.tutorProfile.findUnique({ where: { id: chosenTutor.tutor.id } })).ratingAvg).toBe(1)
  expect(await prisma.notification.count({ where: { userId: author.user.id, type: 'REVIEW_MODERATED' } })).toBe(2)
})

test('repeated copied reviews are bounded while short ordinary feedback remains allowed', async () => {
  const parent = await makeParent()
  const comment = 'The lesson was enjoyable and the explanations were very clear for my child.'
  for (let i = 0; i < 2; i++) expect((await post(await lesson(parent), { rating: 5, comment }, parent)).status).toBe(201)
  expect((await post(await lesson(parent), { rating: 5, comment }, parent)).status).toBe(400)
  expect((await post(await lesson(parent), { rating: 3, comment: 'Good class' }, parent)).status).toBe(201)
})
