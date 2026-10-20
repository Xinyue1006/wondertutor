// Tutor sign-up and onboarding: reCAPTCHA on login, sign-up without profile details, the setup draft,
// submitting for verification, Admin approval of an identity document + a qualification, and the verification gate.
import bcrypt from 'bcrypt'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { api, makeAdmin, makeParent, resetDb, startServer, stopServer } from './helpers.js'

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

const PHOTO = 'https://res.cloudinary.com/demo/image/upload/tutor.jpg'
const DOC = 'https://res.cloudinary.com/demo/image/upload/cert.pdf'
let n = 0
const email = () => `newtutor${Date.now()}${++n}@test.local`

// Signs a tutor up through the real endpoints (register -> code -> verify) and returns the session
async function signUpTutor() {
  const address = email()
  const reg = await api().post('/auth/register', {
    role: 'TUTOR', fullName: 'Daniel Tan', email: address, phone: '012-345 6789', password: 'Tutor1234',
  })
  expect(reg.status).toBe(201)
  const codeHash = await bcrypt.hash('123456', 4)
  await prisma.emailOtp.updateMany({ where: { email: address }, data: { codeHash } })
  const verified = await api().post('/auth/verify-otp', { email: address, code: '123456' })
  expect(verified.status).toBe(200)
  return { token: verified.token, user: verified.user }
}

// Every step of the setup wizard, filled in
const COMPLETE_PROFILE = {
  gender: 'MALE',
  emergencyContactName: 'Lisa Tan',
  emergencyContactPhone: '012-000 0000',
  location: 'Petaling Jaya, Selangor',
  bio: 'Mathematics tutor helping Form 1-5 students build confidence step by step.',
  yearsExperience: 4,
  hourlyRate: 60,
  offersPhysical: true,
  offersOnline: true,
  languages: ['English'],
  subjects: [{ subject: 'Mathematics', educationLevel: 'SECONDARY', minGrade: 1, maxGrade: 5 }],
  profilePhotoUrl: PHOTO,
}

async function completeSetup(token) {
  expect((await api(token).put('/tutor/profile', COMPLETE_PROFILE)).status).toBe(200)
  expect((await api(token).post('/tutor/documents', { kind: 'IDENTITY', title: 'NRIC', documentUrl: DOC })).status).toBe(201)
  expect((await api(token).post('/tutor/documents', { kind: 'QUALIFICATION', title: 'BSc Mathematics', institution: 'UM', year: 2020, documentUrl: DOC })).status).toBe(201)
}

describe('login reCAPTCHA', () => {
  const realFetch = global.fetch
  afterEach(() => {
    env.recaptchaSecret = ''
    global.fetch = realFetch
  })

  test('is required when the secret is set, and a token Google rejects is refused', async () => {
    const { user } = await makeParent()
    env.recaptchaSecret = 'test-secret'
    // Answer Google's verify call ourselves; every other request goes to the test server as usual
    global.fetch = (url, opts) =>
      String(url).includes('recaptcha/api/siteverify')
        ? Promise.resolve({ json: async () => ({ success: String(opts.body).includes('response=good') }) })
        : realFetch(url, opts)

    const missing = await api().post('/auth/login', { email: user.email, password: 'Test1234' })
    expect(missing.status).toBe(400)
    expect(missing.message).toMatch(/reCAPTCHA/)
    expect((await api().post('/auth/login', { email: user.email, password: 'Test1234', recaptchaToken: 'bad' })).status).toBe(400)
    expect((await api().post('/auth/login', { email: user.email, password: 'Test1234', recaptchaToken: 'good' })).status).toBe(200)
  })

  test('is skipped when no secret is configured (development and tests)', async () => {
    const { user } = await makeParent()
    expect((await api().post('/auth/login', { email: user.email, password: 'Test1234' })).status).toBe(200)
  })
})

describe('tutor sign-up', () => {
  test('needs no gender or emergency contact; the new tutor starts as not submitted', async () => {
    const { token, user } = await signUpTutor()
    expect(user.role).toBe('TUTOR')
    expect(user.tutorStatus).toBe('NOT_SUBMITTED')
    const me = await api(token).get('/auth/me')
    expect(me.user.tutorStatus).toBe('NOT_SUBMITTED')
    const profile = await prisma.tutorProfile.findFirst({ where: { userId: user.id } })
    expect(profile.gender).toBeNull()
    expect(profile.emergencyContactName).toBeNull()
  })

  test('parents get no tutor status', async () => {
    const { token } = await makeParent()
    expect((await api(token).get('/auth/me')).user.tutorStatus).toBeNull()
  })
})

describe('profile setup', () => {
  test('saves each step as a partial draft and lists what is still missing', async () => {
    const { token } = await signUpTutor()
    const first = await api(token).put('/tutor/profile', { gender: 'FEMALE', location: 'Petaling Jaya, Selangor' })
    expect(first.status).toBe(200)
    expect(first.gender).toBe('FEMALE')
    expect(first.location).toBe('Petaling Jaya, Selangor')
    expect(first.missing).toContain('Hourly rate')
    expect(first.missing).not.toContain('Gender')

    const second = await api(token).put('/tutor/profile', { hourlyRate: 55 })
    expect(second.gender).toBe('FEMALE') // the earlier step is kept
    expect(second.hourlyRate).toBe(55)
  })

  test('rejects bad input: unknown area, own number as emergency contact, impossible grade, outside file links', async () => {
    const { token } = await signUpTutor()
    expect((await api(token).put('/tutor/profile', { location: 'Atlantis' })).status).toBe(400)
    expect((await api(token).put('/tutor/profile', { emergencyContactPhone: '0123456789' })).status).toBe(400)
    const grade = await api(token).put('/tutor/profile', { subjects: [{ subject: 'Mathematics', educationLevel: 'SECONDARY', minGrade: 1, maxGrade: 6 }] })
    expect(grade.status).toBe(400)
    expect((await api(token).put('/tutor/profile', { profilePhotoUrl: 'https://evil.example/x.jpg' })).status).toBe(400)
    expect((await api(token).put('/tutor/profile', { hourlyRate: 60.555 })).status).toBe(400)
    expect((await api(token).put('/tutor/profile', { isVerified: true })).status).toBe(400) // unknown fields are refused
  })

  test('submit is refused while anything required is missing, then accepted once complete, and only once', async () => {
    const { token } = await signUpTutor()
    const early = await api(token).post('/tutor/submit-for-verification')
    expect(early.status).toBe(400)
    expect(early.message).toMatch(/Identity document/)

    // Everything except the identity document
    await api(token).put('/tutor/profile', COMPLETE_PROFILE)
    await api(token).post('/tutor/documents', { kind: 'QUALIFICATION', title: 'BSc Mathematics', documentUrl: DOC })
    const noId = await api(token).post('/tutor/submit-for-verification')
    expect(noId.status).toBe(400)
    expect(noId.message).toMatch(/Identity document/)

    await api(token).post('/tutor/documents', { kind: 'IDENTITY', title: 'NRIC', documentUrl: DOC })
    const admin = await makeAdmin()
    const ok = await api(token).post('/tutor/submit-for-verification')
    expect(ok.status).toBe(200)
    expect(ok.submittedAt).toBeTruthy()
    expect((await api(token).get('/auth/me')).user.tutorStatus).toBe('UNDER_REVIEW')
    expect(await prisma.notification.count({ where: { userId: admin.user.id, type: 'TUTOR_SUBMITTED' } })).toBe(1)

    expect((await api(token).post('/tutor/submit-for-verification')).status).toBe(409)
  })
})

describe('verification', () => {
  test('a tutor is verified only after Admin approves an identity document and a qualification', async () => {
    const { token, user } = await signUpTutor()
    await completeSetup(token)
    await api(token).post('/tutor/submit-for-verification')
    const admin = await makeAdmin()
    const tutor = await prisma.tutorProfile.findFirst({ where: { userId: user.id }, include: { qualifications: true } })
    const idDoc = tutor.qualifications.find((d) => d.kind === 'IDENTITY')
    const degree = tutor.qualifications.find((d) => d.kind === 'QUALIFICATION')

    await api(admin.token).post(`/admin/qualifications/${degree.id}/review`, { status: 'APPROVED' })
    expect((await prisma.tutorProfile.findUnique({ where: { id: tutor.id } })).isVerified).toBe(false)

    await api(admin.token).post(`/admin/qualifications/${idDoc.id}/review`, { status: 'APPROVED' })
    expect((await prisma.tutorProfile.findUnique({ where: { id: tutor.id } })).isVerified).toBe(true)
    expect((await api(token).get('/auth/me')).user.tutorStatus).toBe('VERIFIED')
  })

  test('a rejected document asks for changes, and uploading a new one puts the profile back under review', async () => {
    const { token, user } = await signUpTutor()
    await completeSetup(token)
    await api(token).post('/tutor/submit-for-verification')
    const admin = await makeAdmin()
    const idDoc = await prisma.qualification.findFirst({ where: { tutor: { userId: user.id }, kind: 'IDENTITY' } })

    await api(admin.token).post(`/admin/qualifications/${idDoc.id}/review`, { status: 'REJECTED', note: 'Photo is blurry' })
    const after = await api(token).get('/tutor/profile')
    expect(after.status).toBe(200)
    expect(after.documents.find((d) => d.id === idDoc.id).reviewNote).toBe('Photo is blurry')
    expect((await api(token).get('/auth/me')).user.tutorStatus).toBe('CHANGES_REQUESTED')

    await api(token).post('/tutor/documents', { kind: 'IDENTITY', title: 'NRIC (clear copy)', documentUrl: DOC })
    expect((await api(token).get('/auth/me')).user.tutorStatus).toBe('UNDER_REVIEW')
  })

  test("a tutor cannot read or delete another tutor's document", async () => {
    const a = await signUpTutor()
    const b = await signUpTutor()
    await completeSetup(a.token)
    const doc = await prisma.qualification.findFirst({ where: { tutor: { userId: a.user.id }, kind: 'QUALIFICATION' } })

    expect((await api(b.token).del(`/tutor/documents/${doc.id}`)).status).toBe(404)
    expect((await api(b.token).get('/tutor/profile')).documents.map((d) => d.id)).not.toContain(doc.id)
    expect(await prisma.qualification.count({ where: { id: doc.id } })).toBe(1)
  })

  test('removing an approved document takes the badge away; removing a pending one changes nothing', async () => {
    const { token, user } = await signUpTutor()
    await completeSetup(token)
    await api(token).post('/tutor/submit-for-verification')
    const admin = await makeAdmin()
    const docs = await prisma.qualification.findMany({ where: { tutor: { userId: user.id } } })
    for (const d of docs) await api(admin.token).post(`/admin/qualifications/${d.id}/review`, { status: 'APPROVED' })
    expect((await api(token).get('/auth/me')).user.tutorStatus).toBe('VERIFIED')

    // An extra pending certificate can come and go without touching the badge
    await api(token).post('/tutor/documents', { kind: 'QUALIFICATION', title: 'Teaching certificate', documentUrl: DOC })
    const extra = await prisma.qualification.findFirst({ where: { tutor: { userId: user.id }, status: 'PENDING' } })
    expect((await api(token).del(`/tutor/documents/${extra.id}`)).isVerified).toBe(true)

    const idDoc = docs.find((d) => d.kind === 'IDENTITY')
    const removed = await api(token).del(`/tutor/documents/${idDoc.id}`)
    expect(removed.status).toBe(200)
    expect(removed.isVerified).toBe(false)
    expect((await api(token).get('/auth/me')).user.tutorStatus).toBe('CHANGES_REQUESTED')
    expect((await api(token).get('/tutor/dashboard')).status).toBe(403)

    // A new identity document goes back to Admin; approving it restores the badge
    await api(token).post('/tutor/documents', { kind: 'IDENTITY', title: 'NRIC', documentUrl: DOC })
    expect((await api(token).get('/auth/me')).user.tutorStatus).toBe('UNDER_REVIEW')
    const replacement = await prisma.qualification.findFirst({ where: { tutor: { userId: user.id }, kind: 'IDENTITY' } })
    await api(admin.token).post(`/admin/qualifications/${replacement.id}/review`, { status: 'APPROVED' })
    expect((await api(token).get('/auth/me')).user.tutorStatus).toBe('VERIFIED')
  })

  test('a photo that was not uploaded by the tutor (e.g. carried over from Google) does not count', async () => {
    const { token, user } = await signUpTutor()
    await completeSetup(token)
    await prisma.user.update({ where: { id: user.id }, data: { profilePhotoUrl: 'https://lh3.googleusercontent.com/a/photo' } })
    const res = await api(token).post('/tutor/submit-for-verification')
    expect(res.status).toBe(400)
    expect(res.message).toMatch(/Profile photo/)
  })

  test('the tutor is told about a review on the verification status page', async () => {
    const { token, user } = await signUpTutor()
    await completeSetup(token)
    const admin = await makeAdmin()
    const doc = await prisma.qualification.findFirst({ where: { tutor: { userId: user.id } } })
    await api(admin.token).post(`/admin/qualifications/${doc.id}/review`, { status: 'APPROVED' })
    const note = await prisma.notification.findFirst({ where: { userId: user.id, type: 'QUALIFICATION_REVIEWED' } })
    expect(note.link).toBe('/tutor/verification')
  })
})

describe('verification gate', () => {
  test('an unverified tutor reaches setup but not the teaching features; a verified tutor reaches both', async () => {
    const { token, user } = await signUpTutor()
    expect((await api(token).get('/tutor/profile')).status).toBe(200)
    const blocked = await api(token).get('/tutor/dashboard')
    expect(blocked.status).toBe(403)
    expect(blocked.message).toMatch(/verification/)

    await prisma.tutorProfile.updateMany({ where: { userId: user.id }, data: { isVerified: true } })
    expect((await api(token).get('/tutor/dashboard')).status).toBe(200)
  })

  test('parents and admins cannot use the tutor API', async () => {
    const parent = await makeParent()
    const admin = await makeAdmin()
    expect((await api(parent.token).get('/tutor/profile')).status).toBe(403)
    expect((await api(admin.token).get('/tutor/profile')).status).toBe(403)
    expect((await api().get('/tutor/profile')).status).toBe(401)
  })
})
