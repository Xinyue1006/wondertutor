import { env } from '../config/env.js'
import { AppError } from '../utils/AppError.js'

// Verifies a Google reCAPTCHA v2 token. Skipped when RECAPTCHA_SECRET is not set (dev).
export async function verifyRecaptcha(token) {
  if (!env.recaptchaSecret) return
  if (!token) throw new AppError(400, 'Please complete the reCAPTCHA')

  const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: env.recaptchaSecret, response: token }),
  })
  const data = await res.json()
  if (!data.success) throw new AppError(400, 'reCAPTCHA verification failed')
}
