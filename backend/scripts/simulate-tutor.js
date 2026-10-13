// DEV ONLY: stands in for the Tutor Portal (built by Yan Hsi) so the parent's booking flow can be tested end to end.
//
//   npm run dev:respond -- <bookingId> accept
//   npm run dev:respond -- <bookingId> reject "Not available at that time"
//   npm run dev:respond -- <bookingId> counter 50
//   npm run dev:respond -- <bookingId> complete                      (marks a CONFIRMED lesson as completed)
//   npm run dev:respond -- <bookingId> reschedule 2026-10-21 18:00   (the tutor asks the parent for a new time)
//   npm run dev:respond -- <bookingId> reschedule-accept             (the tutor agrees to the parent's new time)
//   npm run dev:respond -- <bookingId> reschedule-decline            (the tutor disagrees -> escalated to Admin)
import { prisma } from '../src/config/prisma.js'
import { bookingInclude } from '../src/services/booking.dto.js'
import { requestReschedule, respondReschedule } from '../src/services/reschedule.service.js'

const [id, action, arg, arg2] = process.argv.slice(2)

async function reschedule(b) {
  const booking = await prisma.booking.findUnique({ where: { id: b.id }, include: bookingInclude })
  if (action === 'reschedule') {
    await requestReschedule({ booking, byUserId: b.tutor.userId, date: arg, startTime: arg2, reason: 'Proposed by the tutor (simulator)' })
    return console.log(`Booking ${b.id}: tutor asked to move it to ${arg} ${arg2}`)
  }
  const open = await prisma.rescheduleRequest.findFirst({ where: { bookingId: b.id, status: 'PENDING' } })
  if (!open) throw new Error('No pending reschedule request on this booking')
  const r = await respondReschedule({ booking, requestId: open.id, byUserId: b.tutor.userId, accept: action === 'reschedule-accept' })
  console.log(`Booking ${b.id}: reschedule ${r.status}`)
}

async function main() {
  const b = await prisma.booking.findUnique({ where: { id: Number(id) }, include: { parent: true, tutor: true } })
  if (!b) throw new Error('Booking not found')
  if (action?.startsWith('reschedule')) return reschedule(b)

  let data
  if (action === 'accept') data = { status: 'AWAITING_PAYMENT', agreedPrice: b.proposedPrice }
  else if (action === 'reject') data = { status: 'REJECTED', rejectionReason: arg || 'Not available at that time' }
  else if (action === 'counter') data = { status: 'COUNTER_OFFERED', counterPrice: Number(arg) }
  else if (action === 'complete') data = { status: 'COMPLETED' }
  else throw new Error('Usage: dev:respond <bookingId> accept|reject|counter <price>|complete|reschedule <date> <time>|reschedule-accept|reschedule-decline')

  await prisma.booking.update({ where: { id: b.id }, data })
  await prisma.notification.create({
    data: {
      userId: b.parent.userId,
      type: `TUTOR_${action.toUpperCase()}`,
      title: { accept: 'Tutor accepted your request', reject: 'Tutor declined your request', counter: 'Tutor sent a counter offer', complete: 'Lesson completed' }[action],
      message: `${b.subject} lesson. Open My Bookings for details.`,
      link: '/parent/bookings',
    },
  })
  console.log(`Booking ${b.id} -> ${data.status}`)
}

main().catch((e) => { console.error(e.message); process.exitCode = 1 }).finally(() => prisma.$disconnect())
