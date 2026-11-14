import { attendanceRefundState } from './attendanceRefund.js'
import { timingSafeEqual } from 'node:crypto'
import { v2 as cloudinary } from 'cloudinary'
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { AppError } from '../utils/AppError.js'
import { publicReference } from '../utils/publicIds.js'
import { distanceKm } from './matching.service.js'
import { mediaLink, privateAsset } from './privateMedia.js'
import { getSettings } from './systemSettings.service.js'
import { hasConfirmedLessonLocation, lessonLocationFields } from './lessonLocation.service.js'

export const MISSED_CHECK_IN = 'Missed check-in'

async function booking(db, tutorId, id) {
  const result = await db.booking.findFirst({ where: { id, tutorId }, select: {
    id: true, publicId: true, status: true, subject: true, startAt: true, endAt: true, teachingMode: true,
    latitude: true, longitude: true, location: true, locationConfirmedAt: true, updatedAt: true, child: { select: { name: true } },
    complaints: { where: { category: MISSED_CHECK_IN }, select: { attendanceRefund: { select: { status: true, issuedAt: true, reviewNote: true, payment: { select: { status: true } } } }, id: true, updatedAt: true, attendanceOutcome: true, tutorReplyPending: true, reviewHistory: { orderBy: { id: 'asc' } }, evidenceUrl: true, attendanceApproved: true, description: true, status: true, adminResponse: true }, take: 1 },
    tutor: { select: { userId: true } }, parent: { select: { userId: true } }, attendance: true, summary: true,
  } })
  if (!result) throw new AppError(404, 'Lesson not found')
  return result
}

export async function sessionView(tutorId, id) {
  const [b, settings] = await Promise.all([booking(prisma, tutorId, id), getSettings()])
  if (!['CONFIRMED', 'COMPLETED', 'DISPUTED'].includes(b.status)) throw new AppError(409, 'This lesson is not confirmed.')
  const a = b.attendance
  const review = b.complaints[0]
  return { id, publicId: b.publicId, subject: b.subject, student: b.child.name, status: b.status, startAt: b.startAt, endAt: b.endAt,
    mode: b.teachingMode, address: b.location, updatedAt: b.updatedAt, ...lessonLocationFields(b),
    review: review ? { ...review, attendanceRefund: review.attendanceRefund && { status: review.attendanceRefund.status, attendanceRefundState: attendanceRefundState(review, review.attendanceRefund) }, reviewHistory: review.reviewHistory.filter(entry => entry.action !== 'PREVIOUS_PARENT_RESPONSE').map(entry => ({ action: entry.action, message: entry.message, createdAt: entry.createdAt })), evidenceUrl: mediaLink(review.evidenceUrl, 'wondertutor/attendance/' + id) } : null, radius: settings.GPS_RADIUS_METRES, serverTime: new Date(),
    attendance: a && { checkInAt: a.checkInAt, checkOutAt: a.checkOutAt, distance: a.checkInDistance,
      photo: mediaLink(a.checkInPhotoUrl, 'wondertutor/attendance/' + id) },
    report: b.summary && { content: b.summary.content, progressNote: b.summary.progressNote, homework: b.summary.homework, recommendations: b.summary.recommendations },
  }
}

function verifyPhoto(photo, id) {
  const asset = privateAsset(photo.url, 'wondertutor/attendance/' + id)
  if (!asset || asset.format === 'pdf' || !env.cloudinary.apiSecret) throw new AppError(400, 'Upload a check-in photo for this lesson.')
  // Verify the upload receipt before accepting a photo as evidence.
  const expected = cloudinary.utils.api_sign_request({ public_id: asset.id, version: photo.version }, env.cloudinary.apiSecret)
  if (photo.signature.length !== expected.length || !timingSafeEqual(Buffer.from(photo.signature), Buffer.from(expected))) {
    throw new AppError(400, 'The photo upload could not be verified. Take or upload the photo again.')
  }
}

async function checkIn(db, b, input, now) {
  if (b.attendance?.checkInAt) throw new AppError(409, 'You have already checked in.')
  if (now < b.startAt || now >= b.endAt) throw new AppError(409, 'Check in during the scheduled lesson.')
  let evidence = {}
  if (b.teachingMode === 'PHYSICAL') {
    if (!hasConfirmedLessonLocation(b)) throw new AppError(409, 'The parent must confirm the exact lesson address and map pin in My Bookings before GPS check-in.')
    if (!input.coords || !input.photo) throw new AppError(400, 'Your location and a check-in photo are required.')
    const { lat, lng } = input.coords
    const km = distanceKm(lat, lng, b.latitude, b.longitude)
    if (km == null) throw new AppError(409, 'This lesson address has no saved coordinates. Contact admin.')
    const distance = km * 1000
    const { GPS_RADIUS_METRES: radius } = await getSettings(db)
    if (!(distance <= radius)) throw new AppError(409, 'Check in within ' + radius + ' metres of the lesson address.')
    verifyPhoto(input.photo, b.id)
    evidence = { checkInLat: lat, checkInLng: lng, checkInDistance: distance, checkInPhotoUrl: input.photo.url }
  }
  const data = { checkInAt: now, ...evidence }
  await db.attendance.upsert({ where: { bookingId: b.id }, create: { bookingId: b.id, ...data }, update: data })
}

export async function updateSession(tutorId, id, input) {
  await prisma.$transaction(async db => {
    // Serialize attendance and completion so retries cannot create duplicate reports or notifications.
    await db.$queryRaw`SELECT id FROM Booking WHERE id = ${id} AND tutorId = ${tutorId} FOR UPDATE`
    const b = await booking(db, tutorId, id)
    if (b.status !== 'CONFIRMED') throw new AppError(409, 'Only confirmed lessons can be updated.')
    const now = new Date()
    if (input.action === 'review-reply' || input.action === 'reconsider') {
      const review = b.complaints[0]
      const appeal = input.action === 'reconsider'
      if (!review || (appeal ? review.status !== 'DISMISSED' : !review.tutorReplyPending)) throw new AppError(409, 'This review is no longer waiting for that action.')
      if (input.photo) verifyPhoto(input.photo, id)
      const newText = input.reason.toLowerCase()
      if (appeal && [review.description, ...review.reviewHistory.map(entry => entry.message)].some(message => message.trim().toLowerCase() === newText)
        && (!input.photo || [review.evidenceUrl, ...review.reviewHistory.map(entry => entry.evidenceUrl)].includes(input.photo.url))) throw new AppError(400, 'Provide new evidence or explain what new information you have.')
      const { count } = await db.complaint.updateMany({ where: { id: review.id, updatedAt: review.updatedAt, status: review.status },
        data: { tutorReplyPending: false, ...(input.photo && { evidenceUrl: input.photo.url }),
          ...(appeal && { status: 'IN_PROGRESS', attendanceOutcome: 'RECONSIDERATION', adminResponse: null }) } })
      if (!count) throw new AppError(409, 'The review changed. Refresh and try again.')
      if (appeal && !review.reviewHistory.some(entry => entry.action === 'UNVERIFIED' || entry.action === 'NOT_HELD')) {
        await db.attendanceReviewEntry.create({ data: { complaintId: review.id, action: 'UNVERIFIED', message: review.adminResponse || 'Earlier review closed.', evidenceUrl: review.evidenceUrl, createdAt: review.updatedAt } })
      }
      await db.attendanceReviewEntry.create({ data: { complaintId: review.id, action: appeal ? 'RECONSIDERATION' : 'TUTOR_REPLY', message: input.reason, evidenceUrl: input.photo?.url } })
      const admins = await db.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
      const notification = { type: 'ATTENDANCE_REVIEW', title: 'Missed check-in review', message: appeal ? 'The tutor has asked for reconsideration with new evidence.' : 'The tutor replied to the request for more information.' }
      await db.notification.createMany({ data: [
        ...admins.map(admin => ({ ...notification, userId: admin.id, link: '/admin/complaints' })),
        ...(appeal ? [{ ...notification, userId: b.parent.userId, link: '/parent/bookings?booking=' + publicReference(b) }] : []),
      ] })
      return
    }
    if (input.action === 'attach-proof') {
      verifyPhoto(input.photo, id)
      const { count } = await db.complaint.updateMany({ where: { bookingId: id, category: MISSED_CHECK_IN, status: { in: ['OPEN', 'IN_PROGRESS'] } }, data: { evidenceUrl: input.photo.url } })
      if (!count) throw new AppError(409, 'This review is no longer open.')
      return
    }
    if (input.action === 'request-review') {
      if (now < b.endAt || b.attendance?.checkInAt) throw new AppError(409, 'Only a missed check-in after the lesson ends can be reviewed.')
      if (b.complaints.length) throw new AppError(409, 'A review has already been requested.')
      if (input.photo) verifyPhoto(input.photo, id)
      await db.complaint.create({ data: { bookingId: id, filedById: b.tutor.userId, category: MISSED_CHECK_IN, description: input.reason, evidenceUrl: input.photo?.url } })
      const admins = await db.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
      await db.notification.createMany({ data: [
        ...admins.map(admin => ({ userId: admin.id, type: 'COMPLAINT_NEW', title: 'Missed check-in review', message: 'A tutor requested a review of their ' + b.subject + ' lesson.', link: '/admin/complaints' })),
        { userId: b.parent.userId, type: 'ATTENDANCE_REVIEW', title: 'Missed check-in review', message: 'Your tutor asked an admin to review a missed check-in for ' + b.subject + '. Open the booking to tell admin whether the lesson took place.', link: '/parent/bookings?booking=' + publicReference(b) },
      ] })
      return
    }
    if (input.action === 'check-in') return checkIn(db, b, input, now)
    const approvedReport = input.action === 'report' && b.complaints[0]?.attendanceApproved
    if (!approvedReport && !b.attendance?.checkInAt) throw new AppError(409, 'Check in first.')
    if (input.action === 'check-out') {
      if (now < b.endAt) throw new AppError(409, 'Check-out opens at the scheduled end time.')
      if (b.attendance.checkOutAt) throw new AppError(409, 'You have already checked out.')
      await db.attendance.update({ where: { bookingId: id }, data: { checkOutAt: now } })
      return
    }
    if (!approvedReport && !b.attendance?.checkOutAt) throw new AppError(409, 'Check out before submitting the report.')
    if (b.summary) throw new AppError(409, 'This lesson already has a report.')
    await db.sessionSummary.create({ data: { bookingId: id, content: input.content, progressNote: input.progressNote, homework: input.homework || null, recommendations: input.recommendations || null } })
    await db.booking.update({ where: { id }, data: { status: 'COMPLETED' } })
    await db.notification.create({ data: { userId: b.parent.userId, type: 'LESSON_COMPLETED', title: 'Lesson report ready',
      message: 'Your tutor has submitted the ' + b.subject + ' lesson report.', link: '/parent/bookings?booking=' + publicReference(b) } })
  })
  return sessionView(tutorId, id)
}
