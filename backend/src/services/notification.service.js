// In-app notifications for everything; email only for record-worthy events (payment, confirmation, refunds).
import { prisma } from '../config/prisma.js'
import { sendEmail } from './email.service.js'

export async function notify(userId, { type, title, message, link }) {
  return prisma.notification.create({ data: { userId, type, title, message, link } })
}

// Names and messages contain text people typed, so they are escaped before going into the email's HTML
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// Email failures must never break the main action (e.g. payment already succeeded)
export async function notifyWithEmail(user, payload) {
  await notify(user.id, payload)
  try {
    await sendEmail({
      to: user.email,
      subject: `WonderTutor — ${payload.title}`,
      html: `<p>Hi ${escapeHtml(user.fullName)},</p><p>${escapeHtml(payload.message)}</p><p>— WonderTutor</p>`,
    })
  } catch (err) {
    console.error('Email failed:', err.message)
  }
}
