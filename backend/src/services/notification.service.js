// In-app notifications for everything; email only for record-worthy events (payment, confirmation, refunds).
import { prisma } from '../config/prisma.js'
import { sendEmail } from './email.service.js'

export async function notify(userId, { type, title, message, link }) {
  return prisma.notification.create({ data: { userId, type, title, message, link } })
}

// Email failures must never break the main action (e.g. payment already succeeded)
export async function notifyWithEmail(user, payload) {
  await notify(user.id, payload)
  try {
    await sendEmail({
      to: user.email,
      subject: `WonderTutor — ${payload.title}`,
      html: `<p>Hi ${user.fullName},</p><p>${payload.message}</p><p>— WonderTutor</p>`,
    })
  } catch (err) {
    console.error('Email failed:', err.message)
  }
}
