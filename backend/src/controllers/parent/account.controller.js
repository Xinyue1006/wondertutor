// Account controls for a parent (Malaysia's PDPA gives people the right to see, correct and withdraw their data):
//   - switch reminder emails on or off
//   - download a copy of everything we hold about them
//   - delete the account: personal details are removed; lesson and payment records stay (anonymised) because the
//     centre needs them for its accounts and for disputes
import bcrypt from 'bcrypt'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { sendEmail } from '../../services/email.service.js'
import { renderEmail } from '../../services/notification.service.js'

// PUT /parent/account/email-reminders { enabled }
export async function setEmailReminders(req, res) {
  const { enabled } = z.object({ enabled: z.boolean({ message: 'Choose on or off' }) }).parse(req.body)
  await prisma.user.update({ where: { id: req.user.id }, data: { emailReminders: enabled } })
  res.json({ emailReminders: enabled })
}

const num = (d) => (d == null ? null : Number(d))

// GET /parent/account/export: one JSON file with the person's own data (never anyone else's, never the password)
export async function exportMyData(req, res) {
  const parentId = req.parent.id
  const [children, bookings, complaints, favourites, searches, notifications] = await Promise.all([
    prisma.child.findMany({ where: { parentId }, orderBy: { id: 'asc' } }),
    prisma.booking.findMany({
      where: { parentId },
      orderBy: { startAt: 'asc' },
      include: { child: true, tutor: { include: { user: { select: { fullName: true } } } }, payment: { include: { refunds: true } }, review: true },
    }),
    prisma.complaint.findMany({ where: { filedById: req.user.id }, orderBy: { id: 'asc' } }),
    prisma.favouriteTutor.findMany({ where: { parentId }, include: { tutor: { include: { user: { select: { fullName: true } } } } } }),
    prisma.matchingRequest.findMany({ where: { parentId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true, source: true, criteria: true } }),
    prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 200 }),
  ])

  const data = {
    exportedAt: new Date().toISOString(),
    about: 'A copy of the personal data WonderTutor holds about you. Passwords are never stored in readable form, so none is included.',
    account: {
      fullName: req.user.fullName,
      email: req.user.email,
      phone: req.user.phone,
      profilePhotoUrl: req.user.profilePhotoUrl,
      createdAt: req.user.createdAt,
      privacyNoticeAcceptedAt: req.user.privacyAcceptedAt,
      reminderEmails: req.user.emailReminders,
      signsInWithGoogle: Boolean(req.user.googleId),
    },
    address: req.parent.address,
    tutorPreferences: req.parent.preferences ?? null,
    children: children.map((c) => ({ name: c.name, educationLevel: c.educationLevel, grade: c.grade, subject: c.subject, notes: c.notes, photoUrl: c.photoUrl })),
    bookings: bookings.map((b) => ({
      id: b.id,
      status: b.status,
      child: b.child.name,
      tutor: b.tutor.user.fullName,
      subject: b.subject,
      startAt: b.startAt,
      endAt: b.endAt,
      teachingMode: b.teachingMode,
      location: b.location,
      messageToTutor: b.messageToTutor,
      proposedPrice: num(b.proposedPrice),
      agreedPrice: num(b.agreedPrice),
      cancelReason: b.cancelReason,
      payment: b.payment && {
        amount: num(b.payment.amount),
        status: b.payment.status,
        method: b.payment.method,
        reference: b.payment.gatewayRef,
        paidAt: b.payment.paidAt,
        refunds: b.payment.refunds.map((r) => ({ amount: num(r.amount), status: r.status, reason: r.reason })),
      },
      review: b.review && { rating: b.review.rating, comment: b.review.comment, photoUrl: b.review.photoUrl },
    })),
    complaints: complaints.map((c) => ({ category: c.category, description: c.description, status: c.status, response: c.adminResponse, filedAt: c.createdAt })),
    savedTutors: favourites.map((f) => f.tutor.user.fullName),
    tutorSearches: searches,
    notifications: notifications.map((n) => ({ title: n.title, message: n.message, at: n.createdAt })),
  }

  res.set('Content-Type', 'application/json; charset=utf-8')
  res.set('Content-Disposition', 'attachment; filename="wondertutor-my-data.json"')
  res.send(JSON.stringify(data, null, 2))
}

// Things that must be finished first, so no tutor is left waiting for a parent who is gone and no refund is lost
const ACTIVE_STATUSES = ['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT', 'CONFIRMED', 'DISPUTED']

export async function deletionBlockers(parentId, userId) {
  const [bookings, refunds, complaints] = await Promise.all([
    prisma.booking.count({ where: { parentId, status: { in: ACTIVE_STATUSES } } }),
    prisma.refund.count({ where: { status: 'PENDING', payment: { booking: { parentId } } } }),
    prisma.complaint.count({ where: { filedById: userId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
  ])
  return { bookings, refunds, complaints }
}

// GET /parent/account/deletion-check: what (if anything) still has to be finished, so the screen can say so up front
export async function deletionCheck(req, res) {
  const blockers = await deletionBlockers(req.parent.id, req.user.id)
  res.json({ blockers, canDelete: !blockers.bookings && !blockers.refunds && !blockers.complaints, hasPassword: Boolean(req.user.passwordHash) })
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// POST /parent/account/delete { confirmEmail, password? }
export async function deleteMyAccount(req, res) {
  const { confirmEmail, password } = z
    .object({ confirmEmail: z.string().trim().toLowerCase().max(254), password: z.string().max(200).optional() })
    .parse(req.body)

  // Two checks so it cannot happen by accident or from a left-open screen: the email typed out, and the password
  if (confirmEmail !== req.user.email.toLowerCase()) throw new AppError(400, 'The email you typed does not match your account')
  if (req.user.passwordHash) {
    if (!password) throw new AppError(400, 'Enter your password to confirm')
    if (!(await bcrypt.compare(password, req.user.passwordHash))) throw new AppError(400, 'Incorrect password')
  }

  const blockers = await deletionBlockers(req.parent.id, req.user.id)
  if (blockers.bookings || blockers.refunds || blockers.complaints) {
    const todo = [
      blockers.bookings && `${plural(blockers.bookings, 'booking')} still in progress (cancel or finish ${blockers.bookings === 1 ? 'it' : 'them'} in My Bookings)`,
      blockers.refunds && `${plural(blockers.refunds, 'refund request')} waiting for our team`,
      blockers.complaints && `${plural(blockers.complaints, 'open complaint')}`,
    ].filter(Boolean)
    throw new AppError(409, `Before you delete your account, please finish: ${todo.join('; ')}.`)
  }

  const { id: userId, email, fullName } = req.user
  const parentId = req.parent.id
  await prisma.$transaction([
    // The address copied onto each booking, and the free-text the parent wrote to tutors
    prisma.booking.updateMany({ where: { parentId }, data: { location: null, latitude: null, longitude: null, messageToTutor: null } }),
    prisma.review.updateMany({ where: { parentId }, data: { photoUrl: null } }),
    prisma.child.updateMany({ where: { parentId }, data: { name: 'Child', notes: null, photoUrl: null } }),
    prisma.favouriteTutor.deleteMany({ where: { parentId } }),
    prisma.matchingRequest.deleteMany({ where: { parentId } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.emailOtp.deleteMany({ where: { email } }),
    prisma.parentProfile.update({ where: { id: parentId }, data: { address: null, latitude: null, longitude: null, preferences: Prisma.DbNull } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        // A unique address that can never receive mail, so the real one is free to sign up again
        email: `deleted-${userId}@deleted.invalid`,
        fullName: 'Deleted user',
        phone: null,
        passwordHash: null,
        googleId: null,
        profilePhotoUrl: null,
        isEmailVerified: false,
        emailReminders: false,
        status: 'DEACTIVATED',
        deletedAt: new Date(),
      },
    }),
  ])

  // A last email to the old address as a record. It must never undo the deletion if it fails.
  try {
    await sendEmail({
      to: email,
      subject: 'WonderTutor — your account was deleted',
      html: renderEmail({
        name: fullName,
        message: 'Your WonderTutor account has been deleted and your personal details have been removed. Past lesson and payment records are kept without your name, because the centre needs them for its accounts. You are welcome to sign up again at any time.',
        note: 'If you did not do this, please contact the centre as soon as possible.',
      }),
    })
  } catch (err) {
    console.error('Deletion email failed:', err.message)
  }

  res.json({ message: 'Your account has been deleted.' })
}
