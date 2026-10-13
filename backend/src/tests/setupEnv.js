// Jest setup (runs before every test file): point Prisma at the TEST database and set the secrets the app needs.
// dotenv never overrides variables that are already set, so this wins over backend/.env.
import 'dotenv/config'
import { testDatabaseUrl } from '../../scripts/setup-test-db-url.js'

process.env.DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL)
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'
process.env.NODE_ENV = 'test'
// Never send real emails / hit reCAPTCHA from tests
process.env.SMTP_USER = ''
process.env.RECAPTCHA_SECRET = ''
process.env.GOOGLE_CLIENT_ID = ''
