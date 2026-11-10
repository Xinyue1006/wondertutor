import { env } from '../config/env.js'
import { AppError } from '../utils/AppError.js'

// Verifies a Google reCAPTCHA v2 token. Skipped when RECAPTCHA_SECRET is not set (dev).
export async function verifyRecaptcha(token) {
  if (!env.recaptchaSecret) {
    if (env.nodeEnv === 'production') throw new AppError(503, 'Account verification is not configured. Please contact the centre.')
    return
  }
  if (!token) throw new AppError(400, 'Please complete the reCAPTCHA')

  let data
  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.recaptchaSecret, response: token }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error('Verification unavailable')
    data = await res.json()
  } catch {
    throw new AppError(502, 'Account verification is temporarily unavailable. Please try again.')
  }
  if (!data.success) throw new AppError(400, 'reCAPTCHA verification failed')
}
