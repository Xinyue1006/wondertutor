import bcrypt from 'bcrypt'
import { z } from 'zod'
import { AppError } from '../../utils/AppError.js'
import { issueOtp, checkOtp } from '../../services/otp.service.js'
import { earnings, changeBank, requestWithdrawal } from '../../services/earnings.service.js'

const details = z.object({
  bankName: z.string().trim().min(1, 'Enter the bank name').max(100),
  accountName: z.string().trim().min(1, 'Enter the account holder’s name').max(100),
  accountNumber: z.string().regex(/^\d{6,20}$/, 'Enter an account number of 6 to 20 digits'),
}).strict()

export async function dashboard(req, res) {
  res.json({ ...await earnings(req.tutor.id), bankAuth: req.user.passwordHash ? 'password' : 'code' })
}

export async function bankCode(req, res) {
  if (req.user.passwordHash) throw new AppError(400, 'Confirm with your password.')
  await issueOtp('bank:' + req.user.id, 'bank', req.user.email)
  res.json({ message: 'Check your email for the code.' })
}

export async function bank(req, res) {
  const input = z.object({ currentBankId: z.number().int().positive().nullable(), details: details.nullable(), confirmation: z.string().min(1).max(200) }).strict().parse(req.body)
  if (req.user.passwordHash) {
    if (!(await bcrypt.compare(input.confirmation, req.user.passwordHash))) throw new AppError(403, 'Incorrect password.')
  } else await checkOtp('bank:' + req.user.id, input.confirmation)
  await changeBank(req.tutor.id, input.currentBankId, input.details)
  res.json({ message: 'Bank details saved.' })
}

export async function withdraw(req, res) {
  const input = z.object({ bankId: z.number().int().positive(), version: z.string().regex(/^[0-9a-f]{64}$/),
    amount: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/, 'Enter an amount in RM with up to two decimal places').refine(v => Number(v) > 0, 'Enter an amount above zero'),
  }).strict().parse(req.body)
  res.status(201).json(await requestWithdrawal(req.tutor.id, input))
}
