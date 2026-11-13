import { z } from 'zod'
import { ymd, ringgit, hourlyRate } from '../../utils/validators.js'
import { listRates, setRate, bookingOverview, decideBooking, refundQueue, decideRefund } from '../../services/adminOperations.service.js'
import { transactions, platformReports, salarySummary } from '../../services/platformReports.service.js'

const reason = z.string().trim().min(1, 'Give a reason for this decision').max(191)
const period = z.object({ from: ymd().optional(), to: ymd().optional() }).strict().refine(x => !x.from || !x.to || x.from <= x.to, 'Start date must be on or before the end date')
const rateBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('COMMISSION'), previous: z.number(), rate: z.number().min(0).max(100).multipleOf(0.01), reason }).strict(),
  z.object({ kind: z.literal('HOURLY'), previous: z.number(), rate: hourlyRate, reason }).strict(),
])
export async function rates(req, res) { res.json(await listRates()) }
export async function rate(req, res) { await setRate(Number(req.params.id), req.user, rateBody.parse(req.body)); res.sendStatus(204) }
export async function bookings(req, res) { res.json({ rows: await bookingOverview() }) }
export async function decide(req, res) {
  const common = { caseId: z.number().int().positive(), version: z.iso.datetime(), reason }
  const input = z.discriminatedUnion('kind', [
    z.object({ ...common, kind: z.literal('Fee negotiation'), action: z.enum(['set-fee','cancel','keep']), price: ringgit().optional() }).strict(),
    z.object({ ...common, kind: z.literal('Schedule change'), action: z.enum(['move','keep']) }).strict(),
    z.object({ ...common, kind: z.literal('Booking cancellation'), action: z.enum(['cancel','keep']) }).strict(),
  ]).refine(x => x.action !== 'set-fee' || x.price != null, 'Enter the final hourly fee').parse(req.body)
  await decideBooking(Number(req.params.id), req.user.id, input)
  res.sendStatus(204)
}
export async function refunds(req, res) { res.json({ rows: await refundQueue() }) }
export async function refund(req, res) {
  const input = z.discriminatedUnion('action', [
    z.object({ action: z.literal('approve'), amount: ringgit('Refund amount', 99999999.99), reason, basis: z.enum(['Mutual agreement','Refund policy condition']) }).strict(),
    z.object({ action: z.literal('reject'), reason }).strict(),
    z.object({ action: z.literal('issued'), reference: z.string().trim().min(1).max(100) }).strict(),
  ]).parse(req.body)
  if (input.action === 'approve') input.reason = input.basis + ': ' + input.reason
  if (input.reason) reason.parse(input.reason)
  await decideRefund(Number(req.params.id), req.user.id, input)
  res.sendStatus(204)
}
export async function ledger(req, res) { res.json({ rows: await transactions(period.parse(req.query)) }) }
export async function reports(req, res) { res.json(await platformReports(period.parse(req.query))) }
export async function payslip(req, res) { res.json(await salarySummary(Number(req.params.id), period.parse(req.query))) }
