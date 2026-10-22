// Form checks shown next to each field before anything is sent. They mirror backend/src/utils/validators.js,
// so the message the parent sees here is the same one the server would give (the server still checks everything).
// Each check returns an error message, or '' when the value is fine.

export const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_CHARS = /^[\p{L}\p{M}][\p{L}\p{M} .'\-/@()]*$/u
const MY_PHONE = /^\+60(1\d{8,9}|[3-9]\d{7,8})$/

export function checkEmail(v) {
  const s = (v || '').trim()
  if (!s) return 'Enter your email address.'
  if (s.length > 254 || !EMAIL_OK.test(s)) return 'Enter a valid email, like you@example.com.'
  return ''
}

export function checkName(v, label = 'Full name', max = 80) {
  const s = (v || '').trim()
  if (!s) return `Enter the ${label.toLowerCase()}.`
  if (s.length < 2) return `${label} must be at least 2 characters.`
  if (s.length > max) return `${label} must be ${max} characters or fewer.`
  if (!NAME_CHARS.test(s)) return `${label} can only contain letters, spaces and . ' - /`
  return ''
}

// Phone numbers are sent in international form (+60123456789), like the server stores them.
//  - Without a "+" the number is Malaysian: "012-345 6789", "03-1234 5678" and so on.
//  - With a "+" the country code is taken as given. "+60..." is checked as Malaysian, any other country only for a sensible
//    length (an international number has at most 15 digits).
// Returns the international form, or null when it cannot be a phone number.
const WORLD_PHONE = /^\+[1-9]\d{7,14}$/
export function normalizePhone(v) {
  const text = String(v || '').trim()
  const digits = text.replace(/[\s\-().]/g, '').replace(/^\+/, '')
  if (!/^\d+$/.test(digits)) return null
  const n = text.startsWith('+') && !digits.startsWith('60') ? `+${digits}` : `+60${digits.replace(/^60/, '').replace(/^0/, '')}`
  return (n.startsWith('+60') ? MY_PHONE : WORLD_PHONE).test(n) ? n : null
}

export function checkPhone(v, label = 'Phone number') {
  const text = String(v || '').trim()
  if (!text) return `Enter the ${label.toLowerCase()}.`
  if (normalizePhone(text)) return ''
  const foreign = text.startsWith('+') && !text.replace(/[\s\-().]/g, '').startsWith('+60')
  return foreign
    ? `Enter a valid ${label.toLowerCase()} with its country code, like +65 9123 4567.`
    : `Enter a valid Malaysian ${label.toLowerCase()}, like 012-345 6789.`
}

export function checkPassword(v) {
  const s = v || ''
  if (s.length < 8) return 'Password must be at least 8 characters.'
  if (s.length > 72) return 'Password must be 72 characters or fewer.'
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Password must contain a letter and a number.'
  return ''
}

// RM amounts: more than 0, at most `max`, and no fractions of a sen
export function checkRinggit(v, label = 'Amount', max = 1000) {
  if (v === '' || v == null) return `Enter the ${label.toLowerCase()}.`
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return `${label} must be more than RM0.`
  if (n > max) return `${label} cannot be more than RM${max}.`
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return `${label} can have at most 2 decimal places.`
  return ''
}

export function checkText(v, { label = 'This field', min = 0, max }) {
  const s = (v || '').trim()
  if (min && s.length < min) return min === 1 ? `Enter the ${label.toLowerCase()}.` : `${label} needs at least ${min} characters.`
  if (max && s.length > max) return `${label} must be ${max} characters or fewer.`
  return ''
}

// Tutor profile (mirrors hourlyRate / yearsExperience in validators.js)
export const HOURLY_RATE_MAX = 500
export const checkHourlyRate = (v) => checkRinggit(v, 'Hourly rate', HOURLY_RATE_MAX)

export function checkYears(v) {
  if (v === '' || v == null) return 'Enter your years of experience.'
  const n = Number(v)
  if (!Number.isInteger(n)) return 'Years of experience must be a whole number.'
  if (n < 0) return 'Years of experience cannot be negative.'
  if (n > 60) return 'Years of experience must be 60 or fewer.'
  return ''
}

// Emailed code rules (mirror OTP_TTL_MINUTES, MAX_ATTEMPTS and RESEND_COOLDOWN_SECONDS in backend/src/services/otp.service.js)
export const OTP_MINUTES = 10
export const OTP_TRIES = 5
export const RESEND_SECONDS = 60

// Photos must be uploaded to our Cloudinary account (mirrors cloudinaryUrl in validators.js)
export const isOwnUpload = (url) => typeof url === 'string' && url.startsWith('https://res.cloudinary.com/')
