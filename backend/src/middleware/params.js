import { AppError } from '../utils/AppError.js'

// Every record ID in a URL (/children/:id, /favourites/:tutorId, ...) must be a whole positive number.
// Checked once here, before any controller runs, so "/children/abc" or "/tutors/1.5" get a clear 400
// instead of reaching Prisma (which would fail with a 500, or round 1.5 down to tutor 1).
const ID_PARAMS = ['id', 'requestId', 'tutorId']
const MAX_ID = 2_147_483_647 // largest value of MySQL INT, the type of every primary key

export function validateIdParams(router) {
  for (const name of ID_PARAMS) {
    router.param(name, (req, res, next, value) => {
      if (!/^\d{1,10}$/.test(value) || Number(value) < 1 || Number(value) > MAX_ID) {
        return next(new AppError(400, 'Invalid ID in the link'))
      }
      next()
    })
  }
  return router
}
