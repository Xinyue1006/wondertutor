// When the code email cannot be sent: forgot password must not reveal which emails have an account,
// and resend says plainly that it could not send. The email service is replaced so no mail is sent.
import { jest } from '@jest/globals'

jest.unstable_mockModule('../services/email.service.js', () => ({
  sendEmail: async () => { throw new Error('SMTP connection refused') },
}))

const { prisma } = await import('../config/prisma.js')
const { api, makeParent, resetDb, startServer, stopServer } = await import('./helpers.js')

beforeAll(async () => {
  await resetDb()
  await startServer()
})
afterAll(stopServer)

describe('code email fails to send', () => {
  test('forgot password gives the same answer for a known and an unknown email', async () => {
    const { user } = await makeParent()
    const known = await api().post('/auth/forgot-password', { email: user.email })
    const unknown = await api().post('/auth/forgot-password', { email: 'nobody@nowhere.test' })
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(known.message).toBe(unknown.message)
    // The code that was never delivered is not left behind
    expect(await prisma.emailOtp.count({ where: { email: user.email } })).toBe(0)
  })

  test('resend tells the user the code could not be sent, and a retry is not blocked by the 60-second wait', async () => {
    const { user } = await makeParent()
    await prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: false } })
    const first = await api().post('/auth/resend-otp', { email: user.email })
    expect(first.status).toBe(502)
    expect(first.message).toMatch(/could not send the code/)
    expect((await api().post('/auth/resend-otp', { email: user.email })).status).toBe(502) // not 429
  })
})
