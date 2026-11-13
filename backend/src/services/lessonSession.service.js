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

async function booking(db, tutorId, id) {
  const result = await db.booking.findFirst({ where: { id, tutorId }, select: {
    id: true, publicId: true, status: true, subject: true, startAt: true, endAt: true, teachingMode: true,
    latitude: true, longitude: true, location: true, locationConfirmedAt: true, updatedAt: true, child: { select: { name: true } },
    parent: { select: { userId: true } }, attendance: true, summary: true,
  } })
  if (!result) throw new AppError(404, 'Lesson not found')
  return result
}

export async function sessionView(tutorId, id) {
  const [b, settings] = await Promise.all([booking(prisma, tutorId, id), getSettings()])
  if (!['CONFIRMED', 'COMPLETED', 'DISPUTED'].includes(b.status)) throw new AppError(409, 'This lesson is not confirmed.')
  const a = b.attendance
  return { id, publicId: b.publicId, subject: b.subject, student: b.child.name, status: b.status, startAt: b.startAt, endAt: b.endAt,
    mode: b.teachingMode, address: b.location, updatedAt: b.updatedAt, ...lessonLocationFields(b),
    radius: settings.GPS_RADIUS_METRES, serverTime: new Date(),
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
    if (input.action === 'check-in') return checkIn(db, b, input, now)
    if (!b.attendance?.checkInAt) throw new AppError(409, 'Check in first.')
    if (input.action === 'check-out') {
      if (now < b.endAt) throw new AppError(409, 'Check-out opens at the scheduled end time.')
      if (b.attendance.checkOutAt) throw new AppError(409, 'You have already checked out.')
      await db.attendance.update({ where: { bookingId: id }, data: { checkOutAt: now } })
      return
    }
    if (!b.attendance.checkOutAt) throw new AppError(409, 'Check out before submitting the report.')
    if (b.summary) throw new AppError(409, 'This lesson already has a report.')
    await db.sessionSummary.create({ data: { bookingId: id, content: input.content, progressNote: input.progressNote, homework: input.homework || null, recommendations: input.recommendations || null } })
    await db.booking.update({ where: { id }, data: { status: 'COMPLETED' } })
    await db.notification.create({ data: { userId: b.parent.userId, type: 'LESSON_COMPLETED', title: 'Lesson report ready',
      message: 'Your tutor has submitted the ' + b.subject + ' lesson report.', link: '/parent/bookings?booking=' + publicReference(b) } })
  })
  return sessionView(tutorId, id)
}
