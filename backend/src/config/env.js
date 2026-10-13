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
