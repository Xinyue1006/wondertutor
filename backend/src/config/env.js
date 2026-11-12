import 'dotenv/config'

function required(name) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name} (see .env.example)`)
  return v
}

const intIn = (raw, def, min, max, name, problems) => {
  if (raw === undefined || raw === '') return def
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be a whole number between ${min} and ${max}`)
    return def
  }
  return n
}

// AI assistant settings. Exported so tests can check the validation without restarting the process.
export function readAiConfig(e) {
  const problems = []
  const enabled = String(e.AI_ASSISTANT_ENABLED || '').toLowerCase() === 'true'
  const cfg = {
    enabled,
    apiKey: e.GEMINI_API_KEY || '',
    model: (e.GEMINI_MODEL || '').trim(),
    baseUrl: e.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
    timeoutMs: intIn(e.AI_REQUEST_TIMEOUT_MS, 60000, 1000, 120000, 'AI_REQUEST_TIMEOUT_MS', problems),
    maxToolRounds: intIn(e.AI_MAX_TOOL_ROUNDS, 4, 1, 8, 'AI_MAX_TOOL_ROUNDS', problems),
    maxToolCalls: intIn(e.AI_MAX_TOOL_CALLS, 8, 1, 20, 'AI_MAX_TOOL_CALLS', problems),
    conversationTtlMs: intIn(e.AI_CONVERSATION_TTL_MS, 1800000, 60000, 86400000, 'AI_CONVERSATION_TTL_MS', problems),
    maxTurns: intIn(e.AI_MAX_TURNS, 20, 2, 100, 'AI_MAX_TURNS', problems),
    maxConversationsPerUser: intIn(e.AI_MAX_CONVERSATIONS_PER_USER, 5, 1, 50, 'AI_MAX_CONVERSATIONS_PER_USER', problems),
    maxConversations: intIn(e.AI_MAX_CONVERSATIONS, 1000, 10, 100000, 'AI_MAX_CONVERSATIONS', problems),
    messagesPerMinute: intIn(e.AI_MESSAGES_PER_MINUTE, 10, 1, 120, 'AI_MESSAGES_PER_MINUTE', problems),
    maxOutputTokens: intIn(e.AI_MAX_OUTPUT_TOKENS, 800, 64, 8192, 'AI_MAX_OUTPUT_TOKENS', problems),
  }
  // Only an ENABLED assistant with a broken configuration stops the server; disabled mode always starts.
  if (enabled) {
    if (!cfg.apiKey) problems.push('GEMINI_API_KEY is required when AI_ASSISTANT_ENABLED=true')
    if (!cfg.model) problems.push('GEMINI_MODEL is required when AI_ASSISTANT_ENABLED=true (use a model name from the current Gemini documentation)')
  }
  if (enabled && problems.length) throw new Error(`Invalid AI assistant settings:\n- ${problems.join('\n- ')}`)
  return cfg
}

export const env = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d', // legacy JWT test utility only; browser session lifetimes are defined in session.service.js
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || 'WonderTutor <no-reply@wondertutor.local>',
  },
  googleClientId: process.env.GOOGLE_CLIENT_ID,
  recaptchaSecret: process.env.RECAPTCHA_SECRET,
  // Payment gateway. Without BILLPLZ_API_KEY the built-in test gateway is used instead (development and automated tests).
  billplz: {
    apiKey: process.env.BILLPLZ_API_KEY,
    collectionId: process.env.BILLPLZ_COLLECTION_ID,
    xSignature: process.env.BILLPLZ_X_SIGNATURE,
    baseUrl: process.env.BILLPLZ_BASE_URL || 'https://www.billplz-sandbox.com/api',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  // Read-only AI assistant (Gemini). Off unless AI_ASSISTANT_ENABLED=true; disabled mode needs no key.
  ai: readAiConfig(process.env),
}

export const isDev = env.nodeEnv !== 'production'

// A live site must not start with settings that make it easy to break into. This
// server-only secret protects session credential binding and CSRF proofs.
export function productionProblems(e) {
  const stop = []
  const warn = []
  if (!e.jwtSecret || e.jwtSecret.length < 32 || /change-?me|secret|password|123456/i.test(e.jwtSecret)) {
    stop.push('JWT_SECRET must be a long random value (at least 32 characters, and not a word like "secret" or "change-me")')
  }
  if (e.billplz?.apiKey && !e.billplz.xSignature) {
    stop.push('BILLPLZ_X_SIGNATURE is missing: without it a forged "payment complete" message could not be detected')
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
