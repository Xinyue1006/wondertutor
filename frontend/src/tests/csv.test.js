import { toCsv } from '../lib/csv'

describe('CSV file', () => {
  test('escapes commas, quotes and line breaks, and starts with a BOM so Excel reads names correctly', () => {
    const csv = toCsv([['Subject', 'Note'], ['Maths', 'He said "good", then left\nearly']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Maths,"He said ""good"", then left\nearly"')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  test('text typed by a tutor that starts like a formula is made harmless', () => {
    const csv = toCsv([['=HYPERLINK("http://evil","click")', '+1', '-2', '@SUM(A1)', 'ok']])
    const row = csv.replace('﻿', '').trim()
    expect(row).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`)
    expect(row).toContain("'+1,'-2,'@SUM(A1),ok")
  })

  test('empty cells stay empty', () => {
    expect(toCsv([['a', null, undefined, '']]).replace('﻿', '').trim()).toBe('a,,,')
  })
})
