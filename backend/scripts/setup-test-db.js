// Creates the separate test database (<name>_test) and applies all migrations to it.
// Integration tests run against this database so your real dev data is never touched.
// Runs automatically before `npm test` (see "pretest" in package.json).
import 'dotenv/config'
import { execSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import { testDatabaseUrl } from './setup-test-db-url.js'

const url = testDatabaseUrl(process.env.DATABASE_URL)
const dbName = new URL(url).pathname.slice(1)

// Connect to MySQL's built-in "mysql" schema just to issue CREATE DATABASE
const adminUrl = new URL(url)
adminUrl.pathname = '/mysql'
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } })
try {
  await admin.$executeRawUnsafe(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``)
} finally {
  await admin.$disconnect()
}

execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } })
console.log(`Test database "${dbName}" is ready.`)
