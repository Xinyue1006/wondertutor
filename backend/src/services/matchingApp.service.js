// Matching application service: the ONE place that turns validated criteria into a ranked list of tutor cards.
//
// It sits between the pure scoring in matching.service.js (weights, eligibility, labels, verified-first order) and the
// callers:
//   - POST /parent/matching (wizard + guided chat) calls it and then SAVES the search as a MatchingRequest;
//   - the read-only AI assistant calls it WITHOUT saving anything (Phase 1 is read-only).
// Because both go through this function, an AI search and a wizard search with the same criteria give identical results.
import { prisma } from '../config/prisma.js'
import { rankTutorGroups, resolveTutorLocation } from './tutorSearchScope.js'
import { AppError } from '../utils/AppError.js'
import { toTutorCard } from './tutor.service.js'
import { activeTutors } from '../controllers/parent/tutors.controller.js'

// criteria: already validated by criteriaSchema (matching.controller.js). parentId: the logged-in parent's profile id.
// Read-only: performs no database writes.
export async function tutorRecommendationsForParent(criteria, parentId, db = prisma) {
  const loc = resolveTutorLocation(criteria.location)
  if (criteria.location && !loc) throw new AppError(400, 'Choose a recognised area, town or postcode')
  const c = { ...criteria, location: loc?.name || criteria.location, lat: loc?.lat, lng: loc?.lng, grade: criteria.grade ?? undefined, budgetMax: criteria.budgetMax ?? undefined }
  const tutors = await activeTutors(c.subject, c.level)
  const groups = rankTutorGroups(tutors, c)
  const favourites = new Set(
    (await db.favouriteTutor.findMany({ where: { parentId }, select: { tutorId: true } })).map((f) => f.tutorId),
  )
  const cards = (ranked, searchMode) => ranked.map(({ tutor, match }) => ({
    ...toTutorCard(tutor, c.subject),
    searchMode,
    isFavourite: favourites.has(tutor.id),
    match: { score: match.score, label: match.label, reasons: match.reasons, distanceKm: match.distanceKm },
  }))
  const primary = cards(groups.tutors, groups.searchScope.mode)
  const alternatives = cards(groups.onlineAlternatives, 'ONLINE')
  return { total: primary.length, tutors: primary, searchScope: groups.searchScope, onlineAlternatives: { total: alternatives.length, tutors: alternatives } }
}

// Compatibility boundary for callers that only need the requested results.
export async function runMatchingForParent(criteria, parentId, db = prisma) {
  return (await tutorRecommendationsForParent(criteria, parentId, db)).tutors
}

// Returns the child only if it belongs to this parent; otherwise null (callers decide how to report "not found").
export async function findOwnedChild(parentId, childId, db = prisma) {
  if (!Number.isInteger(childId) || childId < 1) return null
  return db.child.findFirst({ where: { id: childId, parentId } })
}
