import { afterEach, describe, expect, test, vi } from 'vitest'
import { canAddToCalendar, googleCalendarUrl, lessonLocation } from '../lib/calendar'

const lesson = (extra = {}) => ({
  id: 7, status: 'CONFIRMED', subject: 'Mathematics', isTrial: false, teachingMode: 'PHYSICAL',
  location: 'Kepong, Kuala Lumpur', meetingLink: null,
  startAt: '2026-10-22T02:00:00.000Z', endAt: '2026-10-22T03:00:00.000Z',
  child: { name: 'Sarah' }, tutor: { name: 'Ms. Tan' },
  ...extra,
})

describe('Google Calendar link', () => {
  test('fills in the title, the time in UTC, the details and the place', () => {
    const url = new URL(googleCalendarUrl(lesson()))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('Sarah: Mathematics with Ms. Tan')
    expect(url.searchParams.get('dates')).toBe('20261022T020000Z/20261022T030000Z')
    expect(url.searchParams.get('location')).toBe('Kepong, Kuala Lumpur')
    expect(url.searchParams.get('details')).toContain('/parent/bookings?booking=7')
  })

  test('an online lesson uses the meeting link as the place', () => {
    const b = lesson({ teachingMode: 'ONLINE', meetingLink: 'https://meet.example.com/abc' })
    expect(lessonLocation(b)).toBe('https://meet.example.com/abc')
    expect(lessonLocation(lesson({ teachingMode: 'ONLINE' }))).toBe('Online lesson')
  })
})

describe('who can add a lesson to a calendar', () => {
  afterEach(() => vi.useRealTimers())

  test('only a confirmed lesson that has not started', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T00:00:00Z'))
    expect(canAddToCalendar(lesson())).toBe(true)
    expect(canAddToCalendar(lesson({ status: 'PENDING' }))).toBe(false)
    expect(canAddToCalendar(lesson({ status: 'AWAITING_PAYMENT' }))).toBe(false)
    vi.setSystemTime(new Date('2026-10-23T00:00:00Z'))
    expect(canAddToCalendar(lesson())).toBe(false) // already past
  })
})
