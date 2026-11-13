import { Prisma } from '@prisma/client'
import { createHash } from 'node:crypto'
import { prisma } from '../config/prisma.js'
import { AppError } from '../utils/AppError.js'
import { baseCommission } from './systemSettings.service.js'
import { renderEmail } from './notification.service.js'
import { sendEmail } from './email.service.js'

const zero = new Prisma.Decimal(0)
const holding = ['PENDING', 'ESCALATED']
const bankView = b => b && ({ id: b.id, bankName: b.bankName, accountName: b.accountName, lastFour: b.accountNumber.slice(-4) })
const lockTutor = (db, tutorId) => db.$queryRaw`SELECT id FROM TutorProfile WHERE id = ${tutorId} FOR UPDATE`

async function ledger(db, tutorId) {
  const payments = await db.payment.findMany({
    where: { booking: { tutorId }, status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } },
    include: { booking: { select: { id: true, subject: true, status: true, startAt: true, child: { select: { name: true } } } },
      refunds: { select: { amount: true, status: true, issuedAt: true, reviewNote: true } } }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
  })
  const withdrawals = await db.withdrawal.findMany({ where: { tutorId }, include: { bankAccount: true }, orderBy: { id: 'desc' } })
  let earned = zero, pending = zero, held = zero, paidOut = zero
  const transactions = payments.map(p => {
    const b = p.booking
    let commission = p.commissionAmount
    let fee = p.amount
    const refunded = p.refunds.filter(r => r.status === 'APPROVED' && (r.issuedAt || (!r.reviewNote && p.status !== 'PAID'))).reduce((sum, r) => sum.plus(r.amount), zero)
    const refundInReview = p.refunds.some(r => ['PENDING', 'ESCALATED'].includes(r.status) || (r.status === 'APPROVED' && r.reviewNote && !r.issuedAt))
    if (p.status === 'PARTIALLY_REFUNDED' && refunded.gt(0) && fee.gt(0)) {
      fee = Prisma.Decimal.max(0, fee.minus(refunded))
      // Round the retained platform share once; the tutor receives the remaining sen.
      commission = p.commissionAmount.mul(fee).div(p.amount).toDecimalPlaces(2)
    }
    let net = fee.minus(commission)
    let state = 'Under review'
    if (p.status === 'REFUNDED' || b.status === 'CANCELLED') {
      state = p.status === 'REFUNDED' ? 'Refunded' : 'Cancelled'
      net = zero
    } else if (!refundInReview &&
        ((p.status === 'PAID' && refunded.isZero()) || (p.status === 'PARTIALLY_REFUNDED' && refunded.gt(0)))) {
      if (b.status === 'COMPLETED') { state = 'Earned'; earned = earned.plus(net) }
      if (b.status === 'CONFIRMED') { state = 'Report due'; pending = pending.plus(net) }
    }
    return { id: p.id, bookingId: b.id, date: p.paidAt || p.createdAt, subject: b.subject, student: b.child.name,
      fee: p.amount, originalCommission: p.commissionAmount, commission: p.status === 'REFUNDED' ? zero : commission,
      refunded: p.status === 'REFUNDED' ? p.amount : refunded, rate: p.commissionRate, net, state }
  })
  for (const w of withdrawals) {
    if (holding.includes(w.status)) held = held.plus(w.amount)
    if (w.status === 'APPROVED') paidOut = paidOut.plus(w.amount)
  }
  const balance = earned.minus(held).minus(paidOut)
  // A repeat submission from the same displayed balance must not reserve a second amount.
  const version = createHash('sha256').update([balance, withdrawals[0]?.id || 0, held, paidOut].join('|')).digest('hex')
  return { transactions, withdrawals, earned, pending, held, paidOut, balance, version }
}

export function earnings(tutorId) {
  return prisma.$transaction(async db => {
    const l = await ledger(db, tutorId)
    const bank = await db.bankAccount.findFirst({ where: { tutorId, isDefault: true } })
    const tutor = await db.tutorProfile.findUniqueOrThrow({ where: { id: tutorId }, select: { commissionRate: true } })
    const base = await baseCommission(db)
    return { available: Prisma.Decimal.max(l.balance, 0), totalEarned: l.earned, pending: l.pending, held: l.held, withdrawn: l.paidOut,
      version: l.version, rate: tutor.commissionRate ?? base, baseRate: base, bank: bankView(bank), transactions: l.transactions,
      withdrawals: l.withdrawals.map(w => ({ id: w.id, date: w.createdAt, reviewedAt: w.reviewedAt, amount: w.amount, status: w.status, reason: w.rejectReason, bank: bankView(w.bankAccount) })) }
  })
}

export function changeBank(tutorId, expectedBank, details) {
  return prisma.$transaction(async db => {
    await lockTutor(db, tutorId)
    const old = await db.bankAccount.findFirst({ where: { tutorId, isDefault: true } })
    if ((old?.id ?? null) !== expectedBank) throw new AppError(409, 'Bank details changed. Refresh and try again.')
    if (old) {
      // Keep the original destination attached to past and pending requests.
      await db.bankAccount.update({ where: { id: old.id }, data: { isDefault: false } })
      await db.withdrawal.updateMany({ where: { tutorId, status: 'PENDING' }, data: { status: 'ESCALATED' } })
    }
    if (details) await db.bankAccount.create({ data: { tutorId, ...details, isDefault: true } })
  })
}

export function requestWithdrawal(tutorId, input) {
  return prisma.$transaction(async db => {
    // Always take the tutor lock before reading the balance, including on admin decisions.
    await lockTutor(db, tutorId)
    const bank = await db.bankAccount.findFirst({ where: { id: input.bankId, tutorId, isDefault: true } })
    if (!bank) throw new AppError(409, 'Choose your current bank account and try again.')
    const l = await ledger(db, tutorId)
    if (input.version !== l.version) throw new AppError(409, 'Your balance changed. Refresh and check your withdrawal history.')
    const amount = new Prisma.Decimal(input.amount)
    if (amount.gt(l.balance)) throw new AppError(400, 'The amount exceeds your available balance.')
    return db.withdrawal.create({ data: { tutorId, bankAccountId: bank.id, amount }, select: { id: true } })
  })
}

export async function pendingReviews() {
  const rows = await prisma.withdrawal.findMany({ where: { status: { in: holding } }, orderBy: { id: 'asc' },
    include: { bankAccount: true, tutor: { select: { user: { select: { fullName: true } } } } } })
  return rows.map(w => ({ id: w.id, tutor: w.tutor.user.fullName, date: w.createdAt, amount: w.amount, status: w.status, bank: bankView(w.bankAccount) }))
}

export async function reviewWithdrawal(id, adminId, decision) {
  const w = await prisma.withdrawal.findUnique({ where: { id }, select: { tutorId: true } })
  if (!w) throw new AppError(404, 'Withdrawal not found')
  const result = await prisma.$transaction(async db => {
    await lockTutor(db, w.tutorId)
    const row = await db.withdrawal.findUniqueOrThrow({ where: { id }, include: { tutor: { include: { user: true } }, bankAccount: true } })
    if (!holding.includes(row.status) || decision.expectedStatus !== row.status) throw new AppError(409, 'This request changed. Refresh before reviewing it.')
    if (decision.status === 'APPROVED' && (await ledger(db, w.tutorId)).balance.lt(0)) throw new AppError(409, 'The earned balance no longer covers the held funds.')
    await db.withdrawal.update({ where: { id }, data: { status: decision.status, rejectReason: decision.reason ?? null, reviewedById: adminId, reviewedAt: new Date() } })
    const title = decision.status === 'APPROVED' ? 'Withdrawal approved' : 'Withdrawal rejected'
    const message = 'Your RM ' + row.amount.toFixed(2) + ' request to ' + row.bankAccount.bankName + ' ending ' + row.bankAccount.accountNumber.slice(-4) +
      (decision.status === 'APPROVED' ? ' was approved.' : ' was rejected. Reason: ' + decision.reason)
    const link = '/tutor/earnings'
    await db.notification.create({ data: { userId: row.tutor.userId, type: 'WITHDRAWAL_' + decision.status, title, message, link } })
    return { user: row.tutor.user, title, message, link }
  })
  try { await sendEmail({ to: result.user.email, subject: 'WonderTutor — ' + result.title, html: renderEmail({ ...result, name: result.user.fullName }) }) }
  catch { console.error('Withdrawal decision email could not be delivered') }
}
