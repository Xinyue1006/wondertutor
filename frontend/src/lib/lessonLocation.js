// A legacy area centre is never an attendance destination. Only the booking's
// explicitly confirmed address and point can be used for directions or check-in.
export function hasConfirmedLessonLocation(booking) {
  return Boolean(booking.locationConfirmedAt) &&
    Number.isFinite(booking.latitude) && Math.abs(booking.latitude) <= 90 &&
    Number.isFinite(booking.longitude) && Math.abs(booking.longitude) <= 180
}

export function lessonLocationMapUrl(booking) {
  return hasConfirmedLessonLocation(booking)
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${booking.latitude},${booking.longitude}`)}`
    : null
}

export function canEditLessonLocation(booking, now = Date.now()) {
  const end = Date.parse(booking.endAt)
  if (booking.teachingMode !== 'PHYSICAL' || booking.locationCanBeEdited === false || booking.attendance?.checkInAt ||
      !['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT', 'CONFIRMED'].includes(booking.status) || !Number.isFinite(end) || end <= now) return false
  return !booking.locationConfirmedAt || ['PENDING', 'COUNTER_OFFERED'].includes(booking.status)
}
