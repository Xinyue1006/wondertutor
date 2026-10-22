// Billplz payments, with Billplz itself replaced by a small fake so no network or real account is needed.
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { signatureFor, signatureIsValid } from '../services/billplz.service.js'
import { MONDAY, api, apiBase, makeBooking, makeParent, makeTutor, nextDate, resetDb, startServer, stopServer } from './helpers.js'

const realFetch = global.fetch
const BASE = 'https://billplz.test/api'
const KEY = 'test-x-signature-key'
let parent, other, monday
let bills = {}
let created = []
let billCount = 0

beforeAll(async () => {
  await resetDb()
  await startServer()
  parent = await makeParent()
  other = await makeParent()
  monday = nextDate(MONDAY)
  Object.assign(env.billplz, { apiKey: 'test-key', collectionId: 'col1', xSignature: KEY, baseUrl: BASE })

  // Only calls to Billplz are faked: requests to our own test server go through normally
  global.fetch = async (url, options = {}) => {
    const u = String(url)
    if (!u.startsWith(BASE)) return realFetch(url, options)
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    if (u === `${BASE}/v3/bills` && options.method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(options.body))
      created.push(form)
      const id = `bill${++billCount}`
      bills[id] = { id, amount: Number(form.amount), paid: false, state: 'due', url: `https://billplz.test/bills/${id}` }
      return json(200, bills[id])
    }
    const found = bills[u.split('/').pop()]
    return found ? json(200, found) : json(404, { error: { message: ['not found'] } })
  }
})
afterAll(async () => {
  global.fetch = realFetch
  Object.assign(env.billplz, { apiKey: '', collectionId: undefined, xSignature: undefined })
  await stopServer()
})

// A booking waiting for payment, with a Billplz bill already created for it
async function startPayment({ price = 60, start = '17:00' } = {}) {
  const t = await makeTutor()
  const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start, status: 'AWAITING_PAYMENT', price })
  const res = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })
  return { booking: b, checkout: res }
}

// What Billplz puts in the address bar when it sends the parent back
const redirectBody = (id, paid, key = KEY) => {
  const fields = { 'billplz[id]': id, 'billplz[paid]': String(paid), 'billplz[paid_at]': '2026-10-22 10:00:00 +0800' }
  return { id, paid: String(paid), paid_at: fields['billplz[paid_at]'], x_signature: signatureFor(fields, key) }
}
const markPaid = (id) => { bills[id].paid = true; bills[id].state = 'paid' }

async function callback(fields) {
  const res = await realFetch(`${apiBase()}/payments/billplz/callback`, { method: 'POST', body: new URLSearchParams(fields) })
  return res.status
}
const signedCallback = (id, extra = {}) => {
  const fields = { id, collection_id: 'col1', paid: 'true', state: 'paid', amount: String(bills[id].amount), paid_amount: String(bills[id].amount), paid_at: '2026-10-22 10:00:00 +0800', ...extra }
  return { ...fields, x_signature: signatureFor(fields) }
}

describe('the signature', () => {
  test('is computed from the sorted name+value pairs, ignoring case, and brackets are dropped', () => {
    const a = signatureFor({ 'billplz[id]': 'abc', 'billplz[paid]': 'true', 'billplz[paid_at]': 'X' }, 'k')
    const b = signatureFor({ 'billplz[paid_at]': 'X', 'billplz[id]': 'abc', 'billplz[paid]': 'true' }, 'k')
    expect(a).toBe(b) // the order the fields arrive in does not matter
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(signatureFor({ id: 'abc' }, 'k')).not.toBe(signatureFor({ id: 'abd' }, 'k'))
  })

  test('a wrong, missing or different-key signature is refused', () => {
    const good = redirectBody('b1', true)
    expect(signatureIsValid({ 'billplz[id]': 'b1', 'billplz[paid]': 'true', 'billplz[paid_at]': good.paid_at, 'billplz[x_signature]': good.x_signature })).toBe(true)
    expect(signatureIsValid({ 'billplz[id]': 'b1', 'billplz[paid]': 'false', 'billplz[paid_at]': good.paid_at, 'billplz[x_signature]': good.x_signature })).toBe(false)
    expect(signatureIsValid({ 'billplz[id]': 'b1', 'billplz[paid]': 'true' })).toBe(false)
    const forged = redirectBody('b1', true, 'someone-elses-key')
    expect(signatureIsValid({ 'billplz[id]': 'b1', 'billplz[paid]': 'true', 'billplz[paid_at]': forged.paid_at, 'billplz[x_signature]': forged.x_signature })).toBe(false)
  })
})

describe('checkout with Billplz', () => {
  test('creates a bill for the exact amount in cents and returns the Billplz page to open', async () => {
    const t = await makeTutor()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start: '16:00', status: 'AWAITING_PAYMENT', price: 33.33 })
    await prisma.booking.update({ where: { id: b.id }, data: { endAt: new Date(b.startAt.getTime() + 2 * 3600000) } })
    const res = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })
    expect(res.status).toBe(201)
    expect(res.redirectUrl).toMatch(/^https:\/\/billplz\.test\/bills\/bill\d+$/)
    const form = created.at(-1)
    expect(form.amount).toBe('6666') // RM 66.66
    expect(form.collection_id).toBe('col1')
    expect(form.email).toBe(parent.user.email)
    expect(form.callback_url).toContain('/api/payments/billplz/callback')
    expect(form.redirect_url).toContain('/parent/payments/return')
    const payment = await prisma.payment.findUnique({ where: { id: res.paymentId } })
    expect(payment.status).toBe('PENDING')
    expect(payment.gatewayRef).toBe(res.gatewayRef)
  })

  test('says so when the gateway is down, and nothing is charged', async () => {
    const t = await makeTutor()
    const b = await makeBooking({ parent: parent.parent, child: parent.child, tutor: t.tutor, date: monday, start: '18:00', status: 'AWAITING_PAYMENT' })
    const saved = global.fetch
    global.fetch = async (url, o) => (String(url).startsWith(BASE) ? new Response('{}', { status: 500 }) : realFetch(url, o))
    const res = await api(parent.token).post('/parent/payments/checkout', { bookingId: b.id })
    global.fetch = saved
    expect(res.status).toBe(502)
    expect(res.message).toContain('not been charged')
    expect((await prisma.booking.findUnique({ where: { id: b.id } })).status).toBe('AWAITING_PAYMENT')
  })

  test('the built-in test gateway is switched off while Billplz is in use', async () => {
    const { checkout } = await startPayment({ start: '19:00' })
    expect((await api(parent.token).post(`/parent/payments/${checkout.paymentId}/confirm`, { bank: 'Maybank2u', outcome: 'SUCCESS' })).status).toBe(404)
  })
})

describe('the parent coming back from Billplz', () => {
  test('paid: the payment is PAID, the booking CONFIRMED, and the commission is snapshotted', async () => {
    const { booking, checkout } = await startPayment({ price: 60, start: '17:00' })
    markPaid(checkout.gatewayRef)
    const res = await api(parent.token).post('/parent/payments/return', redirectBody(checkout.gatewayRef, true))
    expect(res.status).toBe(200)
    expect(res.outcome).toBe('SUCCESS')
    const payment = await prisma.payment.findUnique({ where: { id: checkout.paymentId } })
    expect(payment.status).toBe('PAID')
    expect(Number(payment.commissionAmount)).toBe(6)
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).status).toBe('CONFIRMED')
  })

  test('refreshing the page does not pay or confirm twice', async () => {
    const { checkout } = await startPayment({ start: '18:00' })
    markPaid(checkout.gatewayRef)
    await api(parent.token).post('/parent/payments/return', redirectBody(checkout.gatewayRef, true))
    const again = await api(parent.token).post('/parent/payments/return', redirectBody(checkout.gatewayRef, true))
    expect(again.status).toBe(200)
    expect(again.outcome).toBe('SUCCESS')
    expect(await prisma.notification.count({ where: { type: 'PAYMENT_SUCCESS', message: { contains: 'RM 60.00' } } })).toBeGreaterThan(0)
  })

  test('a made-up "paid" message is refused, and a bill Billplz says is unpaid does not confirm anything', async () => {
    const { booking, checkout } = await startPayment({ start: '19:00' })
    const forged = await api(parent.token).post('/parent/payments/return', redirectBody(checkout.gatewayRef, true, 'guessed-key'))
    expect(forged.status).toBe(400)
    // right signature but Billplz itself says the bill is not paid: we believe Billplz, not the address bar
    const unpaid = await api(parent.token).post('/parent/payments/return', redirectBody(checkout.gatewayRef, true))
    expect(unpaid.status).toBe(200)
    expect(unpaid.outcome).toBe('WAITING')
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).status).toBe('AWAITING_PAYMENT')
  })

  test("another parent cannot settle someone else's payment", async () => {
    const { checkout } = await startPayment({ start: '16:00' })
    markPaid(checkout.gatewayRef)
    expect((await api(other.token).post('/parent/payments/return', redirectBody(checkout.gatewayRef, true))).status).toBe(404)
  })

  test('a bill paid with a different amount is not accepted', async () => {
    const { booking, checkout } = await startPayment({ start: '17:00' })
    bills[checkout.gatewayRef].amount = 100
    markPaid(checkout.gatewayRef)
    const res = await api(parent.token).post('/parent/payments/return', redirectBody(checkout.gatewayRef, true))
    expect(res.status).toBe(400)
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).status).toBe('AWAITING_PAYMENT')
  })
})

describe("Billplz's server callback", () => {
  test('a correctly signed callback confirms the booking, even if the parent never came back', async () => {
    const { booking, checkout } = await startPayment({ start: '18:00' })
    markPaid(checkout.gatewayRef)
    expect(await callback(signedCallback(checkout.gatewayRef))).toBe(200)
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).status).toBe('CONFIRMED')
    // Billplz repeats callbacks: the second one changes nothing
    expect(await callback(signedCallback(checkout.gatewayRef))).toBe(200)
    expect(await prisma.payment.count({ where: { bookingId: booking.id, status: 'PAID' } })).toBe(1)
  })

  test('an unsigned or wrongly signed callback is refused and changes nothing', async () => {
    const { booking, checkout } = await startPayment({ start: '19:00' })
    markPaid(checkout.gatewayRef)
    const unsigned = { id: checkout.gatewayRef, paid: 'true' }
    expect(await callback(unsigned)).toBe(400)
    expect(await callback({ ...signedCallback(checkout.gatewayRef), paid: 'false' })).toBe(400) // fields changed after signing
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).status).toBe('AWAITING_PAYMENT')
  })

  test('a bill that is not ours is acknowledged and ignored', async () => {
    bills.other1 = { id: 'other1', amount: 100, paid: true, state: 'paid' }
    expect(await callback(signedCallback('other1'))).toBe(200)
  })
})

describe('paying after the booking is gone', () => {
  test('the money is kept on record and a full refund is queued for the Admin', async () => {
    const { booking, checkout } = await startPayment({ price: 50, start: '16:00' })
    await prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } })
    markPaid(checkout.gatewayRef)
    const res = await api(parent.token).post('/parent/payments/return', redirectBody(checkout.gatewayRef, true))
    expect(res.status).toBe(200)
    expect(res.outcome).toBe('LATE')
    expect((await prisma.booking.findUnique({ where: { id: booking.id } })).status).toBe('CANCELLED')
    const refund = await prisma.refund.findFirst({ where: { paymentId: checkout.paymentId } })
    expect(refund.type).toBe('AUTO')
    expect(refund.status).toBe('PENDING')
    expect(Number(refund.amount)).toBe(50)
  })
})
