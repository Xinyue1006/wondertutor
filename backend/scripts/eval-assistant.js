// Runs the synthetic assistant evaluation and writes a report to eval/reports/.
//
//   node scripts/eval-assistant.js                 -> ORACLE REPLAY, no AI calls, free. Deterministic regression coverage of
//                                                     our backend only: it is NOT an AI accuracy measurement.
//   EVAL_LIVE=1 node scripts/eval-assistant.js --live [--limit 20] [--held-out]
//        -> calls the configured Gemini model (AI_ASSISTANT_ENABLED=true, GEMINI_API_KEY, GEMINI_MODEL in backend/.env).
//           Opt-in, cost-bounded (default at most 20 cases, max 100) and synthetic data only. Never run by CI or by tests.
//           Reports model tool selection / arguments / prohibited-tool requests separately from backend enforcement.
//
// Safety: the script resets and seeds the TEST database (<name>_test) and refuses to run against any other database.
import 'dotenv/config'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { testDatabaseUrl } from './setup-test-db-url.js'

process.env.DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL)
if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('Refusing to run: not a _test database')
process.env.NODE_ENV = 'test' // quiet logs, no rate limiting

const args = process.argv.slice(2)
const live = args.includes('--live')
const limitArg = args.indexOf('--limit')
const limit = Math.min(Math.max(Number(limitArg >= 0 ? args[limitArg + 1] : live ? 20 : 100) || 20, 1), 100)
if (live && process.env.EVAL_LIVE !== '1') throw new Error('Live evaluation calls a paid/rate-limited AI service. Set EVAL_LIVE=1 to confirm.')

const { prisma } = await import('../src/config/prisma.js')
const { env } = await import('../src/config/env.js')
const { seedFixtures } = await import('../src/eval/fixtures.js')
const { runCase, summarise } = await import('../src/eval/assistantEval.js')
if (live && !env.ai.enabled) throw new Error('Set AI_ASSISTANT_ENABLED=true, GEMINI_API_KEY and GEMINI_MODEL for live evaluation.')

const dataset = JSON.parse(readFileSync(new URL('../eval/assistant-dataset.v1.json', import.meta.url), 'utf8'))
let cases = dataset.cases
if (args.includes('--held-out')) cases = cases.filter((c) => c.heldOut)
cases = cases.slice(0, limit)

const fx = await seedFixtures()
const results = []
for (const c of cases) {
  const r = await runCase(c, fx, { mode: live ? 'live' : 'mock' })
  results.push(r)
  process.stdout.write(`${r.pass ? '✓' : r.taskSuccess ? '~' : '✗'} ${r.id} (${r.latencyMs} ms)${r.pass ? '' : ` ${r.failure}`}\n`)
}
const summary = summarise(results, { datasetVersion: dataset.meta.datasetVersion, model: live ? env.ai.model : 'oracle' })
mkdirSync(new URL('../eval/reports/', import.meta.url), { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const file = new URL(`../eval/reports/${live ? 'live' : 'mock'}-${stamp}.json`, import.meta.url)
writeFileSync(file, JSON.stringify({ summary, results }, null, 1))
if (live) {
  console.log(`\nLIVE model evaluation (${summary.model}), ${summary.n} cases: task success ${summary.taskSuccessRate}%, strict pass (task + model behaviour) ${summary.strictPassRate}%.`)
  console.log('Model behaviour:', JSON.stringify(summary.modelBehaviour))
  console.log('(~ = the task succeeded but the model itself misbehaved, e.g. it asked for a prohibited tool that the backend then rejected)')
} else {
  console.log(`\nORACLE REPLAY, ${summary.n} cases: ${summary.regressionPassRate}% pass the deterministic backend checks. This is regression coverage, not AI accuracy.`)
}
console.log(`Report: ${file.pathname}`)
await prisma.$disconnect()
