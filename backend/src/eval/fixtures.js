// Synthetic evaluation data for the AI assistant. Every person here is invented; nothing comes from real users.
// Only ever run against the TEST database (see scripts/eval-assistant.js, which refuses any other database).
import { prisma } from '../config/prisma.js'
import { addDays, mytToDate, mytParts, todayMyt } from '../utils/time.js'

export const FIXTURE_NAMES = {
  parent: 'Siti Aminah', email: 'siti@example.test', phone: '012-555 0101',
  children: ['Aina', 'Wei Jie'], otherChild: 'Bella', tutors: ['Lim Mei Ling', 'Raj Kumar', 'Nur Izzati'],
}

// Next date (YYYY-MM-DD, Malaysia) on weekday `dow`, at least 2 days ahead
function nextDow(dow) {
  let d = addDays(todayMyt(), 2)
  while (mytParts(mytToDate(d, '12:00')).dow !== dow) d = addDays(d, 1)
  return d
}

export async function seedFixtures(db = prisma) {
  for (const model of [
    'accountWarning', 'refund', 'payment', 'review', 'attendance', 'sessionSummary', 'rescheduleRequest', 'complaint', 'booking',
    'notification', 'matchingRequest', 'favouriteTutor', 'withdrawal', 'bankAccount', 'availabilitySlot',
    'portfolioItem', 'qualification', 'tutorSubject', 'child', 'tutorProfile', 'parentProfile', 'emailOtp', 'user', 'systemSetting',
  ]) await db[model].deleteMany()
  await db.systemSetting.createMany({ data: [{ key: 'BASE_COMMISSION_RATE', value: '10' }, { key: 'RATING_THRESHOLD', value: '3.0' }, { key: 'GPS_RADIUS_METRES', value: '100' }] })

  const parentUser = await db.user.create({
    data: {
      email: FIXTURE_NAMES.email, role: 'PARENT', fullName: FIXTURE_NAMES.parent, phone: '+60125550101', isEmailVerified: true,
      parent: {
        create: {
          address: 'Kepong, Kuala Lumpur', latitude: 3.2087, longitude: 101.6366,
          children: {
            create: [
              { name: 'Aina', educationLevel: 'PRIMARY', grade: 4, subject: 'Mathematics', subjects: ['Mathematics', 'Science'], preferredLanguage: 'Bahasa Melayu', goals: 'Be confident in fractions', notes: 'Prefers visual explanations. Mum: 012-555 0101' },
              { name: 'Wei Jie', educationLevel: 'SECONDARY', grade: 2, subject: 'English', subjects: ['English', 'Science'], preferredLanguage: 'Mandarin' },
            ],
          },
        },
      },
    },
    include: { parent: { include: { children: true } } },
  })
  const otherUser = await db.user.create({
    data: { email: 'other@example.test', role: 'PARENT', fullName: 'Other Family', isEmailVerified: true, parent: { create: { address: 'Banting', children: { create: { name: 'Bella', educationLevel: 'PRIMARY', grade: 4 } } } } },
    include: { parent: { include: { children: true } } },
  })

  const mkTutor = (name, gender, rate, online, physical, subjects, verified) => db.user.create({
    data: {
      email: `${name.split(' ')[0].toLowerCase()}@tutor.example.test`, role: 'TUTOR', fullName: name, isEmailVerified: true,
      tutor: {
        create: {
          gender, emergencyContactName: 'X', emergencyContactPhone: '+60120000000', hourlyRate: rate, offersOnline: online, offersPhysical: physical,
          location: 'Kepong, Kuala Lumpur', latitude: 3.2087, longitude: 101.6366, yearsExperience: 5, isVerified: verified, ratingAvg: 4.7, ratingCount: 12,
          subjects: { create: subjects },
          availability: { create: [{ dayOfWeek: 1, startTime: '16:00', endTime: '20:00' }, { dayOfWeek: 3, startTime: '16:00', endTime: '20:00' }] },
        },
      },
    },
    include: { tutor: true },
  })
  const lim = await mkTutor('Lim Mei Ling', 'FEMALE', 55, true, true, [{ subject: 'Mathematics', educationLevel: 'PRIMARY', minGrade: 4, maxGrade: 6 }], true)
  const raj = await mkTutor('Raj Kumar', 'MALE', 60, false, true, [{ subject: 'Science', educationLevel: 'PRIMARY', minGrade: 1, maxGrade: 6 }, { subject: 'Science', educationLevel: 'SECONDARY', minGrade: 1, maxGrade: 3 }], false)
  const nur = await mkTutor('Nur Izzati', 'FEMALE', 45, true, false, [{ subject: 'English', educationLevel: 'PRIMARY', minGrade: 1, maxGrade: 6 }, { subject: 'English', educationLevel: 'SECONDARY', minGrade: 1, maxGrade: 5 }], true)

  const [aina, weiJie] = parentUser.parent.children
  const p = parentUser.parent
  const today = todayMyt()
  const booking = (child, tutor, subject, date, start, status, price, extra = {}) => {
    const startAt = mytToDate(date, start)
    return db.booking.create({
      data: {
        parentId: p.id, childId: child.id, tutorId: tutor.tutor.id, subject, startAt, endAt: new Date(startAt.getTime() + 3600000), teachingMode: 'PHYSICAL',
        location: 'Kepong, Kuala Lumpur', proposedPrice: price, agreedPrice: ['AWAITING_PAYMENT', 'CONFIRMED', 'COMPLETED'].includes(status) ? price : null, status, ...extra,
      },
    })
  }
  await booking(aina, lim, 'Mathematics', nextDow(1), '17:00', 'CONFIRMED', 55)
  const lastWeek = await booking(aina, lim, 'Mathematics', addDays(today, -6), '17:00', 'COMPLETED', 55)
  const twoWeeks = await booking(aina, raj, 'Science', addDays(today, -13), '17:00', 'COMPLETED', 60)
  await booking(weiJie, nur, 'English', nextDow(3), '18:00', 'PENDING', 45)
  await booking(weiJie, raj, 'Science', nextDow(3), '16:00', 'AWAITING_PAYMENT', 60)
  await db.attendance.create({ data: { bookingId: lastWeek.id, checkInAt: new Date(lastWeek.startAt.getTime() + 120000), checkOutAt: lastWeek.endAt, checkInPhotoUrl: 'https://res.cloudinary.com/demo/private-photo.jpg', checkInLat: 3.2, checkInLng: 101.6 } })
  await db.sessionSummary.create({ data: { bookingId: lastWeek.id, content: 'Fractions: adding unlike denominators.', topics: 'Fractions', homework: 'Complete fractions worksheet page 5', progressNote: 'Aina was more confident by the end.' } })
  await db.sessionSummary.create({ data: { bookingId: twoWeeks.id, content: 'Plants and photosynthesis.', homework: 'Draw a labelled plant diagram' } })

  // Payments: one this month, one last month, one partly refunded (approved), one with a pending refund request
  const monthStart = mytToDate(`${today.slice(0, 8)}01`, '00:00')
  const pay = async (b, amount, status, paidAt, refund) => {
    const pmt = await db.payment.create({ data: { bookingId: b.id, amount, commissionRate: 10, commissionAmount: amount / 10, status, paidAt, gatewayRef: 'GW-SECRET-REF' } })
    if (refund) await db.refund.create({ data: { paymentId: pmt.id, amount: refund.amount, type: 'ADMIN_REVIEW', reason: 'Synthetic refund reason', status: refund.status } })
  }
  await pay(lastWeek, 55, 'PAID', new Date(Math.max(monthStart.getTime() + 3600000, lastWeek.startAt.getTime() - 86400000)))
  await pay(twoWeeks, 60, 'PARTIALLY_REFUNDED', new Date(monthStart.getTime() - 5 * 86400000), { amount: 20, status: 'APPROVED' })

  await db.complaint.create({ data: { filedById: parentUser.id, category: 'Lesson quality', description: 'The lesson started late. Call me on 012-555 0101.', status: 'OPEN' } })
  await db.complaint.create({ data: { filedById: parentUser.id, category: 'Payment or refund', description: 'Charged twice', status: 'RESOLVED', adminResponse: 'We refunded the duplicate charge.' } })
  await db.notification.createMany({
    data: [
      { userId: parentUser.id, type: 'BOOKING_CONFIRMED', title: 'Lesson with Lim Mei Ling confirmed', message: 'x', isRead: false },
      { userId: parentUser.id, type: 'LESSON_REMINDER', title: "Aina's Mathematics lesson is tomorrow", message: 'x', isRead: false },
      { userId: parentUser.id, type: 'REFUND_REQUESTED', title: 'Refund request sent', message: 'x', isRead: true },
    ],
  })
  // The other family has a booking too, so cross-family access can be tested
  await db.booking.create({ data: { parentId: otherUser.parent.id, childId: otherUser.parent.children[0].id, tutorId: lim.tutor.id, subject: 'Mathematics', startAt: mytToDate(nextDow(1), '18:00'), endAt: mytToDate(nextDow(1), '19:00'), teachingMode: 'ONLINE', proposedPrice: 50, status: 'PENDING' } })

  return { parentUser, parent: parentUser.parent, otherUser, tutors: { lim, raj, nur } }
}
