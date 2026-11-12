// Payment window [YH]. An accepted booking holds its hour for 24 hours while the parent pays, and never later than
// PAYMENT_DEADLINE_MINUTES before the lesson. Older bookings have no payBy, so only the second limit applies to them.
import { AppError } from '../utils/AppError.js'
export const PAYMENT_DEADLINE_MINUTES = 60

export const PAYMENT_WINDOW_HOURS = 24

const lessonCutoff = (startAt) => new Date(new Date(startAt).getTime() - PAYMENT_DEADLINE_MINUTES * 60_000)
const earlier = (a, b) => (a < b ? a : b)

export function newPayBy(startAt, now = new Date()) {
  return earlier(new Date(now.getTime() + PAYMENT_WINDOW_HOURS * 3_600_000), lessonCutoff(startAt))
}

export function assertCanAccept(startAt, now = new Date()) {
  if (newPayBy(startAt, now) <= now) throw new AppError(400, 'This lesson starts too soon to accept')
}

export function paymentDeadline({ payBy, startAt }) {
  return payBy ? earlier(new Date(payBy), lessonCutoff(startAt)) : lessonCutoff(startAt)
}
