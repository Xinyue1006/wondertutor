import { z } from 'zod'
import { id, hhmm, ringgit, ymd } from '../../utils/validators.js'
import { listBookings, ownBooking, tutorBooking, tutorAction } from '../../services/tutorBooking.service.js'
import { requestReschedule, respondReschedule, withdrawReschedule } from '../../services/reschedule.service.js'

const reason = z.string().trim().min(1, 'Give a reason').max(200)
const version = z.iso.datetime()
const change = z.discriminatedUnion('action', [
  z.object({ action: z.literal('accept'), version }),
  z.object({ action: z.literal('counter'), version, price: ringgit('Hourly rate') }),
  z.object({ action: z.enum(['cancel', 'decline', 'escalate']), version, reason }),
  z.object({ action: z.literal('link'), version, url: z.url({ protocol: /^https$/ }).max(191) }),
  z.object({ action: z.literal('reschedule'), date: ymd(), startTime: hhmm().refine(v => v.endsWith(':00'), 'Choose a whole hour'), reason }),
  z.object({ action: z.enum(['approve-time', 'decline-time', 'withdraw-time']), requestId: id('Request') }),
])

export async function list(req, res) {
  res.json({ bookings: await listBookings(req.tutor.id) })
}

export async function update(req, res) {
  const input = change.parse(req.body)
  const bookingId = Number(req.params.id)
  if (input.action === 'reschedule' || input.requestId) {
    const booking = await ownBooking(req.tutor.id, bookingId)
    const args = { booking, byUserId: req.user.id, ...input }
    if (input.action === 'reschedule') await requestReschedule(args)
    else if (input.action === 'withdraw-time') await withdrawReschedule(args)
    else await respondReschedule({ ...args, accept: input.action === 'approve-time' })
  } else await tutorAction(req.tutor.id, bookingId, input)
  res.json({ booking: tutorBooking(await ownBooking(req.tutor.id, bookingId)) })
}
