// A narrow consistency hint after the model has already selected tutor search.
// This never classifies intent, selects a tool/child or supplies an unstated year.
// Domain validation still decides whether a stated level/year is supported.
const EN_MS_YEAR = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6,
}
const ZH_YEAR = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
const LATIN_LEVEL = 'primary|standard|darjah|tahun|form|secondary|tingkatan'
// Also consume common unsupported years so they cannot be partially read as a
// valid year, or ignored beside another, conflicting school-year statement.
const WORD_YEAR = 'dua belas|sebelas|sepuluh|sembilan|kosong|sifar|tujuh|lapan|eight|eleven|twelve|seven|three|empat|enam|satu|five|four|nine|zero|lima|tiga|one|two|six|ten|dua'
const YEAR_MENTION = new RegExp(
  `(?<![a-z0-9_])(${LATIN_LEVEL})(?:\\s*(\\d+(?:[.,]\\d+)?)|\\s+(${WORD_YEAR}))(?![a-z0-9_])|((?:小学|小學|小|中学|中學|中))\\s*([零〇一二三四五六七八九十百千两兩\\d]+)`,
  'giu',
)
const ANY_LEVEL = `(?:${LATIN_LEVEL}|小学|小學|小|中学|中學|中)`
const ALTERNATIVE_LEVELS = new RegExp(`${ANY_LEVEL}\\s*(?:or|and|atau|dan|/|&|或|和|及|至|到|[-–—])\\s*${ANY_LEVEL}`, 'iu')
const YEAR_TAIL = `(?:\\d|${WORD_YEAR}|[零〇一二三四五六七八九十百千两兩])`
const RANGE_OR_CHOICE = new RegExp(`^\\s*(?:or|and|to|through|until|atau|dan|hingga|sampai|/|&|[-–—~～]|或|和|及|至|到)\\s*(?:${ANY_LEVEL}\\s*)?${YEAR_TAIL}`, 'iu')
const CLAUSE_BREAK = /[.!?。！？;；,，\n]/u
const NEGATIVE_OR_HISTORY = /\b(?:no|not|never|without|except|excluding|exclude|was|previously|formerly|bukan|tidak|tak|jangan|kecuali|dulu|sebelum)\b|don['’]t|doesn['’]t|isn['’]t|wasn['’]t|used to be|不|非|别|別|以前|曾经|曾經|原来|原來/iu
const NAME_PREFIX = /(?:\b(?:named|called|bernama)|\b(?:name|nama(?:nya)?)\s*(?:is|adalah|ialah)?|名叫|名字(?:是|叫)|姓名是|叫)\s*$/iu
const NEGATIVE_SUFFIX = /^\s*(?:is\s+not|isn['’]t|was\s+not|wasn['’]t|bukan\b|tidak\b|不是|不对|不對|不要)/iu
const NAME_SUFFIX = /^\s*(?:is (?:my|his|her|their|the) (?:name|nickname)|(?:是|叫)(?:名字|姓名|昵称|暱稱))/iu

function quotedRanges(text) {
  const ranges = []
  for (const pattern of [/"[^"\n]*"/gu, /'[^'\n]*'/gu, /“[^”\n]*”/gu, /‘[^’\n]*’/gu, /`[^`\n]*`/gu, /「[^」\n]*」/gu, /『[^』\n]*』/gu])
    for (const m of text.matchAll(pattern)) ranges.push([m.index, m.index + m[0].length])
  return ranges
}

export function explicitSchoolYear(message) {
  if (typeof message !== 'string' || !message.trim() || message.length > 2000) return null
  const text = message.normalize('NFKC').toLowerCase()
  if (ALTERNATIVE_LEVELS.test(text)) return null
  const quotes = quotedRanges(text)
  const matches = [...text.matchAll(YEAR_MENTION)]
  if (!matches.length) return null
  const unique = new Map()
  for (const match of matches) {
    const start = match.index, end = start + match[0].length
    if (quotes.some(([from, to]) => from < end && start < to)) return null
    const prefix = text.slice(Math.max(0, start - 100), start).split(CLAUSE_BREAK).at(-1)
    const suffix = text.slice(end, end + 100)
    if (NEGATIVE_OR_HISTORY.test(prefix) || NAME_PREFIX.test(prefix) || NEGATIVE_SUFFIX.test(suffix) || NAME_SUFFIX.test(suffix)) return null
    if (RANGE_OR_CHOICE.test(suffix) || /^\s*(?:[.,]\s*\d|[点點][零〇一二三四五六七八九\d]|(?:hundred|thousand|belas|puluh|ratus|setengah|and (?:a )?half)\b)/iu.test(suffix)) return null
    const label = match[1] || match[4]
    const level = /^(?:primary|standard|darjah|tahun|小)/u.test(label) ? 'PRIMARY' : 'SECONDARY'
    const rawYear = match[2] || match[3] || match[5]
    const grade = /^\d+(?:[.,]\d+)?$/u.test(rawYear) ? Number(rawYear.replace(',', '.')) : EN_MS_YEAR[rawYear] ?? ZH_YEAR[rawYear]
    if (!Number.isInteger(grade) || grade < 1 || grade > 6) return null
    unique.set(`${level}:${grade}`, { level, grade })
  }
  return unique.size === 1 ? unique.values().next().value : null
}
