import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'

// A dump is evidence, not a set of executable commands. This planner is pure:
// existing rows are preserved, integer IDs are mapped, and uncertain branches
// are quarantined in the report for the caller to review before one transaction.
const MODELS = Prisma.dmmf.datamodel.models
const META = new Map(MODELS.map(model => [model.name, model]))
const TABLES = new Map(MODELS.map(model => [(model.dbName || model.name).toLowerCase(), model.name]))
const ENUMS = new Map(Prisma.dmmf.datamodel.enums.map(value => [value.name, new Set(value.values.map(v => v.name))]))
const SKIP = new Set(['AuthSession', 'EmailOtp', 'SystemSetting'])
const SLOT_BLOCKING = new Set(['AWAITING_PAYMENT', 'CONFIRMED'])
const CHILD_BLOCKING = new Set(['PENDING', 'COUNTER_OFFERED', 'AWAITING_PAYMENT', 'CONFIRMED'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const norm = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

function canonical(value) {
  if (value == null) return 'null'
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Prisma.Decimal.isDecimal(value)) return JSON.stringify(value.toString())
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  return JSON.stringify(value)
}
const equal = (a, b) => canonical(a) === canonical(b)
const fieldsDiffer = (a, b, fields) => fields.filter(field => !equal(a[field] ?? null, b[field] ?? null))
const publicIdFor = (model, row) => {
  const hash = createHash('sha256').update(model + ':' + canonical(row)).digest('hex')
  return hash.slice(0, 8) + '-' + hash.slice(8, 12) + '-4' + hash.slice(13, 16) + '-a' + hash.slice(17, 20) + '-' + hash.slice(20, 32)
}

// Demo portraits from older frontend bundles must not return through a dump.
// Genuine uploads are retained; callers apply this only when inserting a new profile.
function importedProfilePhoto(url) {
  try {
    if (url && /^\/img\/people\//i.test(new URL(url, 'https://wondertutor.local').pathname)) return null
  } catch { /* Other references are outside this demo-portrait normalization. */ }
  return url
}

function convert(field, value) {
  if (value === null) {
    if (field.isRequired) throw new Error('required field is null: ' + field.name)
    return null
  }
  if (field.kind === 'enum') {
    if (typeof value !== 'string' || !ENUMS.get(field.type)?.has(value)) throw new Error('invalid enum field: ' + field.name)
    return value
  }
  if (field.type === 'String') {
    if (typeof value !== 'string') throw new Error('invalid string field: ' + field.name)
    if (field.name === 'publicId' && !UUID.test(value)) throw new Error('invalid public identifier')
    return value
  }
  if (field.type === 'Int') {
    const number = typeof value === 'number' ? value : /^-?\d+$/.test(String(value)) ? Number(value) : NaN
    if (!Number.isSafeInteger(number) || number < -2147483648 || number > 2147483647) throw new Error('invalid integer field: ' + field.name)
    return number
  }
  if (field.type === 'Boolean') {
    if (![true, false, 0, 1, '0', '1'].includes(value)) throw new Error('invalid boolean field: ' + field.name)
    return value === true || value === 1 || value === '1'
  }
  if (field.type === 'Float') {
    const number = typeof value === 'number' ? value : /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(String(value)) ? Number(value) : NaN
    if (!Number.isFinite(number)) throw new Error('invalid number field: ' + field.name)
    return number
  }
  if (field.type === 'Decimal') {
    const number = String(value)
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(number)) throw new Error('invalid decimal field: ' + field.name)
    const decimal = new Prisma.Decimal(number)
    if (!decimal.isFinite()) throw new Error('invalid decimal field: ' + field.name)
    return decimal.toString()
  }
  if (field.type === 'DateTime') {
    if (value instanceof Date) {
      if (!Number.isFinite(value.getTime())) throw new Error('invalid date field: ' + field.name)
      return new Date(value)
    }
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:(?:T| )\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) throw new Error('invalid date field: ' + field.name)
    const input = value.length === 10 ? value + 'T00:00:00.000Z' : value.replace(' ', 'T') + (/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? '' : 'Z')
    const date = new Date(input)
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error('invalid date field: ' + field.name)
    return date
  }
  if (field.type === 'Json') {
    let json
    try { json = typeof value === 'string' ? JSON.parse(value) : value } catch { throw new Error('invalid JSON field: ' + field.name) }
    if (json === undefined || typeof json === 'function' || typeof json === 'bigint') throw new Error('invalid JSON field: ' + field.name)
    return JSON.parse(JSON.stringify(json))
  }
  throw new Error('unsupported scalar field: ' + field.name)
}

export function planDatabaseMerge({ source, target = {}, now = new Date() }) {
  if (!source || typeof source !== 'object' || !Number.isFinite(new Date(now).getTime())) throw new Error('Invalid merge input')
  now = new Date(now)
  const inserts = [], updates = []
  const report = { createdByModel: {}, matchedByModel: {}, conflicts: [], mediaWarnings: [], skippedByReason: {} }
  const mappings = Object.fromEntries(MODELS.map(model => [model.name, {}]))
  const aliases = Object.fromEntries(MODELS.map(model => [model.name, new Map()]))
  const blocked = Object.fromEntries(MODELS.map(model => [model.name, new Set()]))
  const existing = Object.fromEntries(MODELS.map(model => [model.name, []]))
  const rows = Object.fromEntries(MODELS.map(model => [model.name, []]))
  const used = Object.fromEntries(MODELS.map(model => [model.name, new Set()]))
  const maxima = Object.fromEntries(MODELS.map(model => [model.name, 0]))
  const createdTutors = new Set(), affectedRatings = new Set(), blockedCalendars = new Set()
  const originalUserIds = new Set((target.User || []).map(user => user.id))
  const conflict = (model, row, reason, local, fields) => {
    const item = { model, sourceId: row?.id ?? null, reason }
    if (local?.id != null) item.localId = local.id
    if (fields?.length) item.fields = fields
    report.conflicts.push(item)
    report.skippedByReason[reason] = (report.skippedByReason[reason] || 0) + 1
  }
  const block = (model, row, reason, local, fields) => { if (row.id != null) blocked[model]?.add(row.id); conflict(model, row, reason, local, fields); return null }
  const scalarFields = model => META.get(model).fields.filter(field => field.kind !== 'object')
  function normalize(model, raw, fill = false) {
    const fields = scalarFields(model), allowed = new Map(fields.map(field => [field.name, field]))
    const result = {}
    for (const [name, value] of Object.entries(raw)) {
      const field = allowed.get(name)
      if (!field) throw new Error('unknown scalar field: ' + name)
      result[name] = convert(field, value)
    }
    if (fill) for (const field of fields) {
      if (result[field.name] !== undefined || field.name === 'id' || field.name === 'publicId') continue
      if (field.isUpdatedAt || (field.type === 'DateTime' && field.hasDefaultValue)) result[field.name] = new Date(now)
      else if (field.hasDefaultValue && typeof field.default !== 'object') result[field.name] = convert(field, field.default)
      else if (!field.isRequired) result[field.name] = null
      else if (!field.hasDefaultValue) throw new Error('missing required scalar field: ' + field.name)
    }
    return result
  }
  for (const model of MODELS) {
    for (const raw of target[model.name] || []) {
      const row = normalize(model.name, raw)
      existing[model.name].push(row)
      if (Number.isInteger(row.id)) { used[model.name].add(row.id); maxima[model.name] = Math.max(maxima[model.name], row.id) }
    }
  }
  for (const [table, entry] of Object.entries(source)) {
    const model = TABLES.get(table.toLowerCase())
    const inputRows = Array.isArray(entry) ? entry : entry?.rows || []
    if (table.toLowerCase() === '_prisma_migrations' || SKIP.has(model)) {
      report.skippedByReason[table.toLowerCase()] = inputRows.length
      continue
    }
    if (!model) { for (const row of inputRows) conflict(table, row, 'unsupported_table'); continue }
    const counts = new Map()
    for (const raw of inputRows) counts.set(raw.id, (counts.get(raw.id) || 0) + 1)
    for (const raw of inputRows) {
      if (model !== 'FavouriteTutor' && (!Number.isInteger(raw.id) || raw.id <= 0)) { conflict(model, raw, 'invalid_source_id'); continue }
      if (model !== 'FavouriteTutor' && counts.get(raw.id) > 1) { block(model, raw, 'duplicate_source_id'); continue }
      try {
        const row = normalize(model, raw, true)
        rows[model].push(row)
        if (row.id) maxima[model] = Math.max(maxima[model], row.id)
      } catch (error) { block(model, raw, 'invalid_source_row', null, [error.message]) }
    }
    rows[model].sort((a, b) => (a.id || 0) - (b.id || 0))
  }
  const all = model => existing[model]
  const existingDemoUser = id => {
    if (!originalUserIds.has(id)) return false
    const email = norm(all('User').find(user => user.id === id)?.email)
    return ['admin@wondertutor.local', 'parent@wondertutor.local'].includes(email) || /^reviewer\d+@seed\.wondertutor\.local$/.test(email) || /^[a-z0-9-]+@tutor\.wondertutor\.local$/.test(email)
  }
  const mapped = (model, id) => id == null ? null : blocked[model].has(id) ? undefined : mappings[model][id]
  function refs(model, row, required = {}, optional = {}) {
    const data = { ...row }
    for (const [field, owner] of Object.entries(required)) {
      const value = mapped(owner, row[field])
      if (value == null) return block(model, row, 'missing_dependency:' + owner)
      data[field] = value
    }
    for (const [field, owner] of Object.entries(optional)) {
      if (row[field] == null) { data[field] = null; continue }
      const value = mapped(owner, row[field])
      if (value == null) return block(model, row, 'missing_audit_dependency:' + owner)
      data[field] = value
    }
    return data
  }
  function matches(model, row, candidates) {
    if (candidates.length > 1) return block(model, row, 'ambiguous_identity')
    const found = candidates[0]
    if (!found) return null
    if (row.id != null) mappings[model][row.id] = found.id
    if (row.publicId) aliases[model].set(row.publicId, found.publicId || found.id)
    report.matchedByModel[model] = (report.matchedByModel[model] || 0) + 1
    return found
  }
  function add(model, sourceRow, data) {
    if (blocked[model].has(sourceRow.id)) return null
    if (META.get(model).fields.some(field => field.name === 'id')) {
      let id = sourceRow.id
      if (used[model].has(id)) id = ++maxima[model]
      used[model].add(id)
      data.id = id
      mappings[model][sourceRow.id] = id
    }
    if (META.get(model).fields.some(field => field.name === 'publicId')) {
      data.publicId ||= publicIdFor(model, sourceRow)
      if (all(model).some(row => row.publicId === data.publicId)) return block(model, sourceRow, 'public_id_collision')
      if (sourceRow.publicId) aliases[model].set(sourceRow.publicId, data.publicId)
    }
    inserts.push({ model, data })
    all(model).push(data)
    report.createdByModel[model] = (report.createdByModel[model] || 0) + 1
    return data
  }
  function preserve(model, sourceRow, data, found, ignored = ['id', 'createdAt', 'updatedAt', 'publicId']) {
    const fields = fieldsDiffer(found, data, Object.keys(data).filter(field => !ignored.includes(field)))
    if (fields.length) conflict(model, sourceRow, 'existing_local_values_preserved', found, fields)
  }
  function media(model, sourceRow, data, field, kind, sourceOwner, localOwner, required = false) {
    const url = data[field]
    if (!url || typeof url !== 'string') return true
    const marker = /(?:^|\/)wondertutor\/(attendance|children|qualifications)\/(\d+)\//.exec(url)
    if (!marker || (marker[1] === kind && Number(marker[2]) === localOwner && sourceOwner === localOwner)) return true
    report.mediaWarnings.push({ model, sourceId: sourceRow.id, field, reason: 'private_asset_owner_requires_migration', sourceOwnerId: sourceOwner, localOwnerId: localOwner })
    if (required) return false
    data[field] = null
    return true
  }

  for (const row of rows.User) {
    const data = { ...row, email: row.email.trim().toLowerCase() }
    if (!data.email || !data.email.includes('@')) { block('User', row, 'invalid_email'); continue }
    const found = matches('User', row, all('User').filter(user => norm(user.email) === norm(data.email)))
    if (blocked.User.has(row.id)) continue
    if (found) {
      if (found.role !== data.role || Boolean(found.deletedAt) !== Boolean(data.deletedAt)) { block('User', row, 'account_identity_or_deletion_conflict', found, ['role', 'deletedAt']); continue }
      preserve('User', row, data, found)
    } else {
      if (data.googleId && all('User').some(user => user.googleId === data.googleId)) { block('User', row, 'google_identity_conflict'); continue }
      if (data.profilePhotoUrl) data.profilePhotoUrl = importedProfilePhoto(data.profilePhotoUrl)
      add('User', row, data)
    }
  }
  for (const model of ['ParentProfile', 'TutorProfile']) for (const row of rows[model]) {
    const data = refs(model, row, { userId: 'User' })
    if (!data) continue
    const user = all('User').find(value => value.id === data.userId)
    if (user.role !== (model === 'ParentProfile' ? 'PARENT' : 'TUTOR')) { block(model, row, 'profile_role_conflict'); continue }
    const found = matches(model, row, all(model).filter(value => value.userId === data.userId))
    if (blocked[model].has(row.id)) continue
    if (found) preserve(model, row, data, found, ['id', 'ratingAvg', 'ratingCount', 'verificationSubmittedAt'])
    else {
      if (model === 'TutorProfile') { data.ratingAvg = 0; data.ratingCount = 0 }
      const inserted = add(model, row, data)
      if (inserted && model === 'TutorProfile') createdTutors.add(inserted.id)
    }
  }
  for (const row of rows.Child) {
    const data = refs('Child', row, { parentId: 'ParentProfile' })
    if (!data) continue
    let candidates = row.publicId ? all('Child').filter(value => value.publicId === row.publicId) : []
    if (candidates.some(value => value.parentId !== data.parentId)) { block('Child', row, 'public_id_owner_conflict'); continue }
    if (!candidates.length) candidates = all('Child').filter(value => value.parentId === data.parentId && norm(value.name) === norm(data.name))
    const found = matches('Child', row, candidates)
    if (blocked.Child.has(row.id)) continue
    if (found) preserve('Child', row, data, found)
    else {
      if (data.photoUrl) data.photoUrl = importedProfilePhoto(data.photoUrl)
      media('Child', row, data, 'photoUrl', 'children', row.parentId, data.parentId)
      add('Child', row, data)
    }
  }
  for (const model of ['TutorSubject', 'Qualification', 'PortfolioItem']) for (const row of rows[model]) {
    const data = refs(model, row, { tutorId: 'TutorProfile' })
    if (!data) continue
    const identityFields = model === 'TutorSubject' ? ['tutorId', 'subject', 'educationLevel', 'minGrade', 'maxGrade'] : model === 'Qualification' ? ['tutorId', 'kind', 'title', 'institution', 'year', 'documentUrl'] : ['tutorId', 'title', 'description', 'fileUrl']
    const found = matches(model, row, all(model).filter(value => !fieldsDiffer(value, data, identityFields).length))
    if (blocked[model].has(row.id)) continue
    if (found) { preserve(model, row, data, found); continue }
    if (!createdTutors.has(data.tutorId)) { block(model, row, 'existing_tutor_details_preserved'); continue }
    if (model === 'Qualification') {
      const owner = all('TutorProfile').find(value => value.id === data.tutorId)
      const sourceOwner = rows.TutorProfile.find(value => value.id === row.tutorId)
      if (!media(model, row, data, 'documentUrl', 'qualifications', sourceOwner.userId, owner.userId, true)) {
        owner.isVerified = false
        block(model, row, 'private_qualification_requires_migration')
        continue
      }
    }
    add(model, row, data)
  }
  // Calendar sets are units: unioning a teammate's closed hours into a local
  // calendar could reopen a lesson that was deliberately made unavailable.
  for (const [sourceTutorId, localTutorId] of Object.entries(mappings.TutorProfile)) {
    if (blocked.TutorProfile.has(Number(sourceTutorId))) continue
    const sourceSlots = rows.AvailabilitySlot.filter(value => value.tutorId === Number(sourceTutorId))
    const localSlots = all('AvailabilitySlot').filter(value => value.tutorId === localTutorId)
    const shape = list => list.map(value => canonical([value.dayOfWeek, value.startTime, value.endTime, value.mode])).sort()
    if (!createdTutors.has(localTutorId) && !equal(shape(sourceSlots), shape(localSlots))) blockedCalendars.add(localTutorId)
  }
  for (const row of rows.AvailabilitySlot) {
    const data = refs('AvailabilitySlot', row, { tutorId: 'TutorProfile' })
    if (!data) continue
    if (blockedCalendars.has(data.tutorId)) { block('AvailabilitySlot', row, 'existing_calendar_preserved'); continue }
    const found = matches('AvailabilitySlot', row, all('AvailabilitySlot').filter(value => !fieldsDiffer(value, data, ['tutorId', 'dayOfWeek', 'startTime', 'endTime', 'mode']).length))
    if (!found && !blocked.AvailabilitySlot.has(row.id)) add('AvailabilitySlot', row, data)
  }
  const closedWeeks = new Set()
  for (const row of rows.AvailabilityWeek) {
    const data = refs('AvailabilityWeek', row, { tutorId: 'TutorProfile' })
    if (!data) continue
    const found = matches('AvailabilityWeek', row, all('AvailabilityWeek').filter(value => value.tutorId === data.tutorId && equal(value.weekStart, data.weekStart)))
    if (blocked.AvailabilityWeek.has(row.id)) continue
    if (found) {
      const sourceSlots = rows.AvailabilityWeekSlot.filter(value => value.weekId === row.id)
      const localSlots = all('AvailabilityWeekSlot').filter(value => value.weekId === found.id)
      const shape = list => list.map(value => canonical([value.dayOfWeek, value.startTime, value.endTime, value.mode])).sort()
      if (!equal(shape(sourceSlots), shape(localSlots))) { closedWeeks.add(row.id); conflict('AvailabilityWeek', row, 'existing_week_calendar_preserved', found) }
    } else if (createdTutors.has(data.tutorId)) add('AvailabilityWeek', row, data)
    else block('AvailabilityWeek', row, 'existing_calendar_preserved')
  }
  for (const row of rows.AvailabilityWeekSlot) {
    const data = refs('AvailabilityWeekSlot', row, { weekId: 'AvailabilityWeek' })
    if (!data) continue
    if (closedWeeks.has(row.weekId)) { block('AvailabilityWeekSlot', row, 'existing_week_calendar_preserved'); continue }
    const found = matches('AvailabilityWeekSlot', row, all('AvailabilityWeekSlot').filter(value => !fieldsDiffer(value, data, ['weekId', 'dayOfWeek', 'startTime', 'endTime', 'mode']).length))
    if (!found && !blocked.AvailabilityWeekSlot.has(row.id)) add('AvailabilityWeekSlot', row, data)
  }
  for (const row of rows.AvailabilityException) {
    const data = refs('AvailabilityException', row, { tutorId: 'TutorProfile' })
    if (!data) continue
    const found = matches('AvailabilityException', row, all('AvailabilityException').filter(value => value.tutorId === data.tutorId && value.date === data.date))
    if (blocked.AvailabilityException.has(row.id)) continue
    if (found) preserve('AvailabilityException', row, data, found)
    else if (createdTutors.has(data.tutorId)) add('AvailabilityException', row, data)
    else block('AvailabilityException', row, 'existing_calendar_preserved')
  }

  const bookIdentity = ['parentId', 'childId', 'tutorId', 'subject', 'startAt', 'endAt', 'teachingMode']
  const bookCritical = [...bookIdentity, 'status', 'proposedPrice', 'counterPrice', 'agreedPrice', 'location', 'latitude', 'longitude', 'locationConfirmedAt']
  for (const row of rows.Booking) {
    const data = refs('Booking', row, { parentId: 'ParentProfile', childId: 'Child', tutorId: 'TutorProfile' }, { cancelledById: 'User' })
    if (!data) continue
    if (all('Child').find(child => child.id === data.childId)?.parentId !== data.parentId) { block('Booking', row, 'child_parent_mismatch'); continue }
    if (!(data.endAt > data.startAt)) { block('Booking', row, 'invalid_booking_interval'); continue }
    let candidates = row.publicId ? all('Booking').filter(value => value.publicId === row.publicId) : []
    if (candidates.some(value => fieldsDiffer(value, data, ['parentId', 'childId', 'tutorId']).length)) { block('Booking', row, 'public_id_owner_conflict'); continue }
    if (!candidates.length) candidates = all('Booking').filter(value => !fieldsDiffer(value, data, bookIdentity).length)
    const found = matches('Booking', row, candidates)
    if (blocked.Booking.has(row.id)) continue
    if (found) {
      const differing = fieldsDiffer(found, data, bookCritical)
      if (differing.length) block('Booking', row, 'existing_booking_state_conflict', found, differing)
      else preserve('Booking', row, data, found)
      continue
    }
    const parent = all('ParentProfile').find(value => value.id === data.parentId)
    const parentEmail = all('User').find(value => value.id === parent.userId)?.email || ''
    if ((parentEmail === 'parent@wondertutor.local' || /^reviewer\d+@seed\.wondertutor\.local$/i.test(parentEmail)) && (target.Booking || []).some(value => value.parentId === data.parentId)) {
      block('Booking', row, 'existing_demo_history'); continue
    }
    if (data.endAt > now && CHILD_BLOCKING.has(data.status)) {
      const clashes = all('Booking').some(other => other.endAt > data.startAt && other.startAt < data.endAt && ((other.childId === data.childId && CHILD_BLOCKING.has(other.status)) || (other.tutorId === data.tutorId && SLOT_BLOCKING.has(data.status) && SLOT_BLOCKING.has(other.status))))
      if (clashes) { block('Booking', row, 'active_booking_overlap'); continue }
    }
    add('Booking', row, data)
  }

  function perBooking(model, optional, identityIgnored = ['id', 'createdAt', 'publicId']) {
    for (const row of rows[model]) {
      const required = { bookingId: 'Booking', ...(model === 'Review' ? { parentId: 'ParentProfile', tutorId: 'TutorProfile' } : {}) }
      const data = refs(model, row, required, optional)
      if (!data) continue
      const booking = all('Booking').find(value => value.id === data.bookingId)
      if (model === 'Review' && (booking.parentId !== data.parentId || booking.tutorId !== data.tutorId || !Number.isInteger(data.rating) || data.rating < 1 || data.rating > 5 || !['COMPLETED', 'DISPUTED'].includes(booking.status))) { block(model, row, 'review_booking_mismatch'); continue }
      if (model === 'Payment') {
        const allowed = data.status === 'PAID' || ['REFUNDED', 'PARTIALLY_REFUNDED'].includes(data.status) ? ['CONFIRMED', 'COMPLETED', 'DISPUTED', 'CANCELLED'] : ['AWAITING_PAYMENT', 'CANCELLED', 'REJECTED']
        if (!allowed.includes(booking.status) || Number(data.amount) < 0 || Number(data.commissionRate) < 0 || Number(data.commissionRate) > 100) { block(model, row, 'payment_booking_state_conflict'); continue }
      }
      const found = matches(model, row, all(model).filter(value => value.bookingId === data.bookingId))
      if (blocked[model].has(row.id)) continue
      if (found) {
        const differences = fieldsDiffer(found, data, Object.keys(data).filter(field => !identityIgnored.includes(field)))
        if (differences.length) block(model, row, 'existing_record_state_conflict', found, differences)
        continue
      }
      if (data.publicId && all(model).some(value => value.publicId === data.publicId)) { block(model, row, 'public_id_owner_conflict'); continue }
      if (model === 'Attendance') media(model, row, data, 'checkInPhotoUrl', 'attendance', row.bookingId, data.bookingId)
      add(model, row, data)
      if (model === 'Review') affectedRatings.add(data.tutorId)
    }
  }
  perBooking('Payment', {})
  perBooking('Attendance', {})
  perBooking('SessionSummary', {})
  perBooking('Review', { moderatedById: 'User' })

  function related(model, required, optional, identityFields, validate = () => true) {
    for (const row of rows[model]) {
      const data = refs(model, row, required, optional)
      if (!data) continue
      if (!validate(data, row)) { block(model, row, 'incompatible_related_record'); continue }
      const publicMatches = data.publicId ? all(model).filter(value => value.publicId === data.publicId) : []
      const keys = model === 'Complaint' && existingDemoUser(data.filedById)
        ? ['filedById', 'againstUserId', 'bookingId', 'reviewId', 'category', 'description'] : identityFields
      const found = matches(model, row, publicMatches.length ? publicMatches : all(model).filter(value => !fieldsDiffer(value, data, keys).length))
      if (blocked[model].has(row.id)) continue
      if (found) preserve(model, row, data, found)
      else add(model, row, data)
    }
  }
  related('RescheduleRequest', { bookingId: 'Booking', requestedById: 'User' }, {}, ['bookingId', 'requestedById', 'newStartAt', 'newEndAt', 'createdAt'], data => {
    const booking = all('Booking').find(value => value.id === data.bookingId)
    const parent = all('ParentProfile').find(value => value.id === booking.parentId)
    const tutor = all('TutorProfile').find(value => value.id === booking.tutorId)
    return [parent.userId, tutor.userId].includes(data.requestedById) && data.newEndAt > data.newStartAt && (!['PENDING', 'ESCALATED'].includes(data.status) || !all('RescheduleRequest').some(value => value.bookingId === data.bookingId && ['PENDING', 'ESCALATED'].includes(value.status)))
  })
  related('Refund', { paymentId: 'Payment' }, { reviewedById: 'User' }, ['paymentId', 'amount', 'type', 'reason', 'createdAt'], data => Number(data.amount) >= 0 && (!data.transferRef || !all('Refund').some(value => value.transferRef === data.transferRef && value.paymentId !== data.paymentId)))
  related('BankAccount', { tutorId: 'TutorProfile' }, {}, ['tutorId', 'bankName', 'accountName', 'accountNumber'], data => {
    if (data.isDefault && all('BankAccount').some(value => value.tutorId === data.tutorId && value.isDefault)) data.isDefault = false
    return true
  })
  related('Withdrawal', { tutorId: 'TutorProfile', bankAccountId: 'BankAccount' }, { reviewedById: 'User' }, ['tutorId', 'bankAccountId', 'amount', 'createdAt'], data => all('BankAccount').find(value => value.id === data.bankAccountId)?.tutorId === data.tutorId && Number(data.amount) >= 0)
  related('TutorRateChange', { tutorId: 'TutorProfile' }, { adminId: 'User' }, ['tutorId', 'kind', 'rate', 'createdAt', 'changedBy'])
  related('Complaint', { filedById: 'User' }, { againstUserId: 'User', bookingId: 'Booking', reviewId: 'Review', handledById: 'User' }, ['filedById', 'category', 'description', 'createdAt'], (data, row) => {
    const uuidOwner = data.publicId && all('Complaint').find(value => value.publicId === data.publicId)
    if (uuidOwner && !equal(uuidOwner.filedById, data.filedById)) return false
    if (data.reviewId != null && all('Complaint').some(value => value.filedById === data.filedById && value.reviewId === data.reviewId && value.publicId !== row.publicId)) return false
    return true
  })
  related('AccountWarning', { userId: 'User', issuedById: 'User' }, { complaintId: 'Complaint' }, ['userId', 'issuedById', 'reason', 'createdAt'])
  for (const row of rows.FavouriteTutor) {
    const data = refs('FavouriteTutor', row, { parentId: 'ParentProfile', tutorId: 'TutorProfile' })
    if (!data) continue
    const found = all('FavouriteTutor').find(value => value.parentId === data.parentId && value.tutorId === data.tutorId)
    if (found) report.matchedByModel.FavouriteTutor = (report.matchedByModel.FavouriteTutor || 0) + 1
    else add('FavouriteTutor', row, data)
  }
  for (const row of rows.MatchingRequest) {
    const data = refs('MatchingRequest', row, { parentId: 'ParentProfile' }, { childId: 'Child' })
    if (!data) continue
    try {
      if (data.criteria?.childId != null) {
        const childId = mapped('Child', data.criteria.childId)
        if (!childId) throw new Error()
        data.criteria = { ...data.criteria, childId }
      }
      if (data.results != null) data.results = data.results.map(result => {
        const tutorId = mapped('TutorProfile', result.tutorId)
        if (!tutorId) throw new Error()
        return { ...result, tutorId }
      })
    } catch { block('MatchingRequest', row, 'unmapped_snapshot_reference'); continue }
    const found = matches('MatchingRequest', row, all('MatchingRequest').filter(value => !fieldsDiffer(value, data, ['parentId', 'source', 'createdAt', 'criteria', 'results']).length))
    if (!found && !blocked.MatchingRequest.has(row.id)) add('MatchingRequest', row, data)
  }

  function linkRef(model, value) {
    const aliased = aliases[model].get(String(value))
    if (aliased != null) return String(aliased)
    if (!/^\d+$/.test(String(value))) return null
    const id = mapped(model, Number(value))
    const row = id != null && all(model).find(value => value.id === id)
    return row ? String(row.publicId || row.id) : null
  }
  function rewriteLink(link) {
    if (link == null) return null
    if (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//')) throw new Error()
    const url = new URL(link, 'https://merge.invalid')
    let path = url.pathname
    for (const [pattern, model] of [[/^(\/parent\/tutors\/)([^/]+)(.*)$/, 'TutorProfile'], [/^(\/parent\/children\/)([^/]+)(.*)$/, 'Child'], [/^(\/parent\/payments\/)([^/]+)(.*)$/, 'Payment'], [/^(\/(?:parent|tutor|admin)\/bookings\/)([^/]+)(.*)$/, 'Booking'], [/^(\/admin\/users\/)([^/]+)(.*)$/, 'User'], [/^(\/(?:parent|admin)\/complaints\/)([^/]+)(.*)$/, 'Complaint']]) {
      const match = pattern.exec(path)
      if (!match) continue
      const ref = linkRef(model, decodeURIComponent(match[2]))
      if (ref == null) throw new Error()
      path = match[1] + encodeURIComponent(ref) + match[3]
      break
    }
    for (const [key, model] of [['booking', 'Booking'], ['child', 'Child'], ['payment', 'Payment'], ['complaint', 'Complaint'], ['review', 'Review']]) {
      if (!url.searchParams.has(key)) continue
      const ref = linkRef(model, url.searchParams.get(key))
      if (ref == null) throw new Error()
      url.searchParams.set(key, ref)
    }
    return path + url.search + url.hash
  }
  for (const row of rows.Notification) {
    const data = refs('Notification', row, { userId: 'User' })
    if (!data) continue
    try { data.link = rewriteLink(data.link) } catch { block('Notification', row, 'unmapped_notification_link'); continue }
    const keys = ['userId', 'type', 'title', 'message', 'link', ...(existingDemoUser(data.userId) ? [] : ['createdAt'])]
    const found = matches('Notification', row, all('Notification').filter(value => !fieldsDiffer(value, data, keys).length))
    if (!found && !blocked.Notification.has(row.id)) {
      const specific = /(?:[?&](?:booking|child|payment|complaint|review)=|\/(?:bookings|children|payments|complaints|users|tutors)\/[^/?#]+)/i.test(data.link || '')
      if (existingDemoUser(data.userId) && report.skippedByReason.existing_demo_history && !specific && /^(?:BOOKING|PAYMENT|REFUND|LESSON|REVIEW|RESCHEDULE)_/.test(data.type)) {
        block('Notification', row, 'existing_demo_history_notification')
        continue
      }
      add('Notification', row, data)
    }
  }
  for (const id of affectedRatings) {
    const reviews = all('Review').filter(value => value.tutorId === id && !value.isHidden)
    const ratingCount = reviews.length, ratingAvg = ratingCount ? reviews.reduce((total, review) => total + review.rating, 0) / ratingCount : 0
    const tutor = all('TutorProfile').find(value => value.id === id)
    if (createdTutors.has(id)) { tutor.ratingAvg = ratingAvg; tutor.ratingCount = ratingCount }
    else if (tutor.ratingCount !== ratingCount || tutor.ratingAvg !== ratingAvg) updates.push({ model: 'TutorProfile', where: { id }, data: { ratingAvg, ratingCount } })
  }
  return { inserts, updates, report, mappings }
}
