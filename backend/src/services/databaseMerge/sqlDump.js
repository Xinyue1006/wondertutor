// Reads a MySQL/phpMyAdmin dump as inert data. No statement from the dump is
// executed. Only ordinary INSERT ... VALUES literals are decoded; callers must
// separately allowlist models, validate fields and map foreign keys.

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
const MAX_DUMP_BYTES = 64 * 1024 * 1024

export class SqlDumpParseError extends Error {
  constructor(statementIndex, detail) {
    super(`Invalid SQL dump at statement ${statementIndex}: ${detail}`)
    this.name = 'SqlDumpParseError'
    this.statementIndex = statementIndex
  }
}

// Comments are removed only outside quoted values/identifiers. In particular,
// versioned MySQL comments are discarded, never evaluated as executable SQL.
function splitStatements(text) {
  const statements = []
  let current = '', quote = null, index = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1]
    if (quote) {
      current += char
      if (char === '\\' && quote !== '`') {
        if (next === undefined) throw new SqlDumpParseError(index + 1, 'unfinished string escape')
        current += next
        i++
      } else if (char === quote) {
        if (next === quote) { current += next; i++ }
        else quote = null
      }
      continue
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; current += char; continue }
    if (char === '#' || (char === '-' && next === '-' && (text[i + 2] === undefined || /\s/.test(text[i + 2])))) {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++
      current += ' '
      continue
    }
    if (char === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      if (end < 0) throw new SqlDumpParseError(index + 1, 'unfinished comment')
      current += ' '
      i = end + 1
      continue
    }
    if (char === ';') {
      if (current.trim()) statements.push({ sql: current.trim(), index: ++index })
      current = ''
    } else current += char
  }
  if (quote) throw new SqlDumpParseError(index + 1, 'unfinished quoted value or identifier')
  if (current.trim()) statements.push({ sql: current.trim(), index: ++index })
  return statements
}

class InsertReader {
  constructor(sql, index) { this.sql = sql; this.index = index; this.position = 0 }
  fail(detail) { throw new SqlDumpParseError(this.index, detail) }
  whitespace() { while (/\s/.test(this.sql[this.position] || '') && this.position < this.sql.length) this.position++ }
  keyword(word) {
    this.whitespace()
    const remaining = this.sql.slice(this.position)
    const match = new RegExp(`^${word}\\b`, 'i').exec(remaining)
    if (!match) this.fail(`expected ${word}`)
    this.position += match[0].length
  }
  punctuation(char) {
    this.whitespace()
    if (this.sql[this.position] !== char) this.fail(`expected ${char}`)
    this.position++
  }
  peek() { this.whitespace(); return this.sql[this.position] }
  identifier() {
    this.whitespace()
    let value = ''
    if (this.sql[this.position] === '`') {
      this.position++
      let closed = false
      while (this.position < this.sql.length) {
        const char = this.sql[this.position++]
        if (char !== '`') { value += char; continue }
        if (this.sql[this.position] === '`') { value += '`'; this.position++ }
        else { closed = true; break }
      }
      if (!closed) this.fail('unfinished identifier')
    } else {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.sql.slice(this.position))
      if (!match) this.fail('expected a simple identifier')
      value = match[0]
      this.position += value.length
    }
    if (!IDENTIFIER.test(value) || FORBIDDEN_KEYS.has(value.toLowerCase())) this.fail('unsupported identifier')
    return value
  }
  string() {
    this.position++ // opening single quote
    let value = ''
    const escapes = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a', "'": "'", '"': '"', '\\': '\\' }
    while (this.position < this.sql.length) {
      const char = this.sql[this.position++]
      if (char === "'") {
        if (this.sql[this.position] === "'") { value += "'"; this.position++ }
        else return value
      } else if (char === '\\') {
        if (this.position === this.sql.length) this.fail('unfinished string escape')
        const escaped = this.sql[this.position++]
        // MySQL keeps the slash for pattern escapes outside LIKE expressions.
        value += escaped === '%' || escaped === '_' ? '\\' + escaped : Object.hasOwn(escapes, escaped) ? escapes[escaped] : escaped
      } else value += char
    }
    this.fail('unfinished string')
  }
  literal() {
    this.whitespace()
    if (this.sql[this.position] === "'") return this.string()
    const remaining = this.sql.slice(this.position)
    const empty = /^NULL\b/i.exec(remaining)
    if (empty) { this.position += empty[0].length; return null }
    const number = NUMBER.exec(remaining)
    if (!number) this.fail('only NULL, numeric and single-quoted string literals are supported')
    this.position += number[0].length
    // Keep monetary precision, exponent notation and unsafe integers intact.
    if (/^[+-]?\d+$/.test(number[0]) && Number.isSafeInteger(Number(number[0]))) return Number(number[0])
    return number[0]
  }
  read() {
    this.keyword('INSERT'); this.keyword('INTO')
    const table = this.identifier().toLowerCase()
    this.punctuation('(')
    const columns = [], seen = new Set()
    do {
      const name = this.identifier(), lower = name.toLowerCase()
      if (seen.has(lower)) this.fail('duplicate INSERT column')
      seen.add(lower); columns.push(name)
      if (this.peek() !== ',') break
      this.position++
    } while (true)
    this.punctuation(')'); this.keyword('VALUES')
    const rows = []
    do {
      this.punctuation('(')
      const values = []
      if (this.peek() !== ')') {
        do {
          values.push(this.literal())
          if (this.peek() !== ',') break
          this.position++
        } while (true)
      }
      this.punctuation(')')
      if (values.length !== columns.length) this.fail('INSERT value count does not match its columns')
      const row = Object.create(null)
      columns.forEach((column, i) => { row[column] = values[i] })
      rows.push(row)
      if (this.peek() !== ',') break
      this.position++
    } while (true)
    if (this.peek() !== undefined) this.fail('expressions and INSERT suffixes are not supported')
    return { table, columns, rows }
  }
}

export function parseSqlDump(text) {
  if (typeof text !== 'string') throw new TypeError('SQL dump must be a string')
  if (Buffer.byteLength(text, 'utf8') > MAX_DUMP_BYTES) throw new RangeError('SQL dump exceeds the 64 MiB parser limit')
  const tables = Object.create(null)
  const metadata = { insertStatements: 0, ignoredStatements: 0, unsupportedStatements: [], declaredTables: [] }
  for (const { sql, index } of splitStatements(text.replace(/^\uFEFF/, ''))) {
    if (/^INSERT\b/i.test(sql)) {
      const insert = new InsertReader(sql, index).read()
      const existing = tables[insert.table]
      if (existing) {
        const canonical = new Map(existing.columns.map(column => [column.toLowerCase(), column]))
        if (canonical.size !== insert.columns.length || insert.columns.some(column => !canonical.has(column.toLowerCase()))) {
          throw new SqlDumpParseError(index, 'inconsistent columns across INSERTs for one table')
        }
        for (const row of insert.rows) {
          const normalized = Object.create(null)
          for (const [column, value] of Object.entries(row)) normalized[canonical.get(column.toLowerCase())] = value
          existing.rows.push(normalized)
        }
      } else tables[insert.table] = { columns: insert.columns, rows: insert.rows }
      metadata.insertStatements++
    } else if (/^(?:CREATE\s+TABLE\b|ALTER\s+TABLE\b|SET\b|START\s+TRANSACTION\b|COMMIT\b|ROLLBACK\b)/i.test(sql)) {
      if (/^SET\b/i.test(sql) && /\bSQL_MODE\b/i.test(sql) && /\bNO_BACKSLASH_ESCAPES\b/i.test(sql)) {
        throw new SqlDumpParseError(index, 'NO_BACKSLASH_ESCAPES dumps are not supported')
      }
      const declaration = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z_][A-Za-z0-9_]*)`?/i.exec(sql)
      if (declaration) {
        const table = declaration[1].toLowerCase()
        if (FORBIDDEN_KEYS.has(table)) throw new SqlDumpParseError(index, 'unsupported table identifier')
        if (!metadata.declaredTables.includes(table)) metadata.declaredTables.push(table)
      }
      metadata.ignoredStatements++
    } else {
      metadata.unsupportedStatements.push({ type: /^[A-Za-z]+/.exec(sql)?.[0].toUpperCase() || 'UNKNOWN', index })
    }
  }
  return { tables, metadata }
}
