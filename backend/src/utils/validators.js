// Shared input rules, so every endpoint checks a name, phone, password or date the same way
// (and the same way as the signup and profile forms in the frontend, see frontend/src/lib/validation.js).
import { z } from 'zod'
import { env } from '../config/env.js'

// ── People ──
export const email = z.string().trim().toLowerCase().max(254, 'Email is too long').email('Enter a valid email address')

// Real names: letters in any script (Malay, Chinese, Tamil...), spaces and the punctuation used in Malaysian names
// ("Rajesh a/l Kumar", "Nur Aisyah binti Ahmad", "O'Neil", "Tan Hui-Wen"). Digits and symbols are rejected.
const NAME_CHARS = /^[\p{L}\p{M}][\p{L}\p{M} .'\-/@()]*$/u
export const personName = (label = 'Full name', max = 80) =>
  z.string().trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(max, `${label} must be ${max} characters or fewer`)
    .regex(NAME_CHARS, `${label} can only contain letters, spaces and . ' - /`)
    .transform((v) => v.replace(/\s+/g, ' '))

// Phone numbers are stored in international form (+60123456789).
//  - Without a "+" the number is Malaysian and any common way of writing it is accepted ("012-345 6789", "03-1234 5678").
//    Mobile numbers are 01X + 7 or 8 digits; landlines are 0[3-9] + 7 or 8 digits.
//  - With a "+" the country code is taken as given: "+60..." is checked as Malaysian above, any other country is checked
//    only for a sensible length (international numbers are at most 15 digits), because every country writes them differently.
export const MY_PHONE = /^\+60(1\d{8,9}|[3-9]\d{7,8})$/
const WORLD_PHONE = /^\+[1-9]\d{7,14}$/
export function normalizePhone(raw) {
  const text = String(raw).trim()
  const digits = text.replace(/[\s\-().]/g, '').replace(/^\+/, '')
  if (!/^\d+$/.test(digits)) return null
  if (text.startsWith('+') && !digits.startsWith('60')) return `+${digits}`
  const local = digits.replace(/^60/, '').replace(/^0/, '')
  return `+60${local}`
}
export const isValidPhone = (n) => Boolean(n) && (n.startsWith('+60') ? MY_PHONE.test(n) : WORLD_PHONE.test(n))
export const phoneMY = (label = 'Phone number') =>
  z.string().trim().max(24, `${label} is too long`)
    .transform((v, ctx) => {
      const n = normalizePhone(v)
      if (!isValidPhone(n)) {
        const foreign = v.trim().startsWith('+') && !v.trim().replace(/[\s\-().]/g, '').startsWith('+60')
        ctx.addIssue({
          code: 'custom',
          message: foreign
            ? `Enter a valid ${label.toLowerCase()} with its country code, like +65 9123 4567`
            : `Enter a valid Malaysian ${label.toLowerCase()}, like 012-345 6789`,
        })
        return z.NEVER
      }
      return n
    })
// Same rules, under a name that does not say "Malaysian" now that other countries are accepted
export const phone = phoneMY

// bcrypt only uses the first 72 bytes of a password, so anything longer would be silently cut off
export const password = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number')

export const otpCode = z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits')

// ── Records ──
export const MAX_ID = 2_147_483_647 // MySQL INT, the type of every primary key
export const id = (label = 'ID') => z.number({ message: `${label} is required` }).int(`${label} is invalid`).positive(`${label} is invalid`).max(MAX_ID, `${label} is invalid`)

// ── Dates and times (Malaysia time, as strings from the date/time pickers) ──
// The regex alone would accept "2026-02-31"; the round trip through Date proves it is a real calendar date.
export const ymd = (message = 'Choose a valid date') =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message).refine((s) => {
    const d = new Date(`${s}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, message)

export const hhmm = (message = 'Choose a valid time') => z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, message)

// ── Money (RM): positive, at most 2 decimal places, with a sane ceiling ──
export const ringgit = (label = 'Amount', max = 1000) =>
  z.number({ message: `Enter the ${label.toLowerCase()}` })
    .positive(`${label} must be more than RM0`)
    .max(max, `${label} cannot be more than RM${max}`)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, `${label} can have at most 2 decimal places (sen)`)

// Optional free text: trimmed, length-capped, and "" treated as not given
export const optionalText = (max, label = 'Text') =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer`).optional().nullable()
    .transform((v) => (v ? v : v === '' ? null : v))

// ── Tutor profile ──
// The fee a tutor asks per hour. The ceiling keeps a typo (RM6000 for RM60) from reaching parents.
export const HOURLY_RATE_MAX = 500
export const hourlyRate = ringgit('Hourly rate', HOURLY_RATE_MAX)
export const yearsExperience = z.number({ message: 'Enter your years of experience' }).int('Years of experience must be a whole number')
  .min(0, 'Years of experience cannot be negative').max(60, 'Years of experience must be 60 or fewer')

// Files are uploaded straight to OUR Cloudinary account (POST /uploads/signature). An address is only accepted when it points
// into that account ("https://res.cloudinary.com/<our cloud name>/..."): Cloudinary hosts millions of other accounts, and
// a link into one of those could show a stranger's file inside our pages. (Without a cloud name configured, which only
// happens in development, any Cloudinary address passes so the forms can still be tried.)
export const ownUploadPrefix = () => (env.cloudinary.cloudName ? `https://res.cloudinary.com/${env.cloudinary.cloudName}/` : 'https://res.cloudinary.com/')
export const isOwnUpload = (url) => typeof url === 'string' && url.startsWith(ownUploadPrefix())

export const cloudinaryUrl = (label = 'File') =>
  z.string().trim().max(500, `${label} link is too long`).url(`${label} link is invalid`)
    .refine(isOwnUpload, `${label} must be uploaded through WonderTutor`)
// A photo (profile, child, review): optional, and from our account only
export const imageUrl = () => z.string().max(500).url('Invalid photo').refine(isOwnUpload, 'Invalid photo')
