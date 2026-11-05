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

// Not used by the tutor routes: every tutor may use every feature, and verification only adds the badge and
// search priority. Kept for a future feature that should be limited to verified tutors (add it to that route only).
export function requireVerifiedTutor(req, res, next) {
  if (!req.tutor?.isVerified) throw new AppError(403, 'Your profile is waiting for Admin verification')
  next()
}
