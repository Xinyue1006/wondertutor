import bcrypt from 'bcrypt'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { findLocation } from '../../data/catalog.js'
import { cleanPreferences, preferencesSchema } from '../../utils/preferences.js'
import { imageUrl, optionalText, password, personName, phoneMY } from '../../utils/validators.js'

const toDto = (user, parent) => ({
  fullName: user.fullName,
  email: user.email,
  memberSince: user.createdAt,
  phone: user.phone,
  profilePhotoUrl: user.profilePhotoUrl,
  address: parent.address,
  addressKnown: Boolean(findLocation(parent.address)), // is the saved area a place we can find on the map (so distance works)?
  preferences: parent.preferences ?? null,
  hasPassword: Boolean(user.passwordHash), // Google-only accounts have no password to change
  emailReminders: user.emailReminders,
  privacyAcceptedAt: user.privacyAcceptedAt,
})

// GET /parent/profile
export function getProfile(req, res) {
  res.json({ profile: toDto(req.user, req.parent) })
}

const profileSchema = z.object({
  fullName: personName('Full name'),
  // Optional so preferences can be saved by a parent who signed up with Google and has no number yet; a number that is
  // sent is checked like everywhere else. An empty one is left as it was.
  phone: z.union([phoneMY('Phone number'), z.literal('')]).optional(),
  address: optionalText(200, 'Address'),
  preferences: preferencesSchema.optional().nullable(), // omitted = leave as is; null = clear
  // Only images uploaded to our own Cloudinary account are accepted as profile photos
  profilePhotoUrl: imageUrl().optional().nullable(),
})

// PUT /parent/profile: email is the login identity, so it cannot be changed here
export async function updateProfile(req, res) {
  const data = profileSchema.parse(req.body)
  const loc = data.address ? findLocation(data.address) : null
  const [user, parent] = await prisma.$transaction([
    prisma.user.update({ where: { id: req.user.id }, data: { fullName: data.fullName, ...(data.phone && { phone: data.phone }), ...(data.profilePhotoUrl !== undefined && { profilePhotoUrl: data.profilePhotoUrl }) } }),
    // Known areas also store coordinates, which the matching distance score uses
    prisma.parentProfile.update({
      where: { id: req.parent.id },
      data: {
        address: data.address || null,
        latitude: loc?.lat ?? null,
        longitude: loc?.lng ?? null,
        ...(data.preferences !== undefined && { preferences: cleanPreferences(data.preferences) ?? Prisma.DbNull }),
      },
    }),
  ])
  res.json({ profile: toDto(user, parent) })
}

// PUT /parent/profile/photo { profilePhotoUrl }: saved as soon as a photo is uploaded or removed, on its own, so it
// is not lost when the page is refreshed before "Save Changes" (and unsaved edits in the form are not touched)
export async function updatePhoto(req, res) {
  const { profilePhotoUrl } = z
    .object({ profilePhotoUrl: imageUrl().nullable() })
    .parse(req.body)
  await prisma.user.update({ where: { id: req.user.id }, data: { profilePhotoUrl } })
  res.json({ profilePhotoUrl })
}

// POST /parent/profile/password
export async function changePassword(req, res) {
  const { currentPassword, newPassword } = z
    .object({
      currentPassword: z.string().min(1, 'Enter your current password').max(200, 'Current password is incorrect'),
      newPassword: password,
    })
    .parse(req.body)

  if (!req.user.passwordHash) throw new AppError(400, 'This account signs in with Google and has no password')
  if (!(await bcrypt.compare(currentPassword, req.user.passwordHash))) throw new AppError(400, 'Current password is incorrect')
  if (currentPassword === newPassword) throw new AppError(400, 'Choose a password different from the current one')

  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12) } })
  res.json({ message: 'Password updated' })
}
