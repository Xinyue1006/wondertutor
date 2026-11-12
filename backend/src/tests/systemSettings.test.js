import { api, makeAdmin, makeTutor, resetDb, startServer, stopServer } from './helpers.js'
import { prisma } from '../config/prisma.js'
import { recomputeVerified } from '../services/tutorSetup.service.js'

let admin
beforeAll(async () => {
  await startServer()
  await resetDb()
  admin = api((await makeAdmin()).token)
})
afterAll(stopServer)

const path = '/admin/settings'
test('only admins can read or change platform settings', async () => {
  const tutor = api((await makeTutor()).token)
  expect((await api().get(path)).status).toBe(401)
  expect((await tutor.get(path)).status).toBe(403)
  expect((await tutor.patch(path, { key: 'GPS_RADIUS_METRES', value: 60 })).status).toBe(403)
})

test('each setting saves independently and invalid values leave the saved value intact', async () => {
  for (const [key, value, invalid] of [['GPS_RADIUS_METRES', 150, 301], ['RATING_THRESHOLD', 3.5, 6]]) {
    expect((await admin.patch(path, { key, value })).status).toBe(200)
    expect((await admin.patch(path, { key, value: invalid })).status).toBe(400)
  }
  expect(await admin.get(path)).toMatchObject({ GPS_RADIUS_METRES: 150, RATING_THRESHOLD: 3.5, BASE_COMMISSION_RATE: 10 })
  expect((await admin.patch(path, { key: 'BASE_COMMISSION_RATE', value: 101 })).status).toBe(400)
})

test('existing verified tutors retain their rate and newly verified tutors receive the saved base', async () => {
  const { tutor: existing } = await makeTutor()
  await prisma.tutorProfile.update({ where: { id: existing.id }, data: { isVerified: true } })
  const { tutor } = await makeTutor()
  await prisma.qualification.createMany({ data: ['IDENTITY', 'QUALIFICATION'].map(kind => ({
    kind, tutorId: tutor.id, status: 'APPROVED', title: kind, documentUrl: '/sample',
  })) })
  expect((await admin.patch(path, { key: 'BASE_COMMISSION_RATE', value: 12.75 })).status).toBe(200)
  await prisma.$transaction(tx => recomputeVerified(tx, tutor.id))
  expect((await prisma.tutorProfile.findUnique({ where: { id: tutor.id } })).commissionRate.toNumber()).toBe(12.75)
  expect((await prisma.tutorProfile.findUnique({ where: { id: existing.id } })).commissionRate.toNumber()).toBe(10)
})
