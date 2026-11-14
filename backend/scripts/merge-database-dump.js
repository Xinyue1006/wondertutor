// Local development data merge. The supplied SQL is parsed as data, never executed.
// Default: write a private preview only. --apply also creates a full SQL backup.
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { parseSqlDump } from '../src/services/databaseMerge/sqlDump.js'
import { planDatabaseMerge } from '../src/services/databaseMerge/plan.js'
import { applyDatabaseMerge, readDatabaseSnapshot, snapshotFingerprint } from '../src/services/databaseMerge/apply.js'

function options(args) {
  const result = { apply: false }
  for (let index = 0; index < args.length; index++) {
    const key = args[index]
    if (key === '--apply') result.apply = true
    else if (key === '--source' || key === '--target-db' || key === '--report-dir' || key === '--mysql-bin') {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + key)
      result[key.slice(2)] = value
    } else throw new Error('Unknown argument: ' + key)
  }
  if (!result.source || !result['target-db']) throw new Error('Usage: npm run db:merge -- --source path.sql --target-db database_name [--apply] [--report-dir private_folder] [--mysql-bin folder]')
  return result
}
const settings = options(process.argv.slice(2))
const url = new URL(process.env.DATABASE_URL)
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('This merge command only supports a local, non-production development database')
const database = url.pathname.slice(1)
if (database !== settings['target-db'] || !/^[A-Za-z0-9_]+$/.test(database)) throw new Error('The explicit target database does not match DATABASE_URL')
const sourceBytes = fs.readFileSync(path.resolve(settings.source))
const parsed = parseSqlDump(sourceBytes.toString('utf8'))
if (parsed.metadata.unsupportedStatements.length) throw new Error('The export contains unsupported SQL statements; nothing has been imported')
const stamp = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replace(/[^0-9]/g, '')
const directory = path.resolve(settings['report-dir'] || path.join(os.homedir(), '.wondertutor', 'database-merges', stamp))
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const relativeToRepo = path.relative(repository, directory)
if (!relativeToRepo.startsWith('..' + path.sep) && relativeToRepo !== '..' && !path.isAbsolute(relativeToRepo)) throw new Error('Backups and reports must be kept outside the repository')
fs.mkdirSync(directory, { recursive: true })
const db = new PrismaClient()
let backup
let committedResult
try {
  const before = await readDatabaseSnapshot(db)
  const now = new Date()
  const plan = planDatabaseMerge({ source: parsed.tables, target: before, now })
  const preview = { mode: settings.apply ? 'apply' : 'preview', database, sourceSha256: createHash('sha256').update(sourceBytes).digest('hex'), fingerprintBefore: snapshotFingerprint(before), report: plan.report, inserts: plan.inserts.length, derivedUpdates: plan.updates.length }
  fs.writeFileSync(path.join(directory, 'merge-preview.json'), JSON.stringify(preview, null, 2))
  if (settings.apply) {
    const binary = settings['mysql-bin'] ? path.join(settings['mysql-bin'], process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump') : process.platform === 'win32' && fs.existsSync('C:/xampp/mysql/bin/mysqldump.exe') ? 'C:/xampp/mysql/bin/mysqldump.exe' : 'mysqldump'
    const bytes = execFileSync(binary, ['--host=' + url.hostname, '--port=' + (url.port || '3306'), '--user=' + decodeURIComponent(url.username), '--single-transaction', '--skip-lock-tables', '--hex-blob', database], { env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) }, maxBuffer: 256 * 1024 * 1024 })
    backup = path.join(directory, 'before-merge-' + stamp + '.sql')
    fs.writeFileSync(backup, bytes, { flag: 'wx' })
    fs.writeFileSync(path.join(directory, 'backup-integrity.json'), JSON.stringify({ file: backup, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }, null, 2))
    const result = await applyDatabaseMerge(db, { source: parsed.tables, expectedSnapshot: before, now })
    committedResult = result
    fs.writeFileSync(path.join(directory, 'merge-result.json'), JSON.stringify({ ...result, backup, database, sourceSha256: preview.sourceSha256 }, null, 2))
    console.log(JSON.stringify({ applied: true, database, added: Object.fromEntries(Object.entries(result.counts).filter(([, value]) => value.added).map(([name, value]) => [name, value.added])), preservedExistingRows: true, checkedForeignKeys: result.checkedForeignKeys, idempotent: result.idempotent, backup, reports: directory }))
  } else {
    console.log(JSON.stringify({ applied: false, database, plannedInserts: plan.inserts.length, plannedDerivedUpdates: plan.updates.length, report: directory }))
  }
} catch (error) {
  // Do not log Prisma arguments: they can contain source passwords and personal data.
  const message = committedResult
    ? 'The database merge committed successfully, but its final report could not be saved. The merged data was not rolled back. Keep the pre-merge backup and run a preview before any retry.'
    : error.code ? 'Database operation failed (' + error.code + '). Any active merge transaction was rolled back.' : error.name === 'PrismaClientValidationError' ? 'Import data did not satisfy the application schema. Any active merge transaction was rolled back.' : error.message
  try {
    fs.writeFileSync(path.join(directory, 'merge-error.json'), JSON.stringify({ message, database, committed: Boolean(committedResult), backup, at: new Date().toISOString() }))
  } catch { /* The original result is still reported if the output directory became unavailable. */ }
  console.error(message)
  process.exitCode = 1
} finally {
  await db.$disconnect()
}
