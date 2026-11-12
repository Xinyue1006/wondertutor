import { z } from 'zod'
import { sessionView, updateSession } from '../../services/lessonSession.service.js'

const coords = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict()
const photo = z.object({ url: z.url().max(191), signature: z.string().regex(/^[a-f0-9]{40}$/), version: z.number().int().positive() }).strict()
const requiredText = z.string().trim().min(1, 'Complete both report fields.').max(5000)
const action = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check-in'), coords: coords.optional(), photo: photo.optional() }).strict(),
  z.object({ action: z.literal('check-out') }).strict(),
  z.object({ action: z.literal('report'), content: requiredText, progressNote: requiredText, homework: z.string().trim().max(5000).optional(), recommendations: z.string().trim().max(5000).optional() }).strict(),
])

export async function get(req, res) {
  res.json(await sessionView(req.tutor.id, Number(req.params.id)))
}

export async function update(req, res) {
  res.json(await updateSession(req.tutor.id, Number(req.params.id), action.parse(req.body)))
}
