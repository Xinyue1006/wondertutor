// Tutor profile setup and verification [YH].
// A new tutor fills in the setup wizard as a draft, submits it, and Admin reviews the uploaded documents.
// Until Admin approves an identity document AND a qualification, the tutor only reaches setup, status and preview.
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { findLocation } from '../data/catalog.js'
import { notify } from './notification.service.js'
import { isOwnUpload } from '../utils/validators.js'

export const TUTOR_STATUS = {
  NOT_SUBMITTED: 'NOT_SUBMITTED', // setup still a draft
  UNDER_REVIEW: 'UNDER_REVIEW', // submitted, Admin has documents to look at
  CHANGES_REQUESTED: 'CHANGES_REQUESTED', // Admin rejected every document of one kind; the tutor must upload a new one
  VERIFIED: 'VERIFIED',
}

export const setupInclude = {
  user: true,
  subjects: true,
  qualifications: { orderBy: { createdAt: 'desc' } },
  portfolio: true,
}

// Derived, not stored: it always agrees with isVerified and the document statuses Admin sets
export function tutorStatus(t) {
  if (t.isVerified) return TUTOR_STATUS.VERIFIED
  if (!t.verificationSubmittedAt) return TUTOR_STATUS.NOT_SUBMITTED
  const docs = t.qualifications || []
  const stillUsable = (kind) => docs.some((d) => d.kind === kind && d.status !== 'REJECTED')
  if (!stillUsable('IDENTITY') || !stillUsable('QUALIFICATION')) return TUTOR_STATUS.CHANGES_REQUESTED
  return TUTOR_STATUS.UNDER_REVIEW
}

// The verified badge rule, used by Admin's review and when a tutor removes a document:
// an approved identity document AND at least one approved qualification. `db` may be a transaction.
export async function recomputeVerified(db, tutorId) {
  const approved = await db.qualification.groupBy({ by: ['kind'], where: { tutorId, status: 'APPROVED' } })
  const kinds = new Set(approved.map((r) => r.kind))
  const isVerified = kinds.has('IDENTITY') && kinds.has('QUALIFICATION')
  await db.tutorProfile.update({ where: { id: tutorId }, data: { isVerified } })
  return isVerified
}

// A photo the tutor uploaded themselves (FR 1.8), not one carried over from elsewhere
const ownPhoto = (url) => isOwnUpload(url)

// Status for the logged-in user (GET /auth/me, login), so the frontend can route a tutor without another call
export async function tutorStatusForUser(user) {
  if (user.role !== 'TUTOR') return null
  const t = await prisma.tutorProfile.findUnique({
    where: { userId: user.id },
    select: { isVerified: true, verificationSubmittedAt: true, qualifications: { select: { kind: true, status: true } } },
  })
  return t ? tutorStatus(t) : TUTOR_STATUS.NOT_SUBMITTED
}

// Everything that must be filled in before the setup can be submitted (empty list = ready)
export function missingForSubmit(t) {
  const missing = []
  const docs = t.qualifications.filter((d) => d.status !== 'REJECTED')
  if (!t.user.phone) missing.push('Phone number')
  if (!t.gender) missing.push('Gender')
  if (!t.emergencyContactName || !t.emergencyContactPhone) missing.push('Emergency contact')
  if (!t.location) missing.push('Home area')
  if (!t.subjects.length) missing.push('At least one subject')
  if (!(Number(t.hourlyRate) > 0)) missing.push('Hourly rate')
  if (!t.offersPhysical && !t.offersOnline) missing.push('Teaching mode (physical or online)')
  if (!t.bio || t.bio.trim().length < 30) missing.push('About me (at least 30 characters)')
  if (!docs.some((d) => d.kind === 'IDENTITY')) missing.push('Identity document (NRIC or passport)')
  if (!docs.some((d) => d.kind === 'QUALIFICATION')) missing.push('At least one qualification')
  if (!ownPhoto(t.user.profilePhotoUrl)) missing.push('Profile photo')
  return missing
}

export function toSetupDto(t) {
  return {
    status: tutorStatus(t),
    submittedAt: t.verificationSubmittedAt,
    isVerified: t.isVerified,
    fullName: t.user.fullName,
    email: t.user.email,
    isEmailVerified: t.user.isEmailVerified,
    phone: t.user.phone,
    profilePhotoUrl: t.user.profilePhotoUrl,
    gender: t.gender,
    emergencyContactName: t.emergencyContactName,
    emergencyContactPhone: t.emergencyContactPhone,
    location: t.location,
    bio: t.bio,
    teachingApproach: t.teachingApproach,
    yearsExperience: t.yearsExperience,
    hourlyRate: Number(t.hourlyRate),
    offersPhysical: t.offersPhysical,
    offersOnline: t.offersOnline,
    languages: t.languages || [],
    characteristics: t.characteristics || [],
    subjects: t.subjects.map(({ subject, educationLevel, minGrade, maxGrade }) => ({ subject, educationLevel, minGrade, maxGrade })),
    documents: t.qualifications.map(({ id, kind, title, institution, year, documentUrl, status, reviewNote, createdAt }) => ({
      id, kind, title, institution, year, documentUrl, status, reviewNote, createdAt,
    })),
    portfolio: t.portfolio.map(({ id, title, description, fileUrl }) => ({ id, title, description, fileUrl })),
    missing: missingForSubmit(t),
  }
}

export const loadSetup = (tutorId) => prisma.tutorProfile.findUnique({ where: { id: tutorId }, include: setupInclude })

// Partial save: only the fields sent are changed, so each wizard step can save a draft on its own
export async function saveProfile(tutor, data) {
  const { fullName, phone, profilePhotoUrl, subjects, location, ...profile } = data
  const area = location === undefined ? undefined : location ? findLocation(location) : null
  if (location && !area) throw new AppError(400, 'Choose your home area from the list')

  await prisma.$transaction(async (tx) => {
    const userData = { fullName, phone, profilePhotoUrl }
    if (Object.values(userData).some((v) => v !== undefined)) await tx.user.update({ where: { id: tutor.userId }, data: userData })

    await tx.tutorProfile.update({
      where: { id: tutor.id },
      data: {
        ...profile,
        // Coordinates come from the known area list: the distance score in matching needs them
        ...(area !== undefined && { location: area?.name ?? null, latitude: area?.lat ?? null, longitude: area?.lng ?? null }),
      },
    })

    // Subjects are replaced as a whole list, the way the form edits them
    if (subjects) {
      await tx.tutorSubject.deleteMany({ where: { tutorId: tutor.id } })
      if (subjects.length) await tx.tutorSubject.createMany({ data: subjects.map((s) => ({ ...s, tutorId: tutor.id })) })
    }
  })
  return loadSetup(tutor.id)
}

export async function addDocument(tutor, data) {
  const count = await prisma.qualification.count({ where: { tutorId: tutor.id } })
  if (count >= 10) throw new AppError(400, 'You can upload up to 10 documents. Remove one first.')
  return prisma.qualification.create({ data: { ...data, tutorId: tutor.id } })
}

// Removing an approved document puts the verified badge on hold until Admin approves a replacement:
// the badge is worked out again from what is left. Pending or rejected documents never affect it.
export async function removeDocument(tutor, id) {
  const doc = await prisma.qualification.findFirst({ where: { id, tutorId: tutor.id } })
  if (!doc) throw new AppError(404, 'Document not found')
  const isVerified = await prisma.$transaction(async (tx) => {
    await tx.qualification.delete({ where: { id: doc.id } })
    return doc.status === 'APPROVED' ? recomputeVerified(tx, tutor.id) : tutor.isVerified
  })
  return { isVerified }
}

export async function addPortfolioItem(tutor, data) {
  const count = await prisma.portfolioItem.count({ where: { tutorId: tutor.id } })
  if (count >= 10) throw new AppError(400, 'You can add up to 10 portfolio items. Remove one first.')
  return prisma.portfolioItem.create({ data: { ...data, tutorId: tutor.id } })
}

export async function removePortfolioItem(tutor, id) {
  const removed = await prisma.portfolioItem.deleteMany({ where: { id, tutorId: tutor.id } })
  if (!removed.count) throw new AppError(404, 'Portfolio item not found')
}

// Sends the setup to Admin. Only a complete draft can be submitted, and only once:
// after that, a rejected document is replaced by uploading a new one (review carries on by itself).
export async function submitForVerification(tutor) {
  const t = await loadSetup(tutor.id)
  if (t.isVerified) throw new AppError(400, 'Your profile is already verified')
  if (t.verificationSubmittedAt) throw new AppError(409, 'Your profile has already been submitted for review')
  const missing = missingForSubmit(t)
  if (missing.length) throw new AppError(400, `Please complete: ${missing.join(', ')}`)

  // Only a still-unsubmitted profile is updated, so a double click cannot submit twice
  const updated = await prisma.tutorProfile.updateMany({
    where: { id: tutor.id, verificationSubmittedAt: null },
    data: { verificationSubmittedAt: new Date() },
  })
  if (!updated.count) throw new AppError(409, 'Your profile has already been submitted for review')

  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
  await Promise.all(admins.map((a) => notify(a.id, {
    type: 'TUTOR_SUBMITTED',
    title: 'New tutor to verify',
    message: `${t.user.fullName} submitted their profile and documents for review.`,
    link: '/admin/users',
  })))
  return loadSetup(tutor.id)
}
