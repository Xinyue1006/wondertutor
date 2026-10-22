// "Add to Google Calendar": a link that opens Google Calendar with the lesson filled in. (Apple Calendar and Outlook
// use the downloaded .ics file instead, see lib/download.js.)

const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export const lessonTitle = (b) => `${b.child.name}: ${b.subject} with ${b.tutor.name}`

export function lessonLocation(b) {
  if (b.teachingMode === 'ONLINE') return b.meetingLink || 'Online lesson'
  return b.location || 'Location agreed with the tutor'
}

export function googleCalendarUrl(b) {
  const details = [
    `Child: ${b.child.name}`,
    `Tutor: ${b.tutor.name}`,
    `Subject: ${b.subject}${b.isTrial ? ' (trial lesson)' : ''}`,
    b.teachingMode === 'ONLINE' && b.meetingLink ? `Meeting link: ${b.meetingLink}` : '',
    `Booking details: ${window.location.origin}/parent/bookings?booking=${b.id}`,
  ].filter(Boolean).join('\n')
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: lessonTitle(b),
    dates: `${stamp(b.startAt)}/${stamp(b.endAt)}`,
    details,
    location: lessonLocation(b),
  })
  return `https://calendar.google.com/calendar/render?${q.toString()}`
}

// Only a lesson that is really going ahead, and has not started, is worth adding
export const canAddToCalendar = (b) => b.status === 'CONFIRMED' && new Date(b.startAt).getTime() > Date.now()
