import { z } from 'zod'

// A parent's matching area is intentionally approximate. Only an explicit,
// per-booking address and confirmed map point may be used for GPS attendance.
export const lessonLocationSchema = z.object({
  address: z.string().trim().min(10, 'Enter the full lesson address.').max(191, 'Lesson address must be 191 characters or fewer.'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  confirmed: z.literal(true, { message: 'Confirm that the pin marks the actual lesson address.' }),
}).strict()

export function hasConfirmedLessonLocation(b) {
  return b.teachingMode === 'PHYSICAL' && Boolean(b.locationConfirmedAt) &&
    typeof b.location === 'string' && b.location.trim().length >= 10 &&
    Number.isFinite(b.latitude) && b.latitude >= -90 && b.latitude <= 90 &&
    Number.isFinite(b.longitude) && b.longitude >= -180 && b.longitude <= 180
}

export function lessonLocationFields(b) {
  const confirmed = hasConfirmedLessonLocation(b)
  return {
    locationConfirmedAt: confirmed ? b.locationConfirmedAt : null,
    locationNeedsConfirmation: b.teachingMode === 'PHYSICAL' && !confirmed,
    // Legacy coordinates could be the matching-area centre. Do not expose them
    // as a usable check-in/map destination while waiting for confirmation.
    latitude: confirmed ? b.latitude : null,
    longitude: confirmed ? b.longitude : null,
  }
}

export function canEditLessonLocation(b, now = new Date()) {
  return b.teachingMode === 'PHYSICAL' &&
    ['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT', 'CONFIRMED'].includes(b.status) &&
    b.endAt > now && !b.attendance?.checkInAt &&
    (!hasConfirmedLessonLocation(b) || ['PENDING', 'COUNTER_OFFERED'].includes(b.status))
}
