import nodemailer from 'nodemailer'
import { env } from '../config/env.js'

// If SMTP isn't configured (dev), emails are printed to the console instead of sent
const transporter = env.smtp.user
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
    })
  : null

// In tests every email that would have been sent is kept here, so a test can check who got what
export const outbox = []

export async function sendEmail({ to, subject, html }) {
  if (process.env.NODE_ENV === 'test') outbox.push({ to, subject, html })
  if (!transporter) {
    // Only on a developer's computer are emails printed instead of sent. On a live site that would write sign-up and reset
    // codes into the server log, so it fails instead (the callers already treat a failed send as "email not sent").
    if (process.env.NODE_ENV === 'production') throw new Error('Email is not set up (SMTP_USER is empty), so nothing was sent')
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    console.log(`\n📧 [DEV EMAIL] To: ${to}\n   Subject: ${subject}\n   ${text}\n`)
    return
  }
  await transporter.sendMail({ from: env.smtp.from, to, subject, html })
}
