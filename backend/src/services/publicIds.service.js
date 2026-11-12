import { randomUUID } from 'node:crypto'
import { prisma } from '../config/prisma.js'

// Fixed application-owned models: no table/model name is accepted from a request.
const MODELS = ['child', 'booking', 'payment', 'complaint']
const TIMESTAMPED_MODELS = new Set(['booking', 'complaint'])

export async function backfillPublicIds(db = prisma) {
  const counts = {}
  for (const model of MODELS) {
    let count = 0
    const timestamped = TIMESTAMPED_MODELS.has(model)
    while (true) {
      const rows = await db[model].findMany({ where: { publicId: null }, select: { id: true, ...(timestamped && { updatedAt: true }) }, orderBy: { id: 'asc' }, take: 250 })
      if (!rows.length) break
      for (const row of rows) {
        // Conditional update makes repeated/concurrent deployment runs safe and
        // never changes an already published reference.
        // This technical migration must not make a lesson/complaint look edited.
        // Compare the timestamp too so a concurrent business edit is never lost.
        const timestamp = timestamped ? { updatedAt: row.updatedAt } : {}
        const result = await db[model].updateMany({ where: { id: row.id, publicId: null, ...timestamp }, data: { publicId: randomUUID(), ...timestamp } })
        count += result.count
      }
    }
    counts[model] = count
  }
  return counts
}
