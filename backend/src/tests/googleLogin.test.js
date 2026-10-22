// Google sign-in (FR 1.11): new accounts, linking an existing account, and the cases that must be refused.
// Google's token check is replaced with a stand-in, so no request ever reaches Google.
import { OAuth2Client } from 'google-auth-library'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { api, makeParent, resetDb, startServer, stopServer } from './helpers.js'

const realVerify = OAuth2Client.prototype.verifyIdToken
// The "credential" sent by the test is the Google profile itself, as JSON; "bad" stands for a forged or expired token
function fakeGoogle() {
  OAuth2Client.prototype.verifyIdToken = async ({ idToken }) => {
    if (idToken === 'bad') throw new Error('Wrong number of segments in token: bad')
    const profile = JSON.parse(idToken)
    return { getPayload: () => ({ email_verified: true, picture: 'https://lh3.googleusercontent.com/a/photo', ...profile }) }
  }
}
const credential = (profile) => JSON.stringify(profile)
let n = 0
const newEmail = () => `google${Date.now()}${++n}@test.local`

beforeAll(async () => {
  await resetDb()
  await startServer()
  env.googleClientId = 'test-client-id'
  fakeGoogle()
})
afterAll(async () => {
  OAuth2Client.prototype.verifyIdToken = realVerify
  env.googleClientId = ''
  await stopServer()
})

describe('Google sign-in', () => {
  test('a new email needs a role, then gets a verified account without the Google photo', async () => {
    const email = newEmail()
    const noRole = await api().post('/auth/google', { credential: credential({ sub: `g-${email}`, email, name: 'Nur Aisyah' }) })
    expect(noRole.status).toBe(400)
    expect(noRole.message).toMatch(/choose Parent or Tutor/)

    const res = await api().post('/auth/google', { credential: credential({ sub: `g-${email}`, email, name: 'Nur Aisyah' }), role: 'TUTOR' })
    // A new account needs the Privacy Notice to be accepted: without it Google sign-up is refused
    expect(res.status).toBe(400)
    expect(res.message).toMatch(/Privacy Notice/)
    expect((await prisma.user.findUnique({ where: { email } }))).toBeNull()
    const accepted = await api().post('/auth/google', { credential: credential({ sub: `g-${email}`, email, name: 'Nur Aisyah' }), role: 'TUTOR', acceptedPrivacy: true })
    expect(accepted.status).toBe(200)
    expect((await prisma.user.findUnique({ where: { email } })).privacyAcceptedAt).not.toBeNull()
    Object.assign(res, accepted)
    expect(res.user).toMatchObject({ role: 'TUTOR', isEmailVerified: true, profilePhotoUrl: null, phone: null, tutorStatus: 'NOT_SUBMITTED' })
  })

  test('an existing verified account is linked and keeps its role', async () => {
    const { user } = await makeParent()
    const res = await api().post('/auth/google', { credential: credential({ sub: 'g-existing', email: user.email, name: 'Someone' }), role: 'TUTOR' })
    expect(res.status).toBe(200)
    expect(res.user.role).toBe('PARENT')
    expect((await prisma.user.findUnique({ where: { id: user.id } })).googleId).toBe('g-existing')
  })

  test('an unverified email signup is replaced, so the password its maker chose stops working', async () => {
    const email = newEmail()
    // Someone else registers this email with their own password and never verifies it
    expect((await api().post('/auth/register', { role: 'PARENT', fullName: 'Not The Owner', email, phone: '0123456789', password: 'Squatter123', acceptedPrivacy: true })).status).toBe(201)
    const squatter = await prisma.user.findUnique({ where: { email } })

    const res = await api().post('/auth/google', { credential: credential({ sub: `g-${email}`, email, name: 'Real Owner' }), role: 'PARENT', acceptedPrivacy: true })
    expect(res.status).toBe(200)
    expect(res.user.fullName).toBe('Real Owner')
    expect(await prisma.user.findUnique({ where: { id: squatter.id } })).toBeNull()
    const owner = await prisma.user.findUnique({ where: { email } })
    expect(owner.passwordHash).toBeNull()
    expect((await api().post('/auth/login', { email, password: 'Squatter123' })).status).toBe(401)
    expect(await prisma.emailOtp.count({ where: { email } })).toBe(0)
  })

  test('a deactivated account is refused and not modified', async () => {
    const { user } = await makeParent()
    await prisma.user.update({ where: { id: user.id }, data: { status: 'DEACTIVATED' } })
    const res = await api().post('/auth/google', { credential: credential({ sub: 'g-deactivated', email: user.email }) })
    expect(res.status).toBe(403)
    expect((await prisma.user.findUnique({ where: { id: user.id } })).googleId).toBeNull()
  })

  test('a Google account whose email is not verified is refused', async () => {
    const res = await api().post('/auth/google', { credential: credential({ sub: 'g-unverified', email: newEmail(), email_verified: false }), role: 'PARENT' })
    expect(res.status).toBe(400)
  })

  test('an invalid token gives a clean 401 without the library message', async () => {
    const res = await api().post('/auth/google', { credential: 'bad', role: 'PARENT' })
    expect(res.status).toBe(401)
    expect(res.message).toBe('Google sign-in could not be confirmed. Please try again.')
    expect(res.message).not.toMatch(/segments/)
  })

  test('without a client id Google sign-in answers 501', async () => {
    env.googleClientId = ''
    const res = await api().post('/auth/google', { credential: credential({ sub: 'x', email: newEmail() }), role: 'PARENT' })
    env.googleClientId = 'test-client-id'
    expect(res.status).toBe(501)
    expect(res.message).toMatch(/not configured/)
  })
})
