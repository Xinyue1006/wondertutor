import { slotsCoverInterval } from '../services/availability.service.js'
import { mytToDate } from '../utils/time.js'

const range = (startTime, endTime, mode = 'BOTH') => ({ dayOfWeek: 1, startTime, endTime, mode })
const at = time => mytToDate('2026-11-23', time)
const covered = (slots, from = '16:30', to = '17:30', mode = 'ONLINE') => slotsCoverInterval(slots, at(from), at(to), mode)

test('the whole lesson must be covered, including its final half hour', () => {
  expect(covered([range('16:00', '17:00')])).toBe(false)
  expect(covered([range('16:00', '18:00')])).toBe(true)
})
test('touching compatible ranges cover a rescheduled lesson even when their modes differ', () => {
  expect(covered([range('16:00', '17:00'), range('17:00', '18:00', 'ONLINE')])).toBe(true)
  expect(covered([range('17:00', '18:00', 'ONLINE'), range('16:00', '17:00')])).toBe(true)
})
test('a gap or an incompatible segment cannot be hidden by a compatible first range', () => {
  expect(covered([range('16:00', '17:00'), range('17:30', '18:00')])).toBe(false)
  expect(covered([range('16:00', '17:00'), range('17:00', '18:00', 'PHYSICAL')])).toBe(false)
})
test('endpoints are exclusive and unrelated later ranges cannot invalidate coverage', () => {
  expect(covered([range('16:00', '17:00'), range('17:00', '18:00', 'PHYSICAL')], '16:00', '17:00')).toBe(true)
  expect(covered([range('15:00', '16:00'), range('16:00', '17:00', 'ONLINE')], '16:00', '17:00')).toBe(true)
})
test('empty, reversed and overnight intervals are rejected', () => {
  expect(covered([])).toBe(false)
  expect(covered([range('16:00', '18:00')], '17:00', '17:00')).toBe(false)
  expect(covered([range('16:00', '18:00')], '17:30', '16:30')).toBe(false)
  expect(slotsCoverInterval([range('07:00', '22:00')], at('21:30'), mytToDate('2026-11-24', '07:30'), 'ONLINE')).toBe(false)
})
