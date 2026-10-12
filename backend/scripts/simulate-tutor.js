// DEV ONLY: stands in for the Tutor Portal (built by Yan Hsi) so the parent's booking flow can be tested end to end.
//
//   npm run dev:respond -- <bookingId> accept
//   npm run dev:respond -- <bookingId> reject "Not available at that time"
//   npm run dev:respond -- <bookingId> counter 50
//   npm run dev:respond -- <bookingId> complete        (marks a CONFIRMED lesson as completed)
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const [id, action, arg] = process.argv.slice(2)

async function main() {
  const b = await prisma.booking.findUnique({ where: { id: Number(id) }, include: { parent: true, tutor: true } })
  if (!b) throw new Error('Booking not found')
  let data
  if (action === 'accept') data = { status: 'AWAITING_PAYMENT', agreedPrice: b.proposedPrice }
  else if (action === 'reject') data = { status: 'REJECTED', rejectionReason: arg || 'Not available at that time' }
  else if (action === 'counter') data = { status: 'COUNTER_OFFERED', counterPrice: Number(arg) }
  else if (action === 'complete') data = { status: 'COMPLETED' }
  else throw new Error('Usage: dev:respond <bookingId> accept|reject|counter <price>|complete')

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
