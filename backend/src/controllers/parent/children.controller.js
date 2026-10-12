import { z } from 'zod'
import { prisma } from '../../config/prisma.js'
import { AppError } from '../../utils/AppError.js'
import { MAX_GRADE, SUBJECTS } from '../../data/catalog.js'

const childSchema = z
  .object({
    name: z.string().trim().min(1, 'Child name is required').max(60),
    educationLevel: z.enum(['KINDERGARTEN', 'PRIMARY', 'SECONDARY'], { message: 'Choose an education level' }),
    grade: z.coerce.number().int().min(1, 'Choose a grade'),
    subject: z.enum(SUBJECTS).optional().nullable(),
    notes: z.string().trim().max(500, 'Notes must be 500 characters or fewer').optional().nullable(),
  })
  .refine((d) => d.grade <= MAX_GRADE[d.educationLevel], { message: 'That grade does not exist for the chosen level', path: ['grade'] })

export const toChildDto = (c) => ({
  id: c.id,
  name: c.name,
  educationLevel: c.educationLevel,
  grade: c.grade,
  subject: c.subject,
  notes: c.notes,
  photoUrl: c.photoUrl,
  bookingCount: c._count?.bookings ?? undefined,
})

// Ownership check used by every child route: a parent can only touch their own children
async function ownChild(req) {
  const child = await prisma.child.findFirst({ where: { id: Number(req.params.id), parentId: req.parent.id } })
  if (!child) throw new AppError(404, 'Child not found')
  return child
}

export async function listChildren(req, res) {
  const children = await prisma.child.findMany({
    where: { parentId: req.parent.id },
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { bookings: true } } },
  })
  res.json({ children: children.map(toChildDto) })
}

export async function createChild(req, res) {
  const data = childSchema.parse(req.body)
  const child = await prisma.child.create({ data: { ...data, parentId: req.parent.id } })
  res.status(201).json({ child: toChildDto(child) })
}

export async function updateChild(req, res) {
  const existing = await ownChild(req)
  const data = childSchema.parse(req.body)
  const child = await prisma.child.update({ where: { id: existing.id }, data })
  res.json({ child: toChildDto(child) })
}

export async function deleteChild(req, res) {
  const existing = await ownChild(req)
  // Bookings keep a reference to the child (lesson history, payments), so a child with bookings can't be removed
  const bookings = await prisma.booking.count({ where: { childId: existing.id } })
  if (bookings > 0) throw new AppError(409, 'This child has lesson history and cannot be removed.')
  await prisma.child.delete({ where: { id: existing.id } })
  res.json({ message: 'Child removed' })
}
