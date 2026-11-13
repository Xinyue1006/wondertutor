// A viewport/area centre alone must never count as a selected lesson venue.
export function hasLessonPoint(value) {
  return typeof value?.latitude === 'number' && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && typeof value?.longitude === 'number' && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
}

export function lessonLocationError(value) {
  const address = value?.address?.trim() || ''
  if (address.length < 10 || address.length > 191) return 'Enter the full lesson address (10–191 characters), including the unit or house number.'
  if (!hasLessonPoint(value)) return 'Choose the actual lesson entrance on the map, use your current location at the venue, or enter valid coordinates.'
  if (value.confirmed !== true) return 'Confirm that the address and pin identify the actual lesson venue.'
  return ''
}

export function lessonLocationPayload(value) {
  return { address: value.address.trim(), latitude: value.latitude, longitude: value.longitude, confirmed: true }
}
