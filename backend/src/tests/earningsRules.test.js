// Earnings: commission rate, payment states, input checks, stale balances and email-code bank confirmation
import { prisma } from '../config/prisma.js'
import { api, makeBooking, makeParent, makeTutor, MONDAY, nextDate, resetDb, startServer, stopServer, testSession } from './helpers.js'
import { outbox } from '../services/email.service.js'

let parent
beforeAll(async () => { await resetDb(); await startServer(); parent = await makeParent() })
afterAll(stopServer)

const root = '/tutor/earnings'
const bank = { bankName: 'Test Bank', accountName: 'Test Tutor', accountNumber: '001234568901' }
let day = 0

async function tutor(options) {
  const t = await makeTutor(options)
  const client = api(t.token)
  const pay = async (status = 'COMPLETED', paymentStatus = 'PAID') => {
    // A new hour each time, so the bookings never overlap
    const b = await makeBooking({ tutor: t.tutor, parent: parent.parent, child: parent.child, date: nextDate(MONDAY), start: String(10 + (day++ % 12)).padStart(2, '0') + ':00', status })
    return prisma.payment.create({ data: { bookingId: b.id, amount: 100, commissionAmount: 10, commissionRate: 10, paidAt: new Date(), status: paymentStatus } })
  }
  const setBank = (details = bank, confirmation = 'Test1234', currentBankId = null) => client.put(root + '/bank', { currentBankId, details, confirmation })
  return { t, client, pay, setBank, get: () => client.get(root) }
}
const codeSentTo = (email) => [...outbox].reverse().find((m) => m.to === email)?.html.match(/<b[^>]*>(\d{6})<\/b>/)?.[1]

describe('balances', () => {
  test('a tutor with no custom rate uses the platform base rate', async () => {
    const { get } = await tutor()
    const view = await get()
    expect(Number(view.rate)).toBe(10)
    expect(Number(view.baseRate)).toBe(10)
  })

  test('a new tutor starts at zero with no bank, transactions or withdrawals', async () => {
    const view = await (await tutor()).get()
    expect(Number(view.available)).toBe(0)
    expect(Number(view.totalEarned)).toBe(0)
    expect(view.bank).toBeNull()
    expect(view.transactions).toEqual([])
    expect(view.withdrawals).toEqual([])
    expect(view.bankAuth).toBe('password')
  })

  test('a paid lesson that was later cancelled earns nothing and shows as cancelled', async () => {
    const { pay, get } = await tutor()
    const p = await pay('CANCELLED')
    const view = await get()
    const row = view.transactions.find((r) => r.id === p.id)
    expect(row.state).toBe('Cancelled')
    expect(Number(row.net)).toBe(0)
    expect(Number(view.totalEarned)).toBe(0)
  })

  test('a lesson with a refund still under review is not available yet', async () => {
    const { pay, get } = await tutor()
    const p = await pay()
    await prisma.refund.create({ data: { paymentId: p.id, type: 'ADMIN_REVIEW', amount: 20, reason: 'Check', status: 'PENDING' } })
    const view = await get()
    expect(view.transactions[0].state).toBe('Under review')
    expect(Number(view.available)).toBe(0)
  })

  test('an unpaid payment is not listed at all', async () => {
    const { pay, get } = await tutor()
    await pay('COMPLETED', 'PENDING')
    expect((await get()).transactions).toEqual([])
  })
})

describe('withdrawal checks', () => {
  test('refuses a withdrawal from a balance that changed since the page loaded', async () => {
    const { pay, get, setBank, client } = await tutor()
    await setBank()
    await pay()
    const old = await get()
    await pay()
    const res = await client.post(root + '/withdrawals', { bankId: old.bank.id, version: old.version, amount: '10' })
    expect(res.status).toBe(409)
    expect(res.message).toMatch(/balance changed/)
  })

  test('refuses zero, negative and badly written amounts', async () => {
    const { pay, get, setBank, client } = await tutor()
    await setBank()
    await pay()
    const view = await get()
    for (const amount of ['0', '0.00', '-5', 'ten', '1.234', ''])
      expect((await client.post(root + '/withdrawals', { bankId: view.bank.id, version: view.version, amount })).status).toBe(400)
  })

  test('refuses a withdrawal to an old bank account after it was replaced', async () => {
    const { pay, get, setBank, client } = await tutor()
    await setBank()
    await pay()
    const old = await get()
    await setBank({ ...bank, accountNumber: '5566778899' }, 'Test1234', old.bank.id)
    const latest = await get()
    expect((await client.post(root + '/withdrawals', { bankId: old.bank.id, version: latest.version, amount: '10' })).status).toBe(409)
  })

  test('the full balance can be withdrawn and nothing is left after', async () => {
    const { pay, get, setBank, client } = await tutor()
    await setBank()
    await pay()
    const view = await get()
    expect((await client.post(root + '/withdrawals', { bankId: view.bank.id, version: view.version, amount: '90' })).status).toBe(201)
    const after = await get()
    expect(Number(after.available)).toBe(0)
    expect(after.withdrawals[0]).toMatchObject({ status: 'PENDING' })
  })
})

describe('bank account', () => {
  test('refuses account numbers that are too short, too long or not digits', async () => {
    const { setBank } = await tutor()
    for (const accountNumber of ['12345', '1'.repeat(21), '12345abc', '1234 5678'])
      expect((await setBank({ ...bank, accountNumber })).status).toBe(400)
  })

  test('refuses an empty bank name or account holder', async () => {
    const { setBank } = await tutor()
    expect((await setBank({ ...bank, bankName: '  ' })).status).toBe(400)
    expect((await setBank({ ...bank, accountName: '' })).status).toBe(400)
  })

  test('refuses unknown extra fields', async () => {
    const { setBank } = await tutor()
    expect((await setBank({ ...bank, isDefault: false })).status).toBe(400)
  })

  test('removing the account leaves no bank to withdraw to', async () => {
    const { setBank, get } = await tutor()
    await setBank()
    const view = await get()
    expect((await setBank(null, 'Test1234', view.bank.id)).status).toBe(200)
    expect((await get()).bank).toBeNull()
  })

  test('a tutor with a password cannot ask for an email code', async () => {
    const { client } = await tutor()
    expect((await client.post(root + '/bank-code')).status).toBe(400)
  })

  test('a Google sign-in tutor confirms bank changes with an emailed code', async () => {
    const { t } = await tutor()
    // Clearing the password ends old sessions, so sign in again as a Google account would
    const user = await prisma.user.update({ where: { id: t.user.id }, data: { passwordHash: null } })
    const client = api(await testSession(user))
    const get = () => client.get(root)
    const setBank = (details, confirmation, currentBankId = null) => client.put(root + '/bank', { currentBankId, details, confirmation })
    expect((await get()).bankAuth).toBe('code')
    expect((await client.post(root + '/bank-code')).status).toBe(200)
    const code = codeSentTo(t.user.email)
    expect(code).toMatch(/^\d{6}$/)
    const wrong = code === '000000' ? '111111' : '000000'
    expect((await setBank(bank, wrong)).status).toBe(400)
    expect((await get()).bank).toBeNull()
    expect((await setBank(bank, code)).status).toBe(200)
    expect((await get()).bank.lastFour).toBe('8901')
    // A used code cannot be used again
    expect((await setBank(null, code, (await get()).bank.id)).status).toBe(400)
  })
})
