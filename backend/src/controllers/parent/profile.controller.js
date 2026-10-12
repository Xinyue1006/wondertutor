import bcrypt from 'bcrypt'
import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { findLocation } from '../../data/catalog.js'

const toDto = (user, parent) => ({
  fullName: user.fullName,
  email: user.email,
  phone: user.phone,
  profilePhotoUrl: user.profilePhotoUrl,
  address: parent.address,
  hasPassword: Boolean(user.passwordHash), // Google-only accounts have no password to change
})

// GET /parent/profile
export function getProfile(req, res) {
  res.json({ profile: toDto(req.user, req.parent) })
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(80),
  phone: z.string().trim().min(8, 'Enter a valid phone number').max(20),
  address: z.string().trim().max(200).optional().nullable(),
})

// PUT /parent/profile: email is the login identity, so it cannot be changed here
export async function updateProfile(req, res) {
  const data = profileSchema.parse(req.body)
  const loc = data.address ? findLocation(data.address) : null
  const [user, parent] = await prisma.$transaction([
    prisma.user.update({ where: { id: req.user.id }, data: { fullName: data.fullName, phone: data.phone } }),
    // Known areas also store coordinates, which the matching distance score uses
    prisma.parentProfile.update({
      where: { id: req.parent.id },
      data: { address: data.address || null, latitude: loc?.lat ?? null, longitude: loc?.lng ?? null },
    }),
  ])
  res.json({ profile: toDto(user, parent) })
}

// POST /parent/profile/password
export async function changePassword(req, res) {
  const { currentPassword, newPassword } = z
    .object({
      currentPassword: z.string().min(1, 'Enter your current password'),
      newPassword: z
        .string()
        .min(8, 'Password must be at least 8 characters')
        .regex(/[A-Za-z]/, 'Password must contain a letter')
        .regex(/\d/, 'Password must contain a number'),
    })
    .parse(req.body)

  if (!req.user.passwordHash) throw new AppError(400, 'This account signs in with Google and has no password')
  if (!(await bcrypt.compare(currentPassword, req.user.passwordHash))) throw new AppError(400, 'Current password is incorrect')
  if (currentPassword === newPassword) throw new AppError(400, 'Choose a password different from the current one')

  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } })
  res.json({ message: 'Password updated' })
}
