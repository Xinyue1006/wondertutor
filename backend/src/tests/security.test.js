// Security rules that must keep holding: uploads only from our own Cloudinary account, a live site refuses weak secrets,
// forged logins are refused, and nobody can sign up as an admin or skip the Privacy Notice.
import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'
import { productionProblems } from '../config/env.js'
import { isOwnUpload } from '../utils/validators.js'
import { api, makeAdmin, makeParent, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

describe('uploads must be in our own Cloudinary account', () => {
  const ours = 'https://res.cloudinary.com/our-cloud/image/upload/me.jpg'
  const theirs = 'https://res.cloudinary.com/someone-elses-cloud/image/upload/me.jpg'
  const original = env.cloudinary.cloudName
  beforeEach(() => { env.cloudinary.cloudName = 'our-cloud' })
  afterEach(() => { env.cloudinary.cloudName = original })

  test('the rule itself', () => {
    expect(isOwnUpload(ours)).toBe(true)
    expect(isOwnUpload(theirs)).toBe(false)
    expect(isOwnUpload('https://res.cloudinary.com.evil.example/our-cloud/x.jpg')).toBe(false) // look-alike host
    expect(isOwnUpload('https://evil.example/res.cloudinary.com/our-cloud/x.jpg')).toBe(false)
    expect(isOwnUpload('javascript:alert(1)')).toBe(false)
    expect(isOwnUpload(null)).toBe(false)
  })

  test('profile, child and review photos from another account are refused; ours are accepted', async () => {
    const p = await makeParent()
    expect((await api(p.token).put('/parent/profile/photo', { profilePhotoUrl: theirs })).status).toBe(400)
    expect((await api(p.token).put('/parent/profile/photo', { profilePhotoUrl: ours })).status).toBe(200)
    const child = { name: 'Sarah', educationLevel: 'PRIMARY', grade: 5 }
    expect((await api(p.token).post('/parent/children', { ...child, photoUrl: theirs })).status).toBe(400)
    expect((await api(p.token).post('/parent/children', { ...child, photoUrl: ours })).status).toBe(201)
  })
})

describe('a live site refuses unsafe settings', () => {
  const safe = { jwtSecret: 'k8Zp3vQ9xT2mL7wB5nR1cY6dF4hJ0sGa', smtp: { user: 'noreply@example.com' }, clientUrl: 'https://wondertutor.example' }

  test('a weak or short secret stops the server', () => {
    expect(productionProblems(safe).stop).toEqual([])
    for (const weak of ['change-me', 'secret', 'short', 'a'.repeat(31), 'my-secret-key-my-secret-key-my-secret-key', 'password123password123password123']) {
      expect(productionProblems({ ...safe, jwtSecret: weak }).stop).toHaveLength(1)
    }
    expect(productionProblems({ ...safe, jwtSecret: '' }).stop).toHaveLength(1)
  })

  test('missing email settings and a localhost address are warned about, not fatal', () => {
    const { stop, warn } = productionProblems({ ...safe, smtp: {}, clientUrl: 'http://localhost:5173' })
    expect(stop).toEqual([])
    expect(warn).toHaveLength(2)
  })
})

describe('attacks that must fail', () => {
  const forge = (payload, secret) => jwt.sign(payload, secret, { expiresIn: '1h' })

  test('a login signed with the wrong secret is refused, for every role', async () => {
    for (const role of ['ADMIN', 'PARENT', 'TUTOR']) {
      for (const secret of ['change-me', 'secret', 'test-secret-but-wrong']) {
        const res = await api(forge({ sub: 1, role }, secret)).get(role === 'ADMIN' ? '/admin/users' : role === 'PARENT' ? '/parent/profile' : '/tutor/profile')
        expect(res.status).toBe(401)
      }
    }
  })

  test('a token that says it needs no signature (alg none) is refused', async () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 1, role: 'ADMIN' })}.`
    expect((await api(token).get('/admin/users')).status).toBe(401)
  })

  test('a parent cannot use admin or tutor pages, and an admin cannot use the parent portal', async () => {
    const parent = await makeParent()
    const admin = await makeAdmin()
    expect((await api(parent.token).get('/admin/users')).status).toBe(403)
    expect((await api(parent.token).get('/tutor/profile')).status).toBe(403)
    expect((await api(admin.token).get('/parent/profile')).status).toBe(403)
  })

  test('nobody can sign up as an admin', async () => {
    const res = await api().post('/auth/register', { role: 'ADMIN', fullName: 'Evil Admin', email: 'evil@test.local', phone: '0123456789', password: 'Passw0rdX', acceptedPrivacy: true })
    expect(res.status).toBe(400)
  })

  test('extra fields sent at sign-up (verified, admin, status) are ignored', async () => {
    const res = await api().post('/auth/register', {
      role: 'PARENT', fullName: 'Sneaky Parent', email: 'sneaky@test.local', phone: '0123456789', password: 'Passw0rdX', acceptedPrivacy: true,
      isEmailVerified: true, status: 'ACTIVE', id: 1, passwordHash: 'x',
    })
    expect(res.status).toBe(201)
    const { prisma } = await import('../config/prisma.js')
    const user = await prisma.user.findUnique({ where: { email: 'sneaky@test.local' } })
    expect(user.isEmailVerified).toBe(false) // still has to prove the email with the code
    expect(user.passwordHash).not.toBe('x')
  })
})
