import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { notify } from '../../services/notification.service.js'
import { complaintInclude, toComplaintDto } from '../parent/complaints.controller.js'

// GET /admin/complaints?status=OPEN
export async function listComplaints(req, res) {
  const status = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED']).optional().parse(req.query.status || undefined)
  const [items, grouped] = await Promise.all([
    prisma.complaint.findMany({ where: status ? { status } : {}, include: complaintInclude, orderBy: { createdAt: 'desc' } }),
    prisma.complaint.groupBy({ by: ['status'], _count: { _all: true } }),
  ])
  const counts = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, DISMISSED: 0 }
  for (const g of grouped) counts[g.status] = g._count._all
  res.json({ counts, complaints: items.map(toComplaintDto) })
}

const updateSchema = z
  .object({
    status: z.enum(['IN_PROGRESS', 'RESOLVED', 'DISMISSED']),
    adminResponse: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.status === 'IN_PROGRESS' || (d.adminResponse && d.adminResponse.length >= 3), {
    message: 'Please write a response before resolving or dismissing',
    path: ['adminResponse'],
  })

// PATCH /admin/complaints/:id: OPEN -> IN_PROGRESS -> RESOLVED / DISMISSED. The parent is notified.
export async function updateComplaint(req, res) {
  const data = updateSchema.parse(req.body)
  const existing = await prisma.complaint.findUnique({ where: { id: Number(req.params.id) } })
  if (!existing) throw new AppError(404, 'Complaint not found')
  if (['RESOLVED', 'DISMISSED'].includes(existing.status)) throw new AppError(400, 'This complaint is already closed')

  const updated = await prisma.complaint.update({
    where: { id: existing.id },
    data: { status: data.status, adminResponse: data.adminResponse ?? existing.adminResponse, handledById: req.user.id },
    include: complaintInclude,
  })
  const label = { IN_PROGRESS: 'is being reviewed', RESOLVED: 'has been resolved', DISMISSED: 'was reviewed and closed' }[data.status]
  await notify(existing.filedById, {
    type: 'COMPLAINT_UPDATE',
    title: 'Complaint update',
    message: `Your complaint (${existing.category}) ${label}.`,
    link: '/parent/complaints',
  })
  res.json({ complaint: toComplaintDto(updated) })
}
