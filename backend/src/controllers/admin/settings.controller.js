import { z } from 'zod'
import { getSettings, saveSetting } from '../../services/systemSettings.service.js'

const setting = z.discriminatedUnion('key', [
  z.object({ key: z.literal('GPS_RADIUS_METRES'), value: z.number().int().min(50).max(300) }).strict(),
  z.object({ key: z.literal('RATING_THRESHOLD'), value: z.number().min(1).max(5).multipleOf(0.1) }).strict(),
  z.object({ key: z.literal('BASE_COMMISSION_RATE'), value: z.number().min(0).max(100).multipleOf(0.01) }).strict(),
])

export async function list(req, res) {
  res.json(await getSettings())
}

export async function update(req, res) {
  const { key, value } = setting.parse(req.body)
  await saveSetting(key, value)
  res.json({ key, value })
}
