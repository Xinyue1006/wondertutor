import { env } from '../config/env.js'
import { prisma } from '../config/prisma.js'
import { childPhotoFields } from '../services/privateMedia.js'
import { api, apiBase, makeAdmin, makeBooking, makeParent, makeTutor, resetDb, startServer, stopServer, nextDate, MONDAY } from './helpers.js'

const original = { ...env.cloudinary }
let parent, other, tutor
const reference = (owner, name = 'avatar') => `https://res.cloudinary.com/child-test/image/authenticated/wondertutor/children/${owner.parent.id}/${name}.jpg`
const body = { name: 'Child Photo', educationLevel: 'PRIMARY', grade: 5 }
beforeAll(async () => {
  await resetDb(); await startServer()
  Object.assign(env.cloudinary, { cloudName: 'child-test', apiKey: 'test-public-key', apiSecret: 'test-private-secret' })
  parent = await makeParent(); other = await makeParent(); tutor = await makeTutor()
})
afterAll(async () => { Object.assign(env.cloudinary, original); await stopServer() })

test('child upload signatures are private, parent-scoped and parent-only; adult upload stays public', async () => {
  const sig = await api(parent.token).post('/uploads/signature', { purpose: 'child-avatar' })
  expect(sig.status).toBe(200)
  expect(sig.folder).toBe(`wondertutor/children/${parent.parent.id}`)
  expect(sig.type).toBe('authenticated')
  expect(sig.allowed_formats).toBe('jpg,jpeg,png')
  expect(JSON.stringify(sig)).not.toContain('test-private-secret')
  expect((await api(tutor.token).post('/uploads/signature', { purpose: 'child-avatar' })).status).toBe(403)
  const admin = await makeAdmin()
  expect((await api(admin.token).post('/uploads/signature', { purpose: 'child-avatar' })).status).toBe(403)
  expect((await api().post('/uploads/signature', { purpose: 'child-avatar' })).status).toBe(401)
  expect((await api(parent.token).post('/uploads/signature')).type).toBeUndefined()
})

test('canonical child references and temporary delivery links stay separate across edits', async () => {
  const created = await api(parent.token).post('/parent/children', { ...body, photoUrl: reference(parent) })
  expect(created.status).toBe(201)
  const child = created.child
  expect(child.photoReference).toBe(reference(parent))
  expect(child.photoNeedsMigration).toBe(false)
  expect(new URL(child.photoUrl).searchParams.get('public_id')).toBe(`wondertutor/children/${parent.parent.id}/avatar`)
  expect(Number(new URL(child.photoUrl).searchParams.get('expires_at'))).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 301)
  expect((await prisma.child.findUnique({ where: { id: child.id } })).photoUrl).toBe(reference(parent))
  expect((await api(parent.token).put(`/parent/children/${child.id}`, { ...body, name: 'Updated Child', photoUrl: child.photoReference })).status).toBe(200)
  expect((await api(parent.token).put(`/parent/children/${child.id}`, { ...body, photoUrl: child.photoUrl })).status).toBe(400)
  expect((await prisma.child.findUnique({ where: { id: child.id } })).photoUrl).toBe(reference(parent))
})

test('public, other-family, PDF and private-evidence substitutions are refused', async () => {
  for (const photoUrl of [
    'https://res.cloudinary.com/child-test/image/upload/public.jpg', reference(other),
    reference(parent).replace('.jpg', '.pdf'), reference(parent).replace('/children/', '/attendance/'),
  ]) expect((await api(parent.token).post('/parent/children', { ...body, photoUrl })).status).toBe(400)
  expect((await api(other.token).put(`/parent/children/${parent.child.id}`, { ...body, photoUrl: reference(other) })).status).toBe(404)
})

test('legacy public pictures are not rendered, and ordinary edits preserve their migration reference', async () => {
  const legacy = 'https://res.cloudinary.com/child-test/image/upload/old-child.jpg'
  await prisma.child.update({ where: { id: parent.child.id }, data: { photoUrl: legacy } })
  const list = await api(parent.token).get('/parent/children')
  const child = list.children.find(c => c.id === parent.child.id)
  expect(child.photoUrl).toBeNull()
  expect(child.photoReference).toBeUndefined()
  expect(child.photoNeedsMigration).toBe(true)
  expect((await api(parent.token).put(`/parent/children/${child.id}`, { ...body, name: 'Legacy preserved' })).status).toBe(200)
  expect((await prisma.child.findUnique({ where: { id: child.id } })).photoUrl).toBe(legacy)
  expect(JSON.stringify(await api(parent.token).get('/parent/dashboard'))).not.toContain(legacy)
})

test('private display links are used in bookings and export; private avatars cannot become public review images', async () => {
  await prisma.child.update({ where: { id: parent.child.id }, data: { photoUrl: reference(parent, 'booked') } })
  const booking = await makeBooking({ parent: parent.parent, child: parent.child, tutor: tutor.tutor, date: nextDate(MONDAY), start: '16:00', status: 'COMPLETED' })
  const rows = await api(parent.token).get('/parent/bookings')
  const dto = rows.bookings.find(b => b.id === booking.id)
  expect(dto.child.photoUrl).not.toBe(reference(parent, 'booked'))
  expect(new URL(dto.child.photoUrl).searchParams.get('public_id')).toContain('children/')
  const response = await fetch(apiBase() + '/parent/account/export', { headers: { Authorization: `Bearer ${parent.token}` } })
  const data = await response.json()
  const exported = data.children.find(c => c.name === 'Legacy preserved')
  expect(exported.photoReference).toBe(reference(parent, 'booked'))
  expect(exported.photoUrl).toContain('/image/download?')
  expect((await api(parent.token).post(`/parent/bookings/${booking.id}/review`, { rating: 5, photoUrl: reference(parent, 'booked') })).status).toBe(400)
})

test('missing storage configuration is not mislabeled as an old public photo', () => {
  const saved = env.cloudinary.cloudName
  env.cloudinary.cloudName = ''
  try {
    const fields = childPhotoFields({ parentId: parent.parent.id, photoUrl: reference(parent) })
    expect(fields.photoUrl).toBeNull()
    expect(fields.photoNeedsMigration).toBe(false)
    expect(fields.photoUnavailable).toBe(true)
    expect(fields.photoReference).toBeUndefined()
  } finally { env.cloudinary.cloudName = saved }
})
