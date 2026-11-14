import { distanceKm, isEligible, rankTutors } from './matching.service.js'
import { LOCATIONS, findLocation } from '../data/catalog.js'
import { searchPlaces } from './places.service.js'

export const NEARBY_KM = 30

// Chat often supplies "Kepong" instead of the full picker label. Resolve only
// an exact, unambiguous town/area name; never guess a place from a street address.
export function resolveTutorLocation(value) {
  if (!value) return null
  const direct = findLocation(value)
  if (direct) return direct
  const name = value.trim().toLocaleLowerCase()
  const choices = [
    ...LOCATIONS.filter(area => area.name.split(',')[0].toLocaleLowerCase() === name),
    ...searchPlaces(value, { limit: 20 }).filter(place => place.kind === 'town' && place.label.split(',')[0].toLocaleLowerCase() === name).map(place => findLocation(place.label)),
  ].filter(Boolean)
  const unique = new Map(choices.map(area => [area.name, area]))
  return unique.size === 1 ? [...unique.values()][0] : null
}

export function withSavedTutorLocation(criteria, parent) {
  if (criteria.location || criteria.mode !== 'PHYSICAL') return criteria
  const home = resolveTutorLocation(parent?.address)
  return home ? { ...criteria, location: home.name } : criteria
}

export function tutorSearchScope(criteria) {
  const located = Number.isFinite(criteria.lat) && Number.isFinite(criteria.lng)
  const mode = criteria.mode === 'ONLINE' ? 'ONLINE' : located || criteria.mode === 'PHYSICAL' ? 'PHYSICAL' : 'ANY'
  return {
    mode, location: criteria.location || null,
    radiusKm: mode === 'PHYSICAL' ? Math.min(criteria.maxDistance || NEARBY_KM, NEARBY_KM) : null,
    needsLocation: mode === 'PHYSICAL' && !located,
  }
}

// Location and lesson mode decide eligibility before scores are compared.
// Online alternatives stay in their own group; they never fill a physical list.
// Availability sets, when supplied by browse, are checked per lesson mode.
export function groupTutorCandidates(tutors, criteria, available = {}) {
  const scope = tutorSearchScope(criteria)
  const eligible = tutors.filter(tutor => !criteria.subject || !criteria.level || isEligible(tutor, criteria))
  const supports = (tutor, mode) => (mode === 'ONLINE' ? tutor.offersOnline : tutor.offersPhysical)
    && (!available[mode] || available[mode].has(tutor.id))
  const online = eligible.filter(tutor => supports(tutor, 'ONLINE'))
  let primary
  if (scope.mode === 'ONLINE') primary = online
  else if (scope.needsLocation) primary = []
  else if (scope.mode === 'ANY') primary = eligible.filter(tutor => supports(tutor, 'ONLINE') || supports(tutor, 'PHYSICAL'))
  else primary = eligible.filter(tutor => {
    if (!supports(tutor, 'PHYSICAL')) return false
    const km = distanceKm(criteria.lat, criteria.lng, tutor.latitude, tutor.longitude)
    return Number.isFinite(km) && km <= scope.radiusKm
  })
  return { searchScope: scope, tutors: primary, onlineAlternatives: scope.mode === 'PHYSICAL' && !scope.needsLocation ? online : [] }
}

export function rankTutorGroups(tutors, criteria, available) {
  const groups = groupTutorCandidates(tutors, criteria, available)
  const mode = groups.searchScope.mode === 'ANY' ? 'EITHER' : groups.searchScope.mode
  return {
    searchScope: groups.searchScope,
    tutors: rankTutors(groups.tutors, { ...criteria, mode }),
    onlineAlternatives: rankTutors(groups.onlineAlternatives, { ...criteria, mode: 'ONLINE' }),
  }
}
