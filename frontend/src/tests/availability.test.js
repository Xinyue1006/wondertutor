import {
  DAYS, HOURS, REF_MONDAY, addHours, cellKey, cellsToRanges, clearHours, eventToRange, hourEnd, keepsLocked, moveRange, rangeToEvent,
  rangesToCells, removeRange, sameCells,
} from '../lib/availability'

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

  test('sameCells ignores order', () => {
    expect(sameCells(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
    expect(sameCells(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false)
  })
})

describe('the reference week', () => {
  // The calendar parses these strings in UTC, so the test does the same
  const roundTrip = (range) => {
    const { start, end } = rangeToEvent(range)
    return eventToRange(new Date(`${start}Z`), new Date(`${end}Z`))
  }

  test('starts on a Monday', () => {
    expect(new Date(`${REF_MONDAY}T00:00:00Z`).getUTCDay()).toBe(1)
  })

  test.each([0, 1, 2, 3, 4, 5, 6])('day %i survives the trip to the calendar and back', (dayOfWeek) => {
    const range = slot(dayOfWeek, '14:00', '17:00')
    expect(roundTrip(range)).toEqual(range)
  })

  test('Sunday is the last day of the reference week', () => {
    expect(rangeToEvent(slot(0, '09:00', '10:00'))).toEqual({ start: '2001-01-07T09:00:00', end: '2001-01-07T10:00:00' })
  })

  test('a block ending at 22:00 keeps its end', () => {
    expect(roundTrip(slot(5, '20:00', '22:00'))).toEqual(slot(5, '20:00', '22:00'))
  })
})

describe('moving, removing and the lock check', () => {
  const block = slot(1, '14:00', '17:00')
  const locked = new Set(['1-15:00'])

  test('moveRange takes the old hours off and puts the new ones on', () => {
    expect([...moveRange(rangesToCells([block]), block, slot(2, '09:00', '12:00'))].sort()).toEqual(['2-09:00', '2-10:00', '2-11:00'])
  })

  test('moveRange leaves other blocks alone', () => {
    const cells = rangesToCells([block, slot(4, '09:00', '10:00')])
    expect(moveRange(cells, block, slot(2, '09:00', '12:00')).has('4-09:00')).toBe(true)
  })

  test('a move that keeps the booked hour is accepted', () => {
    const next = moveRange(rangesToCells([block]), block, slot(1, '15:00', '18:00'))
    expect(keepsLocked(next, locked)).toBe(true)
  })

  test('a move to another day drops the booked hour and is refused', () => {
    expect(keepsLocked(moveRange(rangesToCells([block]), block, slot(2, '14:00', '17:00')), locked)).toBe(false)
  })

  test('a resize that shrinks past the booked hour is refused', () => {
    expect(keepsLocked(moveRange(rangesToCells([block]), block, slot(1, '14:00', '15:00')), locked)).toBe(false)
  })

  test('taking the hours off without the lock would be refused', () => {
    const cells = rangesToCells([block])
    cells.delete('1-15:00')
    expect(keepsLocked(cells, locked)).toBe(false)
  })

  test('removeRange takes the free hours off and leaves the booked one on', () => {
    expect([...removeRange(rangesToCells([block]), block, locked)]).toEqual(['1-15:00'])
  })

  test('removeRange can split a block', () => {
    const next = removeRange(rangesToCells([block]), slot(1, '15:00', '16:00'), new Set())
    expect(cellsToRanges(next)).toEqual([slot(1, '14:00', '15:00'), slot(1, '16:00', '17:00')])
  })

  test('removeRange does not change its input', () => {
    const cells = rangesToCells([block])
    removeRange(cells, block, new Set())
    expect(cells.size).toBe(3)
  })
})
