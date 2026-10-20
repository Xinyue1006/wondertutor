import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'

// Loads the TutorProfile of the logged-in tutor into req.tutor.
// Every tutor query is then filtered by req.tutor.id, so a tutor can never see another tutor's data.
export async function loadTutorProfile(req, res, next) {
  const tutor = await prisma.tutorProfile.findUnique({ where: { userId: req.user.id } })
  if (!tutor) throw new AppError(403, 'Tutor profile not found')
  req.tutor = tutor
  next()
}

// Teaching features (dashboard, availability, bookings, earnings) open only after Admin verifies the tutor.
// Setup, verification status and the profile preview stay reachable so an unverified tutor can finish onboarding.
export function requireVerifiedTutor(req, res, next) {
  if (!req.tutor?.isVerified) throw new AppError(403, 'Your profile is waiting for Admin verification')
  next()
}
