// Opt-in live comparison. Uses synthetic fixtures and refuses a non-test database.
// EVAL_LIVE=1 node scripts/compare-assistant-models.js [model ...]
import 'dotenv/config'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { testDatabaseUrl } from './setup-test-db-url.js'

if (process.env.EVAL_LIVE !== '1') throw new Error('Set EVAL_LIVE=1 to opt in to live, rate-limited API calls.')
process.env.DATABASE_URL = testDatabaseUrl(process.env.DATABASE_URL)
if (!new URL(process.env.DATABASE_URL).pathname.endsWith('_test')) throw new Error('A test database is required')
process.env.NODE_ENV = 'test'

const { env } = await import('../src/config/env.js')
const { prisma } = await import('../src/config/prisma.js')
const { seedFixtures } = await import('../src/eval/fixtures.js')
const { observeCase, gradeCase, summarise } = await import('../src/eval/assistantEval.js')
const { geminiProvider, setProvider } = await import('../src/services/assistant/provider.js')
const models = process.argv.slice(2)
if (!models.length || models.length > 4) throw new Error('Supply one to four models whose free-tier availability you have checked.')
if (!env.ai.enabled) throw new Error('The AI assistant must be configured')
const cfg = { ...env.ai }
const dataset = JSON.parse(readFileSync(new URL('../eval/assistant-dataset.v1.json', import.meta.url), 'utf8'))
const ids = ['MAT-05', 'MAT-10', 'MAT-15', 'BOO-05', 'PRO-10', 'PAY-05', 'CHI-05', 'COM-10', 'FAQ-10', 'ADV-10']
const cases = ids.map((id) => dataset.cases.find((c) => c.id === id))
const results = Object.fromEntries(models.map((model) => [model, []]))
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const folder = new URL('../eval/reports/', import.meta.url)
mkdirSync(folder, { recursive: true })
const file = new URL(`comparison-${stamp}.json`, folder)
const save = () => {
  const summaries = models.map((model) => summarise(results[model], { datasetVersion: dataset.meta.datasetVersion, model }))
  writeFileSync(file, JSON.stringify({ runAt: stamp, design: 'Same ten synthetic cases; interleaved, rotating model order; unchanged prompt, tools and 15s turn deadline. Small diagnostic sample, not a formal held-out score after tuning.', summaries, results }, null, 2))
  return summaries
}
try {
  const fixtures = await seedFixtures()
  for (let i = 0; i < cases.length; i++) {
    for (let j = 0; j < models.length; j++) {
      const model = models[(i + j) % models.length]
      Object.assign(env.ai, cfg, { model })
      setProvider(geminiProvider({ ...cfg, model }))
      const observation = await observeCase(cases[i], fixtures, { mode: 'live' })
      const result = gradeCase(cases[i], observation)
      results[model].push({ ...result, calls: observation.turns.map((t) => t.calls) })
      save()
      console.log(JSON.stringify({ model, id: result.id, ms: result.latencyMs, pass: result.pass, taskSuccess: result.taskSuccess, fallback: result.fallback, failure: result.failure }))
    }
  }
  console.log(JSON.stringify(save().map((s) => ({ model: s.model, n: s.n, strict: s.strictPassRate, success: s.taskSuccessRate, fallback: s.fallbackRate, latencyMs: s.latencyMs }))))
  console.log(`Report: ${file.pathname}`)
} finally {
  setProvider(null)
  Object.assign(env.ai, cfg)
  await prisma.$disconnect()
}
