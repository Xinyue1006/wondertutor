import { prisma } from '../config/prisma.js'

const defaults = { GPS_RADIUS_METRES: 100, RATING_THRESHOLD: 3, BASE_COMMISSION_RATE: 10 }

export async function getSettings(db = prisma) {
  const rows = await db.systemSetting.findMany({ where: { key: { in: Object.keys(defaults) } } })
  return { ...defaults, ...Object.fromEntries(rows.map(({ key, value }) => [key, Number(value)])) }
}

export async function baseCommission(db) {
  const row = await db.systemSetting.findUnique({ where: { key: 'BASE_COMMISSION_RATE' } })
  return row?.value ?? defaults.BASE_COMMISSION_RATE
}

export function saveSetting(key, value) {
  return prisma.$transaction(async (db) => {
    if (key === 'BASE_COMMISSION_RATE') {
      // Older verified tutors may still depend on the previous platform rate.
      const previous = await baseCommission(db)
      await db.tutorProfile.updateMany({ where: { isVerified: true, commissionRate: null }, data: { commissionRate: previous } })
    }
    await db.systemSetting.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } })
  })
}
