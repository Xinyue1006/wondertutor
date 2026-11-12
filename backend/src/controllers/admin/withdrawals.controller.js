import { z } from 'zod'
import { pendingReviews, reviewWithdrawal } from '../../services/earnings.service.js'

export async function list(req, res) {
  res.json({ requests: await pendingReviews() })
}

export async function review(req, res) {
  const expectedStatus = z.enum(['PENDING', 'ESCALATED'])
  const decision = z.discriminatedUnion('status', [
    z.object({ status: z.literal('APPROVED'), expectedStatus }).strict(),
    z.object({ status: z.literal('REJECTED'), expectedStatus, reason: z.string().trim().min(1, 'Explain why the request was rejected').max(191) }).strict(),
  ]).parse(req.body)
  await reviewWithdrawal(Number(req.params.id), req.user.id, decision)
  res.json({ message: 'Withdrawal reviewed.' })
}
