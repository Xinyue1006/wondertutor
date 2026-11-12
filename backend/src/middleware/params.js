import { AppError } from '../utils/AppError.js'
import { prisma } from '../config/prisma.js'
import { isPublicId, referenceWhere } from '../utils/publicIds.js'

// Record URLs accept either an explicitly configured public UUID or a legacy positive integer.
// Checked once here, before any controller runs, so "/children/abc" or "/tutors/1.5" get a clear 400
// instead of reaching Prisma (which would fail with a 500, or round 1.5 down to tutor 1).
const ID_PARAMS = ['id', 'requestId', 'tutorId']
const MAX_ID = 2_147_483_647 // largest value of MySQL INT, the type of every primary key

export function validateIdParams(router, { publicIds = [] } = {}) {
  for (const name of ID_PARAMS) {
    router.param(name, async (req, res, next, value) => {
      // UUIDs are accepted only for explicitly configured record routes. All other
      // IDs (tutors, users, reviews, etc.) keep the strict numeric validation.
      const record = name === 'id' && publicIds.find((item) => req.route.path.startsWith(item.prefix))
      if (record && isPublicId(value)) {
        try {
          const found = await prisma[record.model].findFirst({
            where: { ...referenceWhere(value), ...record.scope(req) }, select: { id: true },
          })
          if (!found) return next(new AppError(404, record.notFound))
          req.params[name] = String(found.id)
          return next()
        } catch (error) { return next(error) }
      }
      if (!/^\d{1,10}$/.test(value) || Number(value) < 1 || Number(value) > MAX_ID) {
        return next(new AppError(400, 'Invalid ID in the link'))
      }
      next()
    })
  }
  return router
}
