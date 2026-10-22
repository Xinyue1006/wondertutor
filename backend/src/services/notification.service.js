// In-app notifications for everything; email only for record-worthy events (payment, confirmation, refunds)
// and for reminders (which the person can switch off in My Profile).
import { prisma } from '../config/prisma.js'
import { env } from '../config/env.js'
import { sendEmail } from './email.service.js'

export async function notify(userId, { type, title, message, link }) {
  return prisma.notification.create({ data: { userId, type, title, message, link } })
}

// Names and messages contain text people typed, so they are escaped before going into the email's HTML
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// The email body: greeting, the message, a button to the page it is about, and an optional small note at the bottom
export function renderEmail({ name, message, link, note }) {
  const url = link ? `${env.clientUrl}${link}` : null
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#0b2a6f;line-height:1.5">
<p>Hi ${escapeHtml(name)},</p>
<p>${escapeHtml(message)}</p>
${url ? `<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#1a6dff;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">Open in WonderTutor</a></p>` : ''}
<p>— WonderTutor</p>
${note ? `<p style="font-size:12px;color:#5b6b8c">${escapeHtml(note)}</p>` : ''}
</div>`
}

// Email failures must never break the main action (e.g. payment already succeeded)
export async function notifyWithEmail(user, payload, { note } = {}) {
  await notify(user.id, payload)
  try {
    await sendEmail({
      to: user.email,
      subject: `WonderTutor — ${payload.title}`,
      html: renderEmail({ name: user.fullName, message: payload.message, link: payload.link, note }),
    })
  } catch (err) {
    console.error('Email failed:', err.message)
  }
}
