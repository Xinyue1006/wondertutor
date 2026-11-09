// Baseline for the evaluation report: how well the OLD keyword parser (guided chat) reads the matching cases of the
// synthetic assistant dataset. Only fields the old parser supports are compared (subject, level, grade, mode, budget,
// gender), and only single-turn matching cases, so unsupported cross-module questions are not counted as failures.
// The AI assistant's own accuracy on the same cases comes from the backend live evaluation (scripts/eval-assistant.js).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseText } from '../assistant/parseText'

// Tests run from frontend/, so the dataset is one folder up in backend/eval
const dataset = JSON.parse(readFileSync(resolve(process.cwd(), '../backend/eval/assistant-dataset.v1.json'), 'utf8'))
const catalog = { subjects: ['Mathematics', 'English', 'Science', 'Bahasa Melayu', 'Physics'], locations: ['Kepong, Kuala Lumpur'], characteristics: [] }
const FIELDS = ['subject', 'level', 'grade', 'mode', 'budgetMax', 'gender']

test('old keyword parser baseline on matching cases', () => {
  const cases = dataset.cases.filter((c) => c.category === 'matching' && c.turns.length === 1 && c.expect.args.search_tutors && Object.keys(c.expect.args.search_tutors).some((k) => FIELDS.includes(k)))
  let expectedFields = 0
  let correct = 0
  const byLanguage = {}
  for (const c of cases) {
    const want = c.expect.args.search_tutors
    const { found } = parseText(c.turns[0].user, catalog)
    const lang = (byLanguage[c.language] ||= { fields: 0, correct: 0 })
    for (const f of FIELDS) {
      if (want[f] === undefined) continue
      expectedFields++
      lang.fields++
      if (JSON.stringify(found[f]) === JSON.stringify(want[f])) { correct++; lang.correct++ }
    }
  }
  const report = { cases: cases.length, fieldAccuracy: Math.round((correct / expectedFields) * 1000) / 10, byLanguage }
  if (process.env.EVAL_REPORT) console.log('Keyword parser baseline:', JSON.stringify(report))
  expect(cases.length).toBeGreaterThan(10)
  expect(report.fieldAccuracy).toBeGreaterThanOrEqual(0)
})
