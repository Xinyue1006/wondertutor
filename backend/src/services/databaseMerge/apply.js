import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { planDatabaseMerge } from './plan.js'

const MODELS = Prisma.dmmf.datamodel.models
const BY_NAME = new Map(MODELS.map(model => [model.name, model]))
const NEVER_IMPORT = new Set(['AuthSession', 'EmailOtp', 'SystemSetting'])
const delegate = model => model[0].toLowerCase() + model.slice(1)
const primary = model => model.primaryKey?.fields || model.fields.filter(field => field.isId).map(field => field.name)
const quoted = name => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Unexpected schema identifier')
  return '`' + name + '`'
}
function canonical(value) {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return String(value)
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    if (typeof value.toJSON === 'function') return canonical(value.toJSON())
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  }
  return value
}
const keyOf = (model, row) => JSON.stringify(primary(model).map(key => row[key]))
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))

export function snapshotFingerprint(snapshot) {
  const sorted = Object.fromEntries(MODELS.map(model => [model.name, [...snapshot[model.name]].sort((a, b) => keyOf(model, a).localeCompare(keyOf(model, b)))]))
  return createHash('sha256').update(JSON.stringify(canonical(sorted))).digest('hex')
}

export async function readDatabaseSnapshot(db) {
  const snapshot = {}
  for (const model of MODELS) snapshot[model.name] = await db[delegate(model.name)].findMany({ orderBy: primary(model).map(key => ({ [key]: 'asc' })) })
  return snapshot
}

// Every identifier below comes from the generated application schema, never the dump.
// Locking the existing rows/ranges also makes an unexpected concurrent insert fail
// safely rather than silently taking an ID allocated by the preview.
async function lockSnapshot(db) {
  for (const model of MODELS) {
    const columns = primary(model).map(key => quoted(model.fields.find(field => field.name === key).dbName || key)).join(', ')
    await db.$queryRawUnsafe('SELECT ' + columns + ' FROM ' + quoted(model.dbName || model.name) + ' ORDER BY ' + columns + ' FOR UPDATE')
  }
}

export function verifyPreservedRows(before, after, plan) {
  const counts = {}
  const ratingUpdates = new Set(plan.updates.filter(update => update.model === 'TutorProfile').map(update => update.where.id))
  for (const model of MODELS) {
    const current = new Map(after[model.name].map(row => [keyOf(model, row), row]))
    for (const original of before[model.name]) {
      const saved = current.get(keyOf(model, original))
      if (!saved) throw new Error('An existing ' + model.name + ' record would be removed')
      const comparable = model.name === 'TutorProfile' && ratingUpdates.has(original.id)
        ? { ...saved, ratingAvg: original.ratingAvg, ratingCount: original.ratingCount } : saved
      if (!same(original, comparable)) throw new Error('An existing ' + model.name + ' record would be overwritten')
    }
    const expectedNew = plan.inserts.filter(insert => insert.model === model.name).length
    if (after[model.name].length !== before[model.name].length + expectedNew) throw new Error('Unexpected ' + model.name + ' row count')
    counts[model.name] = { before: before[model.name].length, after: after[model.name].length, added: expectedNew }
  }
  return counts
}

export async function verifyForeignKeys(db) {
  let checked = 0
  for (const model of MODELS) {
    for (const relation of model.fields.filter(field => field.kind === 'object' && field.relationFromFields?.length)) {
      const target = BY_NAME.get(relation.type)
      const from = relation.relationFromFields.map(name => model.fields.find(field => field.name === name).dbName || name)
      const to = relation.relationToFields.map(name => target.fields.find(field => field.name === name).dbName || name)
      const join = from.map((name, index) => 'c.' + quoted(name) + '=p.' + quoted(to[index])).join(' AND ')
      const present = from.map(name => 'c.' + quoted(name) + ' IS NOT NULL').join(' AND ')
      const rows = await db.$queryRawUnsafe('SELECT COUNT(*) AS invalid FROM ' + quoted(model.dbName || model.name) + ' c LEFT JOIN ' + quoted(target.dbName || target.name) + ' p ON ' + join + ' WHERE ' + present + ' AND p.' + quoted(to[0]) + ' IS NULL')
      if (Number(rows[0].invalid)) throw new Error('Broken relationship: ' + model.name + '.' + relation.name)
      checked++
    }
  }
  return checked
}

export async function applyDatabaseMerge(db, { source, expectedSnapshot, now = new Date() }) {
  const fingerprint = snapshotFingerprint(expectedSnapshot)
  return db.$transaction(async tx => {
    await lockSnapshot(tx)
    const before = await readDatabaseSnapshot(tx)
    if (snapshotFingerprint(before) !== fingerprint) throw new Error('The database changed after the preview. Create a fresh backup and preview before merging.')
    const plan = planDatabaseMerge({ source, target: before, now })
    for (const insert of plan.inserts) {
      if (!BY_NAME.has(insert.model) || NEVER_IMPORT.has(insert.model)) throw new Error('Refusing an unsupported import model')
      const data = { ...insert.data }
      for (const field of BY_NAME.get(insert.model).fields) {
        if (field.type === 'Json' && data[field.name] === null) data[field.name] = Prisma.DbNull
      }
      await tx[delegate(insert.model)].create({ data })
    }
    for (const update of plan.updates) {
      if (update.model !== 'TutorProfile' || !update.where?.id || Object.keys(update.data).some(key => !['ratingAvg', 'ratingCount'].includes(key))) throw new Error('Only derived review totals may update existing rows')
      await tx.tutorProfile.update({ where: update.where, data: update.data })
    }
    const after = await readDatabaseSnapshot(tx)
    const counts = verifyPreservedRows(before, after, plan)
    const checkedForeignKeys = await verifyForeignKeys(tx)
    const repeated = planDatabaseMerge({ source, target: after, now })
    if (repeated.inserts.length || repeated.updates.length) throw new Error('Merge is not repeatable without additional changes; rolling back')
    return { report: plan.report, mappings: plan.mappings, counts, checkedForeignKeys, idempotent: true, fingerprintBefore: fingerprint, fingerprintAfter: snapshotFingerprint(after) }
  }, { isolationLevel: 'Serializable', maxWait: 20000, timeout: 120000 })
}
