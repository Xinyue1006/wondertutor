import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { notify } from '../../services/notification.service.js'
import { complaintInclude, toComplaintDto } from '../parent/complaints.controller.js'
import { mytToDate, addDays } from '../../utils/time.js'

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

// ───────────── Reports ─────────────
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-01')
const periodSchema = z.object({ from: ymd.optional(), to: ymd.optional(), status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED']).optional() })

// Complaints filed inside [from, to] (Malaysia dates, both days included). No dates = everything.
function periodWhere({ from, to, status }) {
  const createdAt = {}
  if (from) createdAt.gte = mytToDate(from, '00:00')
  if (to) createdAt.lt = mytToDate(addDays(to, 1), '00:00')
  return { ...(from || to ? { createdAt } : {}), ...(status && { status }) }
}

export const OVERDUE_DAYS = 7

// GET /admin/complaints/report?from=&to= : the numbers an admin needs to see how complaints are being handled
export async function complaintsReport(req, res) {
  const q = periodSchema.parse(req.query)
  const where = periodWhere(q)
  const rows = await prisma.complaint.findMany({ where, include: { againstUser: { select: { id: true, fullName: true, role: true } } } })

  const byStatus = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, DISMISSED: 0 }
  const byCategory = {}
  const against = {}
  let closedHours = 0
  let closed = 0
  const overdueBefore = Date.now() - OVERDUE_DAYS * 86_400_000
  let overdue = 0
  for (const c of rows) {
    byStatus[c.status]++
    byCategory[c.category] = (byCategory[c.category] || 0) + 1
    if (['RESOLVED', 'DISMISSED'].includes(c.status)) {
      closed++
      closedHours += (c.updatedAt - c.createdAt) / 3_600_000 // a closed complaint is not edited again, so updatedAt is when it was closed
    } else if (c.createdAt.getTime() < overdueBefore) overdue++
    if (c.againstUser) {
      const k = c.againstUser.id
      against[k] = against[k] || { userId: k, name: c.againstUser.fullName, role: c.againstUser.role, count: 0 }
      against[k].count++
    }
  }
  res.json({
    period: { from: q.from || null, to: q.to || null },
    total: rows.length,
    byStatus,
    byCategory: Object.entries(byCategory).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    // Open or in progress for more than a week: these need attention first
    overdue,
    overdueDays: OVERDUE_DAYS,
    averageResolutionHours: closed ? Math.round((closedHours / closed) * 10) / 10 : null,
    resolutionRate: rows.length ? Math.round((closed / rows.length) * 100) : null,
    mostComplainedAbout: Object.values(against).sort((a, b) => b.count - a.count).slice(0, 5),
  })
}

// CSV cells: quote everything, double any quotes, and stop spreadsheet formulas (a cell starting with = + - @)
// from running when the file is opened in Excel
function csvCell(v) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}
const myt = (d) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }) : '')

// GET /admin/complaints/export?from=&to=&status= : download as a CSV file for record keeping
export async function exportComplaints(req, res) {
  const q = periodSchema.parse(req.query)
  const rows = await prisma.complaint.findMany({ where: periodWhere(q), include: complaintInclude, orderBy: { createdAt: 'asc' } })
  const header = ['ID', 'Filed on', 'Status', 'Category', 'Filed by', 'Filed by email', 'Against', 'Booking', 'Description', 'Admin response', 'Last updated']
  const lines = [header.map(csvCell).join(',')]
  for (const c of rows) {
    lines.push([
      c.id, myt(c.createdAt), c.status, c.category, c.filedBy?.fullName, c.filedBy?.email, c.againstUser?.fullName,
      c.booking ? `#${c.booking.id} ${c.booking.subject}` : '', c.description, c.adminResponse, myt(c.updatedAt),
    ].map(csvCell).join(','))
  }
  const name = `complaints${q.from ? `-from-${q.from}` : ''}${q.to ? `-to-${q.to}` : ''}.csv`
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="${name}"`)
  res.send('\uFEFF' + lines.join('\r\n')) // BOM so Excel reads names with accents correctly
}
