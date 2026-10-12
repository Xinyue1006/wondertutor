import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { notify } from '../../services/notification.service.js'

export const COMPLAINT_CATEGORIES = [
  'Tutor behaviour', 'Lesson quality', 'No-show or lateness', 'Payment or refund', 'Safety concern', 'Other',
]

const schema = z.object({
  bookingId: z.number().int().optional().nullable(),
  category: z.enum(COMPLAINT_CATEGORIES, { message: 'Choose a category' }),
  description: z.string().trim().min(10, 'Please describe the problem (at least 10 characters)').max(1000),
})

export const complaintInclude = {
  filedBy: { select: { id: true, fullName: true, email: true } },
  againstUser: { select: { id: true, fullName: true } },
  booking: { select: { id: true, subject: true, startAt: true } },
}

export const toComplaintDto = (c) => ({
  id: c.id,
  category: c.category,
  description: c.description,
  status: c.status,
  adminResponse: c.adminResponse,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  filedBy: c.filedBy && { id: c.filedBy.id, name: c.filedBy.fullName, email: c.filedBy.email },
  against: c.againstUser && { id: c.againstUser.id, name: c.againstUser.fullName },
  booking: c.booking && { id: c.booking.id, subject: c.booking.subject, startAt: c.booking.startAt },
})

// POST /parent/complaints
export async function createComplaint(req, res) {
  const data = schema.parse(req.body)
  let againstUserId = null
  if (data.bookingId) {
    // A parent can only complain about their own bookings
    const booking = await prisma.booking.findFirst({
      where: { id: data.bookingId, parentId: req.parent.id },
      include: { tutor: true },
    })
    if (!booking) throw new AppError(404, 'Booking not found')
    againstUserId = booking.tutor.userId
  }
  const complaint = await prisma.complaint.create({
    data: { filedById: req.user.id, againstUserId, bookingId: data.bookingId ?? null, category: data.category, description: data.description },
    include: complaintInclude,
  })
  const admins = await prisma.user.findMany({ where: { role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })
  await Promise.all(
    admins.map((a) => notify(a.id, { type: 'COMPLAINT_NEW', title: 'New complaint', message: `${req.user.fullName}: ${data.category}`, link: '/admin/complaints' })),
  )
  res.status(201).json({ complaint: toComplaintDto(complaint) })
}

// GET /parent/complaints: the parent's own complaints and their status
export async function listComplaints(req, res) {
  const items = await prisma.complaint.findMany({ where: { filedById: req.user.id }, include: complaintInclude, orderBy: { createdAt: 'desc' } })
  res.json({ categories: COMPLAINT_CATEGORIES, complaints: items.map(toComplaintDto) })
}
