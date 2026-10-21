// Booking housekeeping that runs on a timer, so no booking is left hanging and nobody forgets a lesson.
//
//  1. Requests the tutor never answered (PENDING) or counter-offers the parent never answered (COUNTER_OFFERED)
//     expire when the lesson time arrives.
//  2. Bookings waiting for payment (AWAITING_PAYMENT) expire if they are still unpaid 1 hour before the lesson,
//     which gives the tutor a clear answer and frees the slot for other parents.
//  3. Parents and tutors get an in-app reminder once, during the 24 hours before a confirmed lesson. The parent also gets
//     an email (unless they switched reminder emails off in My Profile).
//  4. A parent whose booking is waiting for payment gets one reminder (in-app and email) when the payment deadline is
//     less than 24 hours away.
//
// Nothing here moves money: an expired booking was never paid. Each function takes `now` so tests can control time.
import { prisma } from '../config/prisma.js'
import { notify, notifyWithEmail } from './notification.service.js'

export const PAYMENT_DEADLINE_MINUTES = 60
export const REMINDER_HOURS = 24
export const PAYMENT_REMINDER_HOURS = 24
const OFF_NOTE = 'You get reminder emails because they are switched on in My Profile > Privacy & account. You can switch them off there.'

const when = (d) =>
  new Date(d).toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

async function expire(booking, reason, parentMessage) {
  // updateMany with the old status: if the parent or tutor acted at the same moment, their action wins
  const { count } = await prisma.booking.updateMany({
    where: { id: booking.id, status: booking.status },
    data: { status: 'CANCELLED', cancelReason: reason, cancelledById: null },
  })
  if (!count) return false
  await prisma.payment.updateMany({ where: { bookingId: booking.id, status: 'PENDING' }, data: { status: 'FAILED' } })
  await notify(booking.parent.userId, { type: 'BOOKING_EXPIRED', title: 'Booking expired', message: parentMessage, link: `/parent/bookings?booking=${booking.id}` })
  await notify(booking.tutor.userId, { type: 'BOOKING_EXPIRED', title: 'Booking expired', message: `The ${booking.subject} booking on ${when(booking.startAt)} expired: ${reason.replace(/^Expired: /, '')}.`, link: '/tutor/bookings' })
  return true
}

export async function expireStaleBookings(now = new Date()) {
  const include = { parent: true, tutor: true }
  const unanswered = await prisma.booking.findMany({ where: { status: { in: ['PENDING', 'COUNTER_OFFERED'] }, startAt: { lte: now } }, include })
  const deadline = new Date(now.getTime() + PAYMENT_DEADLINE_MINUTES * 60_000)
  const unpaid = await prisma.booking.findMany({ where: { status: 'AWAITING_PAYMENT', startAt: { lte: deadline } }, include })

  let expired = 0
  for (const b of unanswered) {
    const ok = b.status === 'PENDING'
      ? await expire(b, 'Expired: the tutor did not respond before the lesson time', `Your ${b.subject} request for ${when(b.startAt)} expired because the tutor did not respond in time. You can book another tutor or time.`)
      : await expire(b, 'Expired: the counter-offer was not answered before the lesson time', `The counter-offer for your ${b.subject} lesson on ${when(b.startAt)} expired. You can send a new request.`)
    if (ok) expired++
  }
  for (const b of unpaid) {
    if (await expire(b, 'Expired: payment was not completed at least 1 hour before the lesson', `Your ${b.subject} lesson on ${when(b.startAt)} was released because payment was not completed at least 1 hour before it started.`)) expired++
  }
  return { expired }
}

export async function sendLessonReminders(now = new Date()) {
  const until = new Date(now.getTime() + REMINDER_HOURS * 3_600_000)
  const lessons = await prisma.booking.findMany({
    where: { status: 'CONFIRMED', startAt: { gt: now, lte: until } },
    include: { parent: { include: { user: true } }, tutor: true, child: true },
  })
  let sent = 0
  for (const b of lessons) {
    const link = `/parent/bookings?booking=${b.id}`
    // One reminder per lesson: the notification itself is the record that it was sent
    const already = await prisma.notification.findFirst({ where: { userId: b.parent.userId, type: 'LESSON_REMINDER', link } })
    if (already) continue
    const how = b.teachingMode === 'ONLINE' ? 'online (the meeting link is in My Bookings)' : `at ${b.location || 'the agreed location'}`
    await remind(b.parent.user, { type: 'LESSON_REMINDER', title: 'Lesson reminder', message: `${b.child.name}'s ${b.subject} lesson is on ${when(b.startAt)}, ${how}.`, link })
    await notify(b.tutor.userId, { type: 'LESSON_REMINDER', title: 'Lesson reminder', message: `You have a ${b.subject} lesson with ${b.child.name} on ${when(b.startAt)}.`, link: `/tutor/bookings?booking=${b.id}` })
    sent++
  }
  return { sent }
}

// In-app always; by email too when the person has reminder emails on and the account is active
async function remind(user, payload) {
  if (user.status === 'ACTIVE' && user.emailReminders) await notifyWithEmail(user, payload, { note: OFF_NOTE })
  else await notify(user.id, payload)
}

// Bookings the tutor accepted that are still unpaid: one reminder when less than 24 hours are left to pay
// (the deadline is 1 hour before the lesson, see PAYMENT_DEADLINE_MINUTES)
export async function sendPaymentReminders(now = new Date()) {
  const horizon = new Date(now.getTime() + PAYMENT_DEADLINE_MINUTES * 60_000 + PAYMENT_REMINDER_HOURS * 3_600_000)
  const deadline = new Date(now.getTime() + PAYMENT_DEADLINE_MINUTES * 60_000)
  const unpaid = await prisma.booking.findMany({
    // startAt after the deadline: bookings that are about to expire are released by expireStaleBookings instead
    where: { status: 'AWAITING_PAYMENT', startAt: { gt: deadline, lte: horizon } },
    include: { parent: { include: { user: true } }, child: true },
  })
  let sent = 0
  for (const b of unpaid) {
    const link = `/parent/payments?booking=${b.id}`
    const already = await prisma.notification.findFirst({ where: { userId: b.parent.userId, type: 'PAYMENT_REMINDER', link } })
    if (already) continue
    const payBy = when(new Date(b.startAt.getTime() - PAYMENT_DEADLINE_MINUTES * 60_000))
    await remind(b.parent.user, {
      type: 'PAYMENT_REMINDER',
      title: 'Payment due soon',
      message: `Please pay for ${b.child.name}'s ${b.subject} lesson by ${payBy}. If it is not paid by then, the time is given to other parents.`,
      link,
    })
    sent++
  }
  return { sent }
}

// Runs once at start-up and then every few minutes. Errors are logged, never thrown, so the API keeps running.
export function startScheduler(intervalMs = 5 * 60_000) {
  const run = async () => {
    try {
      const { expired } = await expireStaleBookings()
      const { sent } = await sendLessonReminders()
      const { sent: paymentReminders } = await sendPaymentReminders()
      if (expired || sent || paymentReminders) console.log(`[scheduler] expired ${expired} booking(s), sent ${sent} lesson and ${paymentReminders} payment reminder(s)`)
    } catch (err) {
      console.error('[scheduler]', err.message)
    }
  }
  run()
  const timer = setInterval(run, intervalMs)
  timer.unref?.()
  return timer
}
