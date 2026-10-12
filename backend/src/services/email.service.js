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

export async function sendEmail({ to, subject, html }) {
  if (!transporter) {
    console.log(`\n📧 [DEV EMAIL] To: ${to}\n   Subject: ${subject}\n   ${html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`)
    return
  }
  await transporter.sendMail({ from: env.smtp.from, to, subject, html })
}
