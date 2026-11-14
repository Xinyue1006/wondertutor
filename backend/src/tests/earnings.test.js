import { prisma } from '../config/prisma.js'
import { api, startServer, stopServer, resetDb, makeParent, makeTutor, makeAdmin, makeBooking, MONDAY, nextDate } from './helpers.js'
import { outbox } from '../services/email.service.js'

let parent, admin
beforeAll(async () => { await resetDb(); await startServer(); parent = await makeParent(); admin = api((await makeAdmin()).token) })
afterAll(stopServer)
const root = '/tutor/earnings'
async function setup() {
  const t = await makeTutor({ commissionRate: 19 })
  const client = api(t.token)
  const bank = { bankName: 'Test Bank', accountName: 'Test Tutor', accountNumber: '001234568901' }
  const change = (currentBankId, details, confirmation = 'Test1234') => client.put(root + '/bank', { currentBankId, details, confirmation })
  expect((await change(null, bank)).status).toBe(200)
  const get = () => client.get(root)
  async function pay(status = 'COMPLETED', paymentStatus = 'PAID') {
    const b = await makeBooking({ tutor: t.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), status })
    return prisma.payment.create({ data: { bookingId: b.id, amount: 100, commissionAmount: 12, commissionRate: 12, paidAt: new Date(), status: paymentStatus } })
  }
  const request = (view, amount) => client.post(root + '/withdrawals', { bankId: view.bank.id, version: view.version, amount })
  return { t, client, bank, change, get, pay, request }
}

test('completed lessons use the historical fee; current rate, refunds and pending reports are separate', async () => {
  const { pay, get } = await setup()
  await pay()
  await pay('CONFIRMED')
  const partial = await pay('COMPLETED', 'PARTIALLY_REFUNDED')
  await prisma.refund.create({ data: { paymentId: partial.id, type: 'ADMIN_REVIEW', amount: 33.33, reason: 'Adjustment', status: 'APPROVED' } })
  await pay('COMPLETED', 'REFUNDED')
  const v = await get()
  expect(Number(v.rate)).toBe(19)
  expect(Number(v.totalEarned)).toBe(146.67)
  expect(Number(v.available)).toBe(146.67)
  expect(Number(v.pending)).toBe(88)
  const row = v.transactions.find(r => r.id === partial.id)
  expect(Number(row.commission)).toBe(8)
  expect(Number(row.originalCommission)).toBe(12)
  expect(Number(row.originalShare)).toBe(88)
  expect(Number(row.platformRefundShare)).toBe(4)
  expect(Number(row.tutorRefundShare)).toBe(29.33)
  expect(Number(row.net)).toBe(58.67)
  expect(v.transactions).toHaveLength(4)
})

test('two simultaneous withdrawals reserve only once, even when both individually fit', async () => {
  const { get, request, pay } = await setup()
  await pay()
  const before = await get()
  const attempts = await Promise.all([request(before, '30.01'), request(before, '30.01')])
  expect(attempts.map(r => r.status).sort()).toEqual([201, 409])
  const held = await get()
  expect(Number(held.held)).toBe(30.01)
  expect(Number(held.available)).toBe(57.99)
  expect((await request(held, '58')).status).toBe(400)
  expect((await request(held, '0.01')).status).toBe(201)
  expect((await request(await get(), '0.001')).status).toBe(400)
})

test('bank edits preserve the payout destination; rejection releases the hold and notifies once', async () => {
  const { t, client, bank, change, get, request, pay } = await setup()
  await pay()
  const old = await get()
  const w = await request(old, '88')
  const path = '/admin/withdrawals/' + w.id + '/review'
  const approve = { status: 'APPROVED', expectedStatus: 'PENDING' }
  expect((await client.post(path, approve)).status).toBe(403)
  expect((await change(old.bank.id, bank, 'wrong')).status).toBe(403)
  expect((await change(old.bank.id, { ...bank, accountNumber: '9988776655' })).status).toBe(200)
  const changed = await get()
  expect(changed.bank.lastFour).toBe('6655')
  expect(changed.withdrawals[0].bank.lastFour).toBe('8901')
  expect(JSON.stringify(changed)).not.toContain(bank.accountNumber)
  expect(Number(changed.available)).toBe(0)
  expect((await admin.post(path, approve)).status).toBe(409)
  const reject = { status: 'REJECTED', expectedStatus: 'ESCALATED', reason: 'Please confirm the account holder.' }
  expect((await admin.post(path, { ...reject, reason: ' ' })).status).toBe(400)
  expect((await admin.post(path, reject)).status).toBe(200)
  expect((await admin.post(path, reject)).status).toBe(409)
  const released = await get()
  expect(Number(released.available)).toBe(88)
  expect(released.withdrawals[0].reason).toBe(reject.reason)
  expect(await prisma.notification.count({ where: { userId: t.user.id, type: 'WITHDRAWAL_REJECTED' } })).toBe(1)
  expect(outbox.some(m => m.to === t.user.email && m.html.includes(reject.reason))).toBe(true)
  const newRequest = await request(released, '88')
  expect((await admin.post('/admin/withdrawals/' + newRequest.id + '/review', approve)).status).toBe(200)
  const approved = await get()
  expect(Number(approved.held)).toBe(0)
  expect(Number(approved.withdrawn)).toBe(88)
  expect(Number(approved.available)).toBe(0)
})

test('only tutors access earnings and withdrawal destinations are scoped to the tutor', async () => {
  const a = await setup(), b = await setup()
  const mine = await a.get(), other = await b.get()
  expect((await api().get(root)).status).toBe(401)
  expect((await api(parent.token).get(root)).status).toBe(403)
  expect((await a.request({ ...mine, bank: other.bank }, '0.01')).status).toBe(409)
  expect((await a.change(other.bank.id, null)).status).toBe(409)
})
