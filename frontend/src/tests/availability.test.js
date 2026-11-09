import { DAYS, HOURS, addHours, cellKey, cellsOnLine, cellsToRanges, clearHours, hourEnd, rangesToCells, sameCells } from '../lib/availability'

const slot = (dayOfWeek, startTime, endTime) => ({ dayOfWeek, startTime, endTime })

describe('availability helpers', () => {
  test('the grid runs 07:00 to 22:00, Monday first', () => {
    expect(HOURS[0]).toBe('07:00')
    expect(HOURS[HOURS.length - 1]).toBe('21:00')
    expect(hourEnd('21:00')).toBe('22:00')
    expect(DAYS.map((d) => d.value)).toEqual([1, 2, 3, 4, 5, 6, 0])
  })

  test('ranges become one key per hour', () => {
    expect([...rangesToCells([slot(1, '14:00', '17:00')])]).toEqual(['1-14:00', '1-15:00', '1-16:00'])
  })

  test('cells and ranges convert both ways without change', () => {
    const ranges = [slot(0, '09:00', '10:00'), slot(1, '07:00', '09:00'), slot(1, '20:00', '22:00')]
    expect(cellsToRanges(rangesToCells(ranges))).toEqual(ranges)
  })

  test('consecutive hours merge into one range; a gap splits them', () => {
    const cells = new Set(['2-10:00', '2-11:00', '2-13:00'])
    expect(cellsToRanges(cells)).toEqual([slot(2, '10:00', '12:00'), slot(2, '13:00', '14:00')])
  })

  test('the last hour of the day closes at 22:00', () => {
    expect(cellsToRanges(new Set(['3-21:00']))).toEqual([slot(3, '21:00', '22:00')])
  })

  test('an empty set gives no ranges', () => {
    expect(cellsToRanges(new Set())).toEqual([])
  })

  test('addHours switches on the hours between, on every chosen day', () => {
    const next = addHours(new Set(), [1, 0], '09:00', '11:00')
    expect([...next].sort()).toEqual(['0-09:00', '0-10:00', '1-09:00', '1-10:00'])
  })

  test('addHours keeps what was already on and does not change its input', () => {
    const before = new Set(['1-07:00', '5-15:00'])
    const next = addHours(before, [1], '09:00', '10:00')
    expect(next.has('1-07:00')).toBe(true)
    expect(next.has('5-15:00')).toBe(true)
    expect(before.size).toBe(2)
  })

  test('addHours leaves a locked hour on', () => {
    expect(addHours(new Set([cellKey(1, '15:00')]), [1], '14:00', '17:00').has('1-15:00')).toBe(true)
  })

  test('clearing one day keeps other days and locked hours', () => {
    const cells = new Set(['1-09:00', '1-15:00', '2-09:00'])
    expect([...clearHours(cells, new Set(['1-15:00']), 1)].sort()).toEqual(['1-15:00', '2-09:00'])
  })

  test('clearing everything keeps only locked hours', () => {
    const cells = new Set(['1-09:00', '1-15:00', '2-09:00'])
    expect([...clearHours(cells, new Set(['1-15:00']))]).toEqual(['1-15:00'])
  })

  test('clearing Sunday (day 0) is not treated as clearing everything', () => {
    expect([...clearHours(new Set(['0-09:00', '1-09:00']), new Set(), 0)]).toEqual(['1-09:00'])
  })

  test('cellsOnLine fills in the hours skipped by a fast drag', () => {
    expect(cellsOnLine('2-07:00', '2-10:00')).toEqual(['2-07:00', '2-08:00', '2-09:00', '2-10:00'])
    expect(cellsOnLine('2-10:00', '2-08:00')).toEqual(['2-10:00', '2-09:00', '2-08:00'])
  })

  test('cellsOnLine crosses days in display order, Sunday after Saturday', () => {
    expect(cellsOnLine('6-09:00', '0-09:00')).toEqual(['6-09:00', '0-09:00'])
    expect(cellsOnLine('1-09:00', '1-09:00')).toEqual(['1-09:00'])
  })

  test('sameCells ignores order', () => {
    expect(sameCells(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
    expect(sameCells(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false)
  })
})
