import {
  DAYS, HOURS, addDays, addHours, applyLockChanges, bookingMode, quickAddDetails, cellKey, modeChoices, modeOf, rangesToModes, sameModes, setCellModes, shownMode, cellsToRanges, clearHours, dateOfDay, eventToRange, hourEnd, isPastHour, keepPast, keepsLocked, malaysiaLabel, momentIsPast,
  moveRange, nowInMalaysia, pastCells, rangeToEvent, rangesToCells, removeRange, sameCells, shortDate, weekLabel, weekStartOf,
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

describe('a real week on the calendar', () => {
  const MONDAY = '2026-11-16'
  // The calendar parses these strings in UTC, so the test does the same
  const roundTrip = (range) => {
    const { start, end } = rangeToEvent(range, MONDAY)
    return eventToRange(new Date(`${start}Z`), new Date(`${end}Z`))
  }

  test.each([0, 1, 2, 3, 4, 5, 6])('day %i survives the trip to the calendar and back', (dayOfWeek) => {
    const range = slot(dayOfWeek, '14:00', '17:00')
    expect(roundTrip(range)).toEqual(range)
  })

  test('each day lands on its own date, with Sunday last', () => {
    expect(rangeToEvent(slot(1, '09:00', '10:00'), MONDAY).start).toBe('2026-11-16T09:00:00')
    expect(rangeToEvent(slot(6, '09:00', '10:00'), MONDAY).start).toBe('2026-11-21T09:00:00')
    expect(rangeToEvent(slot(0, '09:00', '10:00'), MONDAY)).toEqual({ start: '2026-11-22T09:00:00', end: '2026-11-22T10:00:00' })
  })

  test('a block ending at 22:00 keeps its end', () => {
    expect(roundTrip(slot(5, '20:00', '22:00'))).toEqual(slot(5, '20:00', '22:00'))
  })

  test('dates cross months and years', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04')
    expect(dateOfDay('2026-11-30', 0)).toBe('2026-12-06')
  })

  test('weekStartOf finds the Monday, and a Sunday belongs to the week before it', () => {
    expect(weekStartOf('2026-11-16')).toBe('2026-11-16')
    expect(weekStartOf('2026-11-19')).toBe('2026-11-16')
    expect(weekStartOf('2026-11-22')).toBe('2026-11-16')
  })

  test('week labels', () => {
    expect(weekLabel('2026-11-16')).toBe('16 – 22 Nov')
    expect(weekLabel('2026-11-16', true)).toBe('16 – 22 Nov 2026')
    expect(weekLabel('2026-11-30')).toBe('30 Nov – 6 Dec')
    expect(weekLabel('2026-12-28', true)).toBe('28 Dec 2026 – 3 Jan 2027')
    expect(shortDate('2026-12-07')).toBe('7 Dec')
  })
})

describe('Malaysia time and past hours', () => {
  const now = { date: '2026-11-18', time: '14:30' } // a Wednesday

  test('nowInMalaysia reads Malaysia time whatever the computer uses', () => {
    expect(nowInMalaysia(new Date('2026-11-18T06:30:00Z'))).toEqual(now)
    expect(nowInMalaysia(new Date('2026-11-18T16:30:00Z'))).toEqual({ date: '2026-11-19', time: '00:30' })
  })

  test('an hour is over once it has started', () => {
    expect(isPastHour('2026-11-17', '21:00', now)).toBe(true)
    expect(isPastHour('2026-11-18', '14:00', now)).toBe(true)
    expect(isPastHour('2026-11-18', '15:00', now)).toBe(false)
    expect(isPastHour('2026-11-19', '07:00', now)).toBe(false)
  })

  test('momentIsPast reads the floating calendar time', () => {
    expect(momentIsPast(new Date('2026-11-18T14:00:00Z'), now)).toBe(true)
    expect(momentIsPast(new Date('2026-11-18T15:00:00Z'), now)).toBe(false)
  })

  test('pastCells covers earlier days and the hours already started today', () => {
    const past = pastCells('2026-11-16', now)
    expect(past.has('1-21:00')).toBe(true)
    expect(past.has('3-14:00')).toBe(true)
    expect(past.has('3-15:00')).toBe(false)
    expect(past.has('4-07:00')).toBe(false)
    expect(past.has('0-07:00')).toBe(false)
  })

  test('a cell counts as passed once its hour has started, and not before', () => {
    const past = pastCells('2026-11-16', { date: '2026-11-16', time: '09:00' })
    expect(past.has('1-08:00')).toBe(true)
    expect(past.has('1-09:00')).toBe(true)
    expect(past.has('1-10:00')).toBe(false)
  })

  test('a later week has no past hours', () => {
    expect(pastCells('2026-11-23', now).size).toBe(0)
  })

  test('keepPast undoes any change to a past hour and keeps the rest', () => {
    const past = new Set(['1-09:00', '1-10:00'])
    const kept = keepPast(new Set(['1-10:00', '2-09:00']), new Set(['1-09:00']), past)
    expect([...kept].sort()).toEqual(['1-09:00', '2-09:00'])
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

describe('teaching mode per hour', () => {
  const twoModes = (mode) => [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00', mode: 'ONLINE' }, { dayOfWeek: 1, startTime: '11:00', endTime: '12:00', mode }]

  test('hours with different modes stay as separate ranges', () => {
    const slots = twoModes('PHYSICAL')
    expect(cellsToRanges(rangesToCells(slots), rangesToModes(slots))).toEqual(slots)
  })

  test('hours with the same mode join into one range', () => {
    const slots = twoModes('ONLINE')
    expect(cellsToRanges(rangesToCells(slots), rangesToModes(slots))).toEqual([{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00', mode: 'ONLINE' }])
  })

  test('an hour with no entry is BOTH', () => {
    expect(modeOf(new Map(), '1-09:00')).toBe('BOTH')
    expect(rangesToModes([slot(1, '09:00', '10:00')]).get('1-09:00')).toBe('BOTH')
  })

  test('setCellModes leaves the skipped hours alone', () => {
    const next = setCellModes(new Map([['1-09:00', 'ONLINE']]), [slot(1, '09:00', '11:00')], 'PHYSICAL', new Set(['1-09:00']))
    expect(next.get('1-09:00')).toBe('ONLINE')
    expect(next.get('1-10:00')).toBe('PHYSICAL')
  })

  test('sameModes only looks at hours that are on', () => {
    expect(sameModes(new Set(['1-09:00']), new Map([['2-09:00', 'ONLINE']]), new Map())).toBe(true)
    expect(sameModes(new Set(['1-09:00']), new Map([['1-09:00', 'ONLINE']]), new Map())).toBe(false)
  })

  test('the profile limits the choices', () => {
    expect(modeChoices({ online: true, physical: true })).toEqual(['ONLINE', 'PHYSICAL', 'BOTH'])
    expect(modeChoices({ online: true, physical: false })).toEqual(['ONLINE'])
    expect(modeChoices({ online: false, physical: true })).toEqual(['PHYSICAL'])
    expect(modeChoices({ online: false, physical: false })).toEqual(['ONLINE', 'PHYSICAL', 'BOTH'])
  })

  test('BOTH shows as the one mode a tutor offers', () => {
    expect(shownMode('BOTH', { online: false, physical: true })).toBe('PHYSICAL')
    expect(shownMode('BOTH', { online: true, physical: true })).toBe('BOTH')
    expect(shownMode('ONLINE', { online: true, physical: false })).toBe('ONLINE')
  })
})

describe('the mode of a booking', () => {
  test('an hour set to one mode decides it, BOTH hours leave the choice to the parent', () => {
    expect(bookingMode([{ mode: 'BOTH' }, { mode: 'ONLINE' }], 'PHYSICAL')).toEqual({ fixed: 'ONLINE', conflict: false, mode: 'ONLINE' })
    expect(bookingMode([{ mode: 'BOTH' }, {}], 'PHYSICAL')).toEqual({ fixed: null, conflict: false, mode: 'PHYSICAL' })
  })

  test('online-only and physical-only hours cannot go in one request', () => {
    expect(bookingMode([{ mode: 'ONLINE' }, { mode: 'PHYSICAL' }], 'ONLINE').conflict).toBe(true)
  })
})

describe('quick add details', () => {
  test('Monday comes first and Sunday last, whatever order they were ticked in', () => {
    expect(quickAddDetails({ days: [0, 3, 1], from: '17:00', to: '21:00', mode: 'ONLINE' })).toBe('Mon, Wed, Sun · 17:00–21:00 · Online')
  })
})

describe('held hours', () => {
  test('malaysiaLabel reads an instant in Malaysia time, across a midnight and a month', () => {
    expect(malaysiaLabel('2026-11-23T08:00:00.000Z')).toBe('Mon 23 Nov, 16:00')
    expect(malaysiaLabel('2026-11-30T17:30:00.000Z')).toBe('Tue 1 Dec, 01:30')
  })

  test('applyLockChanges switches a new hold on and leaves a released hour that the tutor opened', () => {
    const open = new Set(['1-15:00'])
    const next = applyLockChanges(new Set(['1-15:00', '2-09:00']), new Set(['1-15:00']), new Set(['3-10:00']), open)
    expect([...next].sort()).toEqual(['1-15:00', '2-09:00', '3-10:00'])
  })

  test('applyLockChanges drops a released hour that was on only because of the hold', () => {
    const next = applyLockChanges(new Set(['1-15:00', '2-09:00']), new Set(['1-15:00']), new Set(), new Set())
    expect([...next]).toEqual(['2-09:00'])
  })
})
