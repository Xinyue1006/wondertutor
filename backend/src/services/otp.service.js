import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import { prisma } from '../config/prisma.js'
import { sendEmail } from './email.service.js'
import { AppError } from '../utils/AppError.js'

const OTP_TTL_MINUTES = 10
const MAX_ATTEMPTS = 5
const RESEND_COOLDOWN_SECONDS = 60

const PURPOSE_TEXT = {
  verify: { subject: 'Your WonderTutor verification code', note: "If you didn't sign up, ignore this email." },
  reset: { subject: 'Reset your WonderTutor password', note: "If you didn't ask to reset your password, ignore this email. Your password stays the same." },
}

export async function issueOtp(email, purpose = 'verify') {
  const latest = await prisma.emailOtp.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } })
  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000) {
    throw new AppError(429, `Please wait ${RESEND_COOLDOWN_SECONDS} seconds before requesting another code`)
  }

  const code = crypto.randomInt(100000, 1000000).toString()
  await prisma.emailOtp.deleteMany({ where: { email } })
  await prisma.emailOtp.create({
    data: {
      email,
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
    },
  })

  const text = PURPOSE_TEXT[purpose] || PURPOSE_TEXT.verify
  await sendEmail({
    to: email,
    subject: text.subject,
    html: `<p>Your code is <b style="font-size:20px">${code}</b>.</p>
           <p>It expires in ${OTP_TTL_MINUTES} minutes. ${text.note}</p>`,
  })
}

export async function checkOtp(email, code) {
  const otp = await prisma.emailOtp.findFirst({ where: { email }, orderBy: { createdAt: 'desc' } })
  if (!otp || otp.expiresAt < new Date()) throw new AppError(400, 'Code expired, please request a new one')
  if (otp.attempts >= MAX_ATTEMPTS) throw new AppError(429, 'Too many attempts, please request a new code')

  const ok = await bcrypt.compare(code, otp.codeHash)
  if (!ok) {
    await prisma.emailOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } })
    throw new AppError(400, 'Incorrect code')
  }
  await prisma.emailOtp.deleteMany({ where: { email } })
}
