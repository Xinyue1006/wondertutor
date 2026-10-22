// Reminder emails: a lesson tomorrow and a payment that is due soon. Each goes out once, only to people who have
// reminder emails on, and never to a deleted or deactivated account.
import { prisma } from '../config/prisma.js'
import { outbox } from '../services/email.service.js'
import { PAYMENT_DEADLINE_MINUTES, sendLessonReminders, sendPaymentReminders } from '../services/lifecycle.service.js'
import { MONDAY, makeBooking, makeParent, makeTutor, nextDate, resetDb } from './helpers.js'

let tutor, date
beforeAll(async () => {
  await resetDb()
  tutor = await makeTutor()
  date = nextDate(MONDAY)
})
afterAll(() => prisma.$disconnect())
beforeEach(() => { outbox.length = 0 })

const hoursBefore = (b, h) => new Date(b.startAt.getTime() - h * 3_600_000)
const emailsTo = (p) => outbox.filter((m) => m.to === p.user.email)
const lesson = (p, status, start) => makeBooking({ parent: p.parent, child: p.child, tutor: tutor.tutor, date, start, status })

describe('lesson reminder emails', () => {
  test('the parent gets an email with a link to the booking, once, and the tutor only an in-app reminder', async () => {
    const p = await makeParent()
    const b = await lesson(p, 'CONFIRMED', '16:00')
    await sendLessonReminders(hoursBefore(b, 20))
    const mails = emailsTo(p)
    expect(mails).toHaveLength(1)
    expect(mails[0].subject).toBe('WonderTutor — Lesson reminder')
    expect(mails[0].html).toContain(`/parent/bookings?booking=${b.id}`)
    expect(mails[0].html).toContain('switch them off')
    expect(outbox.some((m) => m.to === tutor.user.email)).toBe(false)
    expect(await prisma.notification.count({ where: { userId: tutor.user.id, type: 'LESSON_REMINDER' } })).toBeGreaterThan(0)

    await sendLessonReminders(hoursBefore(b, 10)) // a later run does not send it again
    expect(emailsTo(p)).toHaveLength(1)
  })

  test('a parent who switched reminder emails off still gets the in-app reminder, but no email', async () => {
    const p = await makeParent()
    await prisma.user.update({ where: { id: p.user.id }, data: { emailReminders: false } })
    const b = await lesson(p, 'CONFIRMED', '17:00')
    await sendLessonReminders(hoursBefore(b, 20))
    expect(emailsTo(p)).toHaveLength(0)
    expect(await prisma.notification.count({ where: { userId: p.user.id, type: 'LESSON_REMINDER' } })).toBe(1)
  })

  test('a deactivated account gets no email', async () => {
    const p = await makeParent()
    await prisma.user.update({ where: { id: p.user.id }, data: { status: 'DEACTIVATED' } })
    const b = await lesson(p, 'CONFIRMED', '18:00')
    await sendLessonReminders(hoursBefore(b, 20))
    expect(emailsTo(p)).toHaveLength(0)
  })
})

describe('payment reminders', () => {
  test('a booking waiting for payment gets one reminder when less than 24 hours are left to pay', async () => {
    const p = await makeParent()
    const b = await lesson(p, 'AWAITING_PAYMENT', '16:00')
    await sendPaymentReminders(hoursBefore(b, 48)) // far away: too early
    expect(emailsTo(p)).toHaveLength(0)

    await sendPaymentReminders(hoursBefore(b, 20))
    const mails = emailsTo(p)
    expect(mails).toHaveLength(1)
    expect(mails[0].subject).toBe('WonderTutor — Payment due soon')
    expect(mails[0].html).toContain('/parent/payments')
    expect(await prisma.notification.count({ where: { userId: p.user.id, type: 'PAYMENT_REMINDER' } })).toBe(1)

    await sendPaymentReminders(hoursBefore(b, 5)) // not again
    expect(emailsTo(p)).toHaveLength(1)
  })

  test('no reminder once the payment deadline has passed (the booking is released instead)', async () => {
    const p = await makeParent()
    const b = await lesson(p, 'AWAITING_PAYMENT', '17:00')
    await sendPaymentReminders(new Date(b.startAt.getTime() - (PAYMENT_DEADLINE_MINUTES - 5) * 60_000))
    expect(emailsTo(p)).toHaveLength(0)
  })

  test('only bookings waiting for payment are reminded', async () => {
    const p = await makeParent()
    const b = await lesson(p, 'CONFIRMED', '18:00')
    await sendPaymentReminders(hoursBefore(b, 20))
    expect(emailsTo(p)).toHaveLength(0)
  })
})
