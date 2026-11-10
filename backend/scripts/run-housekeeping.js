// Finite cron entry point. Uses the configured DATABASE_URL: this is a real job,
// not a test/seed command. Hostinger must explicitly load the app's environment.
import 'dotenv/config'
import { createHash } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { prisma } from '../src/config/prisma.js'
import { runHousekeeping } from '../src/services/lifecycle.service.js'

const url = new URL(process.env.DATABASE_URL)
const lockName = `wondertutor:jobs:${createHash('sha256').update(url.pathname).digest('hex').slice(0, 32)}`
// MySQL advisory locks belong to a connection, so use a dedicated single-connection
// client and keep that connection for the entire job. Closing it releases the lock.
url.searchParams.set('connection_limit', '1')
const lockDb = new PrismaClient({ datasources: { db: { url: url.toString() } } })
let locked = false
try {
  const rows = await lockDb.$queryRaw`SELECT GET_LOCK(${lockName}, 0) AS acquired`
  locked = Number(rows[0]?.acquired) === 1
  if (!locked) console.log('[housekeeping] another run holds the lock; skipped')
  else console.log('[housekeeping]', JSON.stringify(await runHousekeeping()))
} catch {
  // Do not print connection URLs, SQL parameters or personal records to cron logs.
  console.error('[housekeeping] failed; check database connectivity and application configuration')
  process.exitCode = 1
} finally {
  try {
    if (locked) await lockDb.$queryRaw`SELECT RELEASE_LOCK(${lockName})`
  } catch { process.exitCode = 1 }
  await lockDb.$disconnect()
  await prisma.$disconnect()
}
