import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'

// Loads the ParentProfile of the logged-in parent into req.parent.
// Every parent query is then filtered by req.parent.id, so a parent can never see another parent's data.
export async function loadParentProfile(req, res, next) {
  const parent = await prisma.parentProfile.findUnique({ where: { userId: req.user.id } })
  if (!parent) throw new AppError(403, 'Parent profile not found')
  req.parent = parent
  next()
}
