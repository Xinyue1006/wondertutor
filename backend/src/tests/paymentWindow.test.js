// The payment window: how long an accepted booking holds its hour while the parent pays.
import { PAYMENT_DEADLINE_MINUTES } from '../services/lifecycle.service.js'
import { PAYMENT_WINDOW_HOURS, assertCanAccept, newPayBy, paymentDeadline } from '../services/paymentWindow.js'

const NOW = new Date('2026-11-16T04:00:00Z')
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const CUTOFF = PAYMENT_DEADLINE_MINUTES * MINUTE
const after = (ms, from = NOW) => new Date(from.getTime() + ms)

describe('newPayBy', () => {
  test('a lesson days away gets the whole window', () => {
    expect(newPayBy(after(72 * HOUR), NOW)).toEqual(after(PAYMENT_WINDOW_HOURS * HOUR))
  })

  test('a lesson sooner than the window is capped before the lesson', () => {
    const startAt = after(5 * HOUR)
    expect(newPayBy(startAt, NOW)).toEqual(after(-CUTOFF, startAt))
  })

  test('a lesson inside the cutoff gives a time that is not after now', () => {
    expect(newPayBy(after(CUTOFF / 2), NOW).getTime()).toBeLessThanOrEqual(NOW.getTime())
  })
})

describe('assertCanAccept', () => {
  test('passes for a lesson days away', () => {
    expect(() => assertCanAccept(after(72 * HOUR), NOW)).not.toThrow()
  })

  test.each([
    ['inside the cutoff', CUTOFF / 2],
    ['exactly at the cutoff', CUTOFF],
  ])('refuses a lesson %s', (_, untilLesson) => {
    expect(() => assertCanAccept(after(untilLesson), NOW)).toThrow(expect.objectContaining({ status: 400, message: 'This lesson starts too soon to accept' }))
  })
})

describe('paymentDeadline', () => {
  const startAt = after(48 * HOUR)
  const cutoff = after(-CUTOFF, startAt)

  test('a booking with no payBy follows the cutoff', () => {
    expect(paymentDeadline({ payBy: null, startAt })).toEqual(cutoff)
  })

  test('a payBy later than the cutoff is capped by it', () => {
    expect(paymentDeadline({ payBy: after(CUTOFF, startAt), startAt })).toEqual(cutoff)
  })

  test('an earlier payBy wins', () => {
    const payBy = after(PAYMENT_WINDOW_HOURS * HOUR)
    expect(paymentDeadline({ payBy, startAt })).toEqual(payBy)
  })
})
