import 'dotenv/config'

function required(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name} (see .env.example)`)
  return v
}

export const env = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || 'WonderTutor <no-reply@wondertutor.local>',
  },
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  recaptchaSecret: process.env.RECAPTCHA_SECRET,
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
}

export const isDev = env.nodeEnv !== 'production'

// A live site must not start with settings that make it easy to break into. A weak JWT secret lets anybody forge a login
// for any account, including the admin, so that one stops the server. The rest are warnings.
export function productionProblems(e) {
  const stop = []
  const warn = []
  if (!e.jwtSecret || e.jwtSecret.length < 32 || /change-?me|secret|password|123456/i.test(e.jwtSecret)) {
    stop.push('JWT_SECRET must be a long random value (at least 32 characters, and not a word like "secret" or "change-me")')
  }
  if (!e.smtp.user) warn.push('SMTP_USER is empty, so no email (sign-up codes, receipts) can be sent')
  if (/localhost|127\.0\.0\.1/.test(e.clientUrl)) warn.push('CLIENT_URL is still localhost: set it to the live address (it is used in email and calendar links)')
  return { stop, warn }
}
if (env.nodeEnv === 'production') {
  const { stop, warn } = productionProblems(env)
  for (const w of warn) console.warn(`[settings] ${w}`)
  if (stop.length) throw new Error(`Unsafe production settings:\n- ${stop.join('\n- ')}`)
}
