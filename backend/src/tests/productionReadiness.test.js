import { jest } from '@jest/globals'
import { env } from '../config/env.js'
import { verifyRecaptcha } from '../services/recaptcha.service.js'
import { createSession, deleteUserSessions, getSession, _clearAll } from '../services/assistant/session.js'

const originalFetch = global.fetch
const originalNodeEnv = env.nodeEnv
const originalSecret = env.recaptchaSecret
afterEach(() => {
  global.fetch = originalFetch
  env.nodeEnv = originalNodeEnv
  env.recaptchaSecret = originalSecret
  _clearAll()
})

test('production does not silently bypass missing reCAPTCHA configuration', async () => {
  env.nodeEnv = 'production'
  env.recaptchaSecret = ''
  await expect(verifyRecaptcha('token')).rejects.toMatchObject({ status: 503 })
})

test('reCAPTCHA requests are time-bounded and transport failures get a safe error', async () => {
  env.recaptchaSecret = 'mock-secret'
  global.fetch = jest.fn(async (_url, options) => {
    expect(options.signal).toBeInstanceOf(AbortSignal)
    throw new Error('sensitive upstream transport detail')
  })
  await expect(verifyRecaptcha('token')).rejects.toMatchObject({ status: 502, message: 'Account verification is temporarily unavailable. Please try again.' })
})

test('deleting an account clears only its assistant conversations and aborts active work', () => {
  const a = { id: 1001 }, b = { id: 1002 }
  const pa = { id: 2001 }, pb = { id: 2002 }
  const first = createSession(a, pa), second = createSession(a, pa), other = createSession(b, pb)
  first.active = { ac: new AbortController() }
  deleteUserSessions(a.id)
  expect(getSession(first.id, a, pa)).toBeNull()
  expect(getSession(second.id, a, pa)).toBeNull()
  expect(first.active.ac.signal.aborted).toBe(true)
  expect(getSession(other.id, b, pb)).toBe(other)
})
