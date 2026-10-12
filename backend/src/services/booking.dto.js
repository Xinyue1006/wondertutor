// Shapes a Booking (with relations) for the Parent Portal.
import { toTutorCard } from './tutor.service.js'

export const bookingInclude = {
  tutor: { include: { user: { select: { fullName: true, profilePhotoUrl: true, status: true } }, subjects: true, availability: true } },
  child: true,
  payment: { include: { refunds: { orderBy: { createdAt: 'desc' } } } },
  review: true,
  attendance: true,
  summary: true,
}

const num = (d) => (d == null ? null : Number(d))

export function toBookingDto(b) {
  const hours = (b.endAt - b.startAt) / 3600000
  // Price shown per hour; the effective one is: agreed > counter-offer (if pending) > proposed
  const hourly = num(b.agreedPrice) ?? (b.status === 'COUNTER_OFFERED' ? num(b.counterPrice) : null) ?? num(b.proposedPrice)
  return {
    id: b.id,
    status: b.status,
    subject: b.subject,
    startAt: b.startAt,
    endAt: b.endAt,
    hours,
    teachingMode: b.teachingMode,
    location: b.location,
    meetingLink: b.status === 'CONFIRMED' || b.status === 'COMPLETED' ? b.meetingLink : null,
    isTrial: b.isTrial,
    messageToTutor: b.messageToTutor,
    proposedPrice: num(b.proposedPrice),
    counterPrice: num(b.counterPrice),
    agreedPrice: num(b.agreedPrice),
    hourlyPrice: hourly,
    totalAmount: hourly == null ? null : Math.round(hourly * hours * 100) / 100,
    rejectionReason: b.rejectionReason,
    cancelReason: b.cancelReason,
    createdAt: b.createdAt,
    tutor: b.tutor && { ...toTutorCard(b.tutor, b.subject), levels: undefined },
    child: b.child && { id: b.child.id, name: b.child.name, educationLevel: b.child.educationLevel, grade: b.child.grade, photoUrl: b.child.photoUrl },
    payment: b.payment && {
      id: b.payment.id, status: b.payment.status, amount: num(b.payment.amount), method: b.payment.method,
      gatewayRef: b.payment.gatewayRef, paidAt: b.payment.paidAt,
      refunds: (b.payment.refunds || []).map((r) => ({ id: r.id, amount: num(r.amount), type: r.type, status: r.status, reason: r.reason, createdAt: r.createdAt })),
    },
    review: b.review && { rating: b.review.rating, comment: b.review.comment },
    // Attendance + summary are written by the Tutor Portal; parents only read them
    attendance: b.attendance && {
      checkInAt: b.attendance.checkInAt, checkOutAt: b.attendance.checkOutAt, checkInPhotoUrl: b.attendance.checkInPhotoUrl,
    },
    summary: b.summary && { content: b.summary.content, progressNote: b.summary.progressNote },
  }
}
