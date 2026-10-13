import { addDaysYmd, dateLabel, hhmmLabel, mondayOfYmd, money, timeAgo, weekdayName } from '../lib/format'
import { gradeLabel, GRADE_GROUPS, parseGrade } from '../lib/education'
import { rangeLabel, defaultRange } from '../lib/times'

describe('dates (Malaysia time, independent of the browser timezone)', () => {
  test('mondayOfYmd returns the Monday of that week', () => {
    expect(mondayOfYmd('2026-10-14')).toBe('2026-10-12') // Wednesday -> Monday
    expect(mondayOfYmd('2026-10-12')).toBe('2026-10-12') // Monday stays
    expect(mondayOfYmd('2026-10-18')).toBe('2026-10-12') // Sunday belongs to the week that started Monday
  })
  test('addDaysYmd crosses month and year ends', () => {
    expect(addDaysYmd('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28')
  })
  test('weekdayName and dateLabel', () => {
    expect(weekdayName('2026-10-12')).toBe('Mon')
    expect(dateLabel('2026-10-12')).toMatch(/Monday, 12 October 2026/)
  })
  test('hhmmLabel uses 12-hour time', () => {
    expect(hhmmLabel('00:00')).toBe('12:00 AM')
    expect(hhmmLabel('09:30')).toBe('9:30 AM')
    expect(hhmmLabel('12:00')).toBe('12:00 PM')
    expect(hhmmLabel('18:00')).toBe('6:00 PM')
  })
  test('timeAgo', () => {
    expect(timeAgo(new Date(Date.now() - 5 * 3600 * 1000))).toBe('5 hours ago')
    expect(timeAgo(new Date(Date.now() - 26 * 3600 * 1000))).toBe('1 day ago')
    expect(timeAgo(new Date())).toBe('Just now')
  })
})

describe('money', () => {
  test('always shows two decimals', () => {
    expect(money(80)).toBe('RM 80.00')
    expect(money('55.5')).toBe('RM 55.50')
  })
})

describe('education levels', () => {
  test('Malaysian naming: Kindergarten, Primary, Form', () => {
    expect(gradeLabel('PRIMARY', 5)).toBe('Primary 5')
    expect(gradeLabel('SECONDARY', 2)).toBe('Form 2')
    expect(gradeLabel('KINDERGARTEN', 1)).toBe('Kindergarten 1')
  })
  test('dropdown groups have 3 + 6 + 5 grades', () => {
    expect(GRADE_GROUPS.map((g) => g.options.length)).toEqual([3, 6, 5])
  })
  test('parseGrade round-trips the dropdown value', () => {
    expect(parseGrade('PRIMARY:5')).toEqual({ level: 'PRIMARY', grade: 5 })
  })
})

describe('time windows', () => {
  test('evening defaults to 6:00 PM - 8:00 PM as in the mockup', () => {
    expect(rangeLabel(...defaultRange('EVENING'))).toBe('6:00 PM - 8:00 PM')
  })
})
