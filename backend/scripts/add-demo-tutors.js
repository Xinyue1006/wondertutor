// Add fictional tutors to an existing LOCAL demo database without resetting it.
// Preview: npm run db:demo-tutors -- --target-db wondertutor
// Apply:   npm run db:demo-tutors -- --target-db wondertutor --apply
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { addDemoTutors, DEMO_TUTORS, demoTutorEmail, validateDemoTutors } from '../prisma/demoTutors.js'
import { SUBJECTS } from '../src/data/catalog.js'

const args = process.argv.slice(2)
const apply = args.includes('--apply'), targetIndex = args.indexOf('--target-db')
const target = targetIndex >= 0 ? args[targetIndex + 1] : null
const validArgs = targetIndex === 0 && target && (args.length === 2 || (args.length === 3 && args[2] === '--apply'))
if (!validArgs) throw new Error('Usage: npm run db:demo-tutors -- --target-db database_name [--apply]')
const url = new URL(process.env.DATABASE_URL)
if (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Fictional demo tutors can only be added to a local, non-production database')
if (url.pathname.slice(1) !== target || !/^[A-Za-z0-9_]+$/.test(target)) throw new Error('The explicit target database must match DATABASE_URL')
validateDemoTutors()
const db = new PrismaClient()
let committed = false
try {
  const existing = await db.user.findMany({ where: { email: { in: DEMO_TUTORS.map(demoTutorEmail) } }, select: { email: true } })
  const known = new Set(existing.map(user => user.email))
  const planned = DEMO_TUTORS.filter(tutor => !known.has(demoTutorEmail(tutor)))
  const profile = tutor => ({ name: tutor.name, email: demoTutorEmail(tutor), location: tutor.location, subjects: [...new Set(tutor.subjects.map(row => row.subject))] })
  const preview = { database: target, apply, planned: planned.map(profile), existing: existing.length }
  if (!apply) { console.log(JSON.stringify(preview, null, 2)); process.exitCode = 0 }
  else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const directory = path.join(os.homedir(), '.wondertutor', 'demo-tutors', stamp)
    const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
    const relative = path.relative(repository, directory)
    if (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) throw new Error('The backup directory must be outside the repository')
    fs.mkdirSync(directory, { recursive: true })
    const binary = process.platform === 'win32' && fs.existsSync('C:/xampp/mysql/bin/mysqldump.exe') ? 'C:/xampp/mysql/bin/mysqldump.exe' : 'mysqldump'
    const bytes = execFileSync(binary, ['--host=' + url.hostname, '--port=' + (url.port || '3306'), '--user=' + decodeURIComponent(url.username), '--single-transaction', '--skip-lock-tables', '--hex-blob', target], { env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) }, maxBuffer: 256 * 1024 * 1024 })
    const backup = path.join(directory, 'before-demo-tutors.sql')
    fs.writeFileSync(backup, bytes, { flag: 'wx' })
    fs.writeFileSync(path.join(directory, 'backup-integrity.json'), JSON.stringify({ bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }))
    const result = await addDemoTutors(db, await bcrypt.hash('Tutor1234', 10))
    committed = true
    const teaching = await db.tutorSubject.findMany({ where: { tutor: { user: { status: 'ACTIVE', deletedAt: null }, hourlyRate: { gt: 0 } } }, select: { subject: true, tutorId: true } })
    const coverage = SUBJECTS.map(subject => ({ subject, tutorCount: new Set(teaching.filter(row => row.subject === subject).map(row => row.tutorId)).size }))
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ ...result, backup, coverage }, null, 2))
    console.log(JSON.stringify({ applied: true, database: target, added: result.created.length, skipped: result.skipped.length, coveredSubjects: coverage.filter(item => item.tutorCount).length, totalSubjects: SUBJECTS.length, missingSubjects: coverage.filter(item => !item.tutorCount).map(item => item.subject), backup, report: path.join(directory, 'result.json') }, null, 2))
  }
} catch (error) {
  // Never print Prisma's request arguments or a database credential.
  console.error(committed ? 'Demo tutors were committed, but the final report could not be saved. Existing records were preserved. Run a preview before retrying.' : error.code ? 'Demo tutor import failed (' + error.code + '); the import transaction was rolled back.' : error.message)
  process.exitCode = 1
} finally { await db.$disconnect() }
