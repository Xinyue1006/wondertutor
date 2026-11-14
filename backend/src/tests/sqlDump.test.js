import { parseSqlDump, SqlDumpParseError } from '../services/databaseMerge/sqlDump.js'

test('parses multiple ordinary dump inserts without executing DDL or losing column identities', () => {
  const dump = `-- Database export
    CREATE TABLE \`User\` (\`id\` int NOT NULL, \`fullName\` varchar(191));
    SET time_zone = '+00:00'; START TRANSACTION;
    INSERT INTO \`User\` (\`id\`, \`fullName\`) VALUES (1, 'Example One'), (2, 'Example Two');
    INSERT INTO user (FULLNAME, ID) VALUES ('Example Three', 3);
    ALTER TABLE \`User\` ADD PRIMARY KEY (id); COMMIT;`
  const parsed = parseSqlDump(dump)
  expect(parsed.tables.user.columns).toEqual(['id', 'fullName'])
  expect(parsed.tables.user.rows).toEqual([{ id: 1, fullName: 'Example One' }, { id: 2, fullName: 'Example Two' }, { id: 3, fullName: 'Example Three' }])
  expect(parsed.metadata).toMatchObject({ insertStatements: 2, ignoredStatements: 5, unsupportedStatements: [], declaredTables: ['user'] })
})

test('handles MySQL escapes, doubled quotes, JSON and comment delimiters inside values', () => {
  const dump = String.raw`/* heading */ INSERT INTO \`sample\` (id, notes, preferences) VALUES
    (7, 'Can\'t reset; -- private text /* stays text */ # also text\nLine two\tend\\path', '["English","中文"]'),
    (8, 'It''s fine', '{"quote":"a\\\\b"}');`
  // Backticks need no SQL escape; String.raw retains JS's backtick escape.
  const parsed = parseSqlDump(dump.replace(/\\`/g, '`'))
  expect(parsed.tables.sample.rows[0]).toEqual({ id: 7, notes: "Can't reset; -- private text /* stays text */ # also text\nLine two\tend\\path", preferences: '["English","中文"]' })
  expect(parsed.tables.sample.rows[1].notes).toBe("It's fine")
  expect(JSON.parse(parsed.tables.sample.rows[1].preferences)).toEqual({ quote: 'a\\b' })
})

test('retains exact decimals, exponent text and unsafe integers, while decoding safe integer foreign keys and NULL', () => {
  const { tables } = parseSqlDump("INSERT INTO payment (id, bookingId, amount, commission, big, exponent, note) VALUES (1, 17, 12345678901234567890.12345, -0.0500, 9007199254740993, 1.25e-3, NULL)")
  expect(tables.payment.rows[0]).toEqual({ id: 1, bookingId: 17, amount: '12345678901234567890.12345', commission: '-0.0500', big: '9007199254740993', exponent: '1.25e-3', note: null })
})

test.each([
  "INSERT INTO t (id, name) VALUES (1)",
  "INSERT INTO t (id, ID) VALUES (1, 2)",
  "INSERT INTO t (id) VALUES (1),",
  "INSERT INTO t (id) VALUES (NOW())",
  "INSERT INTO t (id) VALUES ((SELECT 1))",
  "INSERT INTO t (id) VALUES (1+2)",
  "INSERT INTO t (id) VALUES (0xFF)",
  'INSERT INTO t (name) VALUES ("double quoted")',
  "INSERT INTO t (id) VALUES (1) ON DUPLICATE KEY UPDATE id = 2",
  "INSERT INTO db.t (id) VALUES (1)",
  "INSERT IGNORE INTO t (id) VALUES (1)",
  "INSERT INTO t (id) SELECT 1",
  "INSERT INTO t (id) VALUES ()",
  "INSERT INTO t () VALUES ()",
])('rejects malformed or nonliteral INSERT without exposing its contents: %s', sql => {
  expect(() => parseSqlDump(sql)).toThrow(SqlDumpParseError)
})

test.each([
  "INSERT INTO t (name) VALUES ('unclosed)",
  '/* unclosed comment',
  'INSERT INTO `unclosed (id) VALUES (1)',
])('rejects unfinished syntax', sql => {
  expect(() => parseSqlDump(sql)).toThrow(SqlDumpParseError)
})

test('flags other executable statement types without executing or echoing their contents', () => {
  const { metadata } = parseSqlDump("DROP TABLE secret; DELETE FROM secret; UPDATE secret SET value='PRIVATE'; REPLACE INTO t (id) VALUES (1); CREATE TRIGGER unsafe BEFORE INSERT ON t FOR EACH ROW SET @x=1; SELECT SLEEP(5);")
  expect(metadata.unsupportedStatements.map(s => s.type)).toEqual(['DROP', 'DELETE', 'UPDATE', 'REPLACE', 'CREATE', 'SELECT'])
  expect(JSON.stringify(metadata)).not.toContain('PRIVATE')
})

test('does not execute versioned comments and handles hashes, CRLF and a BOM', () => {
  const { tables, metadata } = parseSqlDump("\uFEFF/*!40101 SET NAMES utf8mb4 */; # export\r\n-- next\r\nINSERT INTO t (id) VALUES (4); /*!99999 DROP TABLE t */;")
  expect(tables.t.rows).toEqual([{ id: 4 }])
  expect(metadata.insertStatements).toBe(1)
  expect(metadata.unsupportedStatements).toEqual([])
})

test('rejects incompatible repeated INSERT columns and prototype-sensitive identifiers', () => {
  expect(() => parseSqlDump('INSERT INTO t (id, first) VALUES (1, NULL); INSERT INTO t (id, second) VALUES (2, NULL);')).toThrow(/inconsistent columns/)
  for (const sql of ["INSERT INTO t (__proto__) VALUES ('x')", "INSERT INTO constructor (id) VALUES (1)", 'CREATE TABLE `__proto__` (id int)']) {
    expect(() => parseSqlDump(sql)).toThrow(SqlDumpParseError)
  }
  expect({}.polluted).toBeUndefined()
})

test('refuses incompatible SQL string mode and returns content-free errors', () => {
  expect(() => parseSqlDump("SET SQL_MODE = 'NO_BACKSLASH_ESCAPES'; INSERT INTO t (id) VALUES (1)")).toThrow(/NO_BACKSLASH_ESCAPES/)
  const secret = 'do-not-include-this-value'
  try { parseSqlDump(`INSERT INTO t (name) VALUES ('${secret}', 2)`) } catch (error) {
    expect(error.message).not.toContain(secret)
    expect(error.statementIndex).toBe(1)
  }
  expect(() => parseSqlDump(null)).toThrow(TypeError)
})
