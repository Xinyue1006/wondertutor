// The same bands as the server (backend/src/services/matching.service.js). A place is only known to within a few
// kilometres, so distance is said as "Within 8 km", never as an exact "5.3 km".
const BANDS = [3, 8, 15, 30]

export function distanceLabel(km) {
  if (km == null) return null
  const limit = BANDS.find((b) => km <= b)
  return limit ? `Within ${limit} km` : 'Over 30 km away'
}
