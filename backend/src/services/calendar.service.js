// "Add to calendar": a confirmed lesson as an iCalendar (.ics) file, which Apple Calendar, Outlook and Google Calendar
// all open. Written by hand (RFC 5545) because it is a small, fixed format and needs no extra library.
//
// Everything here is a plain function of its input (no database, no clock unless passed in), so it is easy to test.

// Times are written in UTC ("...Z"), so the lesson lands at the right hour in whatever time zone the phone is in
export const icsTime = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

// Text values: backslash, semicolon, comma and line breaks must be escaped
export const icsEscape = (s) =>
  String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

// Lines longer than 75 bytes are folded: the rest continues on the next line, which starts with one space.
// Measured in bytes (not letters) and never cuts in the middle of a character.
export function icsFold(line) {
  if (Buffer.byteLength(line) <= 75) return line
  const parts = []
  let current = ''
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74 // continuation lines start with a space, which counts too
    if (Buffer.byteLength(current + ch) > limit) {
      parts.push(current)
      current = ch
    } else {
      current += ch
    }
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const lessonLine = (b) => `${b.child.name}: ${b.subject} with ${b.tutor.user.fullName}`

// The words shown in the event details, as separate lines
function describe(b, bookingUrl) {
  const lines = [
    `Child: ${b.child.name}`,
    `Tutor: ${b.tutor.user.fullName}`,
    `Subject: ${b.subject}${b.isTrial ? ' (trial lesson)' : ''}`,
    b.teachingMode === 'ONLINE' ? 'Online lesson' : 'Lesson at the agreed location',
  ]
  if (b.teachingMode === 'ONLINE' && b.meetingLink) lines.push(`Meeting link: ${b.meetingLink}`)
  lines.push(`Booking details: ${bookingUrl}`)
  return lines.join('\n')
}

// Where the lesson is: the meeting link for online lessons, otherwise the agreed address
export function lessonLocation(b) {
  if (b.teachingMode === 'ONLINE') return b.meetingLink || 'Online lesson'
  return b.location || 'Location agreed with the tutor'
}

export function eventLines(b, { baseUrl }) {
  const bookingUrl = `${baseUrl}/parent/bookings?booking=${b.id}`
  return [
    'BEGIN:VEVENT',
    `UID:booking-${b.id}@wondertutor`,
    `DTSTAMP:${icsTime(b.updatedAt)}`,
    `DTSTART:${icsTime(b.startAt)}`,
    `DTEND:${icsTime(b.endAt)}`,
    // Importing the file again after a reschedule updates the same event: calendars replace an event with the same
    // UID when its SEQUENCE is higher, and the minutes since 1970 of the last change only ever grow
    `SEQUENCE:${Math.floor(new Date(b.updatedAt).getTime() / 60000)}`,
    `SUMMARY:${icsEscape(lessonLine(b))}`,
    `DESCRIPTION:${icsEscape(describe(b, bookingUrl))}`,
    `LOCATION:${icsEscape(lessonLocation(b))}`,
    `URL:${bookingUrl}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(`Lesson in 1 hour: ${lessonLine(b)}`)}`,
    'TRIGGER:-PT1H',
    'END:VALARM',
    'END:VEVENT',
  ]
}

// bookings: confirmed bookings including child and tutor.user
export function buildCalendar(bookings, { baseUrl, name = 'WonderTutor lessons' }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//WonderTutor//Lessons//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(name)}`,
    ...bookings.flatMap((b) => eventLines(b, { baseUrl })),
    'END:VCALENDAR',
  ]
  return `${lines.map(icsFold).join('\r\n')}\r\n`
}
