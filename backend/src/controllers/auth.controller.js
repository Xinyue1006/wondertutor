import bcrypt from 'bcrypt'
import { z } from 'zod'
import { OAuth2Client } from 'google-auth-library'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/AppError.js'
import { signToken } from '../services/token.service.js'
import { issueOtp, checkOtp } from '../services/otp.service.js'
import { verifyRecaptcha } from '../services/recaptcha.service.js'
import { cleanPreferences, preferencesSchema } from '../utils/preferences.js'
import { findLocation } from '../data/catalog.js'

// Never send passwordHash etc. to the client
export function toUserDto(u) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    fullName: u.fullName,
    phone: u.phone,
    profilePhotoUrl: u.profilePhotoUrl,
    isEmailVerified: u.isEmailVerified,
    status: u.status,
  }
}

const registerSchema = z
  .object({
    role: z.enum(['PARENT', 'TUTOR'], { message: 'Role must be PARENT or TUTOR' }),
    fullName: z.string().trim().min(2, 'Full name is required'),
    email: z.string().trim().toLowerCase().email('Invalid email address'),
    phone: z.string().trim().min(8, 'Phone number is required'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Za-z]/, 'Password must contain a letter')
      .regex(/\d/, 'Password must contain a number'),
    recaptchaToken: z.string().optional(),
    // Parent-only (signup "Basic Information" + optional "My Children" sections)
    address: z.string().trim().max(200).optional(),
    children: z
      .array(
        z.object({
          name: z.string().trim().min(1),
          educationLevel: z.enum(['KINDERGARTEN', 'PRIMARY', 'SECONDARY']),
          grade: z.coerce.number().int().min(1).max(6),
          subject: z.string().trim().min(1).max(60).optional(), // the subject the child needs tuition in
          notes: z.string().trim().max(500).optional(), // learning needs or goals
        }),
      )
      .max(5)
      .optional(),
    preferences: preferencesSchema.optional(),
    // Tutor-only
    gender: z.enum(['MALE', 'FEMALE', 'UNSPECIFIED']).optional(),
    emergencyContactName: z.string().trim().optional(),
    emergencyContactPhone: z.string().trim().optional(),
  })
  .refine((d) => d.role !== 'TUTOR' || (d.gender && d.emergencyContactName && d.emergencyContactPhone), {
    message: 'Gender and emergency contact are required for tutors',
  })

// POST /api/auth/register
export async function register(req, res) {
  const data = registerSchema.parse(req.body)
  await verifyRecaptcha(data.recaptchaToken)

  const existing = await prisma.user.findUnique({ where: { email: data.email } })
  if (existing?.isEmailVerified) throw new AppError(409, 'An account with this email already exists')

  const passwordHash = await bcrypt.hash(data.password, 12)
  const location = data.address ? findLocation(data.address) : null

  await prisma.$transaction(async (tx) => {
    // Allow retrying signup with an unverified email (e.g. typo in details)
    if (existing) await tx.user.delete({ where: { id: existing.id } })

    await tx.user.create({
      data: {
        email: data.email,
        passwordHash,
        role: data.role,
        fullName: data.fullName,
        phone: data.phone,
        ...(data.role === 'PARENT' && {
          parent: {
            create: {
              address: data.address || null,
              // Known areas also store coordinates: the matching distance score needs them from the very first search
              latitude: location?.lat ?? null,
              longitude: location?.lng ?? null,
              preferences: cleanPreferences(data.preferences) ?? undefined,
              children: { create: (data.children ?? []).map((c) => ({ ...c, notes: c.notes || null })) },
            },
          },
        }),
        ...(data.role === 'TUTOR' && {
          tutor: {
            create: {
              gender: data.gender,
              emergencyContactName: data.emergencyContactName,
              emergencyContactPhone: data.emergencyContactPhone,
            },
          },
        }),
      },
    })
  })

  await issueOtp(data.email)
  res.status(201).json({ message: 'Account created. Please check your email for the verification code.' })
}

// POST /api/auth/verify-otp
export async function verifyOtp(req, res) {
  const { email, code } = z
    .object({ email: z.string().trim().toLowerCase().email(), code: z.string().length(6, 'Code must be 6 digits') })
    .parse(req.body)

  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) throw new AppError(404, 'Account not found')

  await checkOtp(email, code)
  const verified = await prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: true } })

  res.json({ token: signToken(verified), user: toUserDto(verified) })
}

// POST /api/auth/resend-otp
export async function resendOtp(req, res) {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email() }).parse(req.body)
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || user.isEmailVerified) throw new AppError(400, 'Nothing to verify for this email')
  await issueOtp(email)
  res.json({ message: 'A new code has been sent' })
}

// ───────────── Forgot / reset password ─────────────
const newPasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number')

// POST /api/auth/forgot-password { email }
// Always gives the same answer, so nobody can use this form to find out which emails have an account.
export async function forgotPassword(req, res) {
  const { email } = z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email address') }).parse(req.body)
  const user = await prisma.user.findUnique({ where: { email } })
  if (user && user.status !== 'DEACTIVATED') {
    try {
      await issueOtp(email, 'reset')
    } catch (err) {
      if (err.status !== 429) throw err // "wait 60 s" is not shown either: it would reveal that the account exists
    }
  }
  res.json({ message: 'If an account uses this email, we have sent a 6-digit code to it.' })
}

// POST /api/auth/reset-password { email, code, newPassword }
export async function resetPassword(req, res) {
  const { email, code, newPassword } = z
    .object({
      email: z.string().trim().toLowerCase().email('Enter a valid email address'),
      code: z.string().length(6, 'Code must be 6 digits'),
      newPassword: newPasswordSchema,
    })
    .parse(req.body)
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || user.status === 'DEACTIVATED') throw new AppError(400, 'Code expired, please request a new one')
  await checkOtp(email, code)
  // Proving access to the inbox also verifies the email (useful for an account that never finished signup)
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12), isEmailVerified: true } })
  res.json({ message: 'Your password has been reset. You can now log in.' })
}

// POST /api/auth/login
export async function login(req, res) {
  const { email, password } = z
    .object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) })
    .parse(req.body)

  const user = await prisma.user.findUnique({ where: { email } })
  const ok = user?.passwordHash && (await bcrypt.compare(password, user.passwordHash))
  if (!ok) throw new AppError(401, 'Incorrect email or password')
  if (!user.isEmailVerified) throw new AppError(403, 'Please verify your email before logging in')
  if (user.status === 'DEACTIVATED') throw new AppError(403, 'Your account has been deactivated. Please contact Admin.')

  res.json({ token: signToken(user), user: toUserDto(user) })
}

// POST /api/auth/google  { credential, role? }
// Google already verified the email, so no reCAPTCHA / OTP / password needed
const googleClient = new OAuth2Client()
export async function googleLogin(req, res) {
  if (!env.googleClientId) throw new AppError(501, 'Google login is not configured')
  const { credential, role } = z
    .object({ credential: z.string(), role: z.enum(['PARENT', 'TUTOR']).optional() })
    .parse(req.body)

  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: env.googleClientId })
  const g = ticket.getPayload()
  if (!g?.email_verified) throw new AppError(400, 'Google account email is not verified')
  const email = g.email.toLowerCase()

  let user = await prisma.user.findFirst({ where: { OR: [{ googleId: g.sub }, { email }] } })

  if (user) {
    if (!user.googleId) user = await prisma.user.update({ where: { id: user.id }, data: { googleId: g.sub, isEmailVerified: true } })
  } else {
    if (!role) throw new AppError(400, 'Please choose Parent or Tutor to sign up with Google')
    user = await prisma.user.create({
      data: {
        email,
        googleId: g.sub,
        role,
        fullName: g.name || email,
        profilePhotoUrl: g.picture,
        isEmailVerified: true,
        ...(role === 'PARENT' && { parent: { create: {} } }),
        // Tutor fills in gender / emergency contact on the profile page afterwards
        ...(role === 'TUTOR' && { tutor: { create: { gender: 'UNSPECIFIED', emergencyContactName: '', emergencyContactPhone: '' } } }),
      },
    })
  }

  if (user.status === 'DEACTIVATED') throw new AppError(403, 'Your account has been deactivated. Please contact Admin.')
  res.json({ token: signToken(user), user: toUserDto(user) })
}

// GET /api/auth/me
export async function me(req, res) {
  res.json({ user: toUserDto(req.user) })
}
