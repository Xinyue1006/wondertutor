import { emptyPreferences, fromApiPreferences, isEmptyPreferences, preferencesToCriteria, toApiPreferences } from '../lib/preferences'

describe('saved tutor preferences', () => {
  test('nothing chosen counts as empty and is sent to the API as null', () => {
    expect(isEmptyPreferences(emptyPreferences())).toBe(true)
    expect(toApiPreferences(emptyPreferences())).toBeNull()
  })

  test('any single choice makes them worth saving', () => {
    for (const patch of [{ mode: 'ONLINE' }, { gender: 'FEMALE' }, { characteristics: ['Structured'] }, { days: [1] }, { timePreset: 'EVENING' }, { budgetMax: 60 }]) {
      const p = { ...emptyPreferences(), ...patch }
      expect(isEmptyPreferences(p)).toBe(false)
      expect(toApiPreferences(p)).toEqual(p)
    }
  })

  test('a saved value from the API is merged over the defaults', () => {
    expect(fromApiPreferences(null)).toEqual(emptyPreferences())
    expect(fromApiPreferences({ mode: 'PHYSICAL', budgetMax: 50 })).toEqual({ ...emptyPreferences(), mode: 'PHYSICAL', budgetMax: 50 })
  })

  test('they become the matching wizard criteria, including a concrete time window for the time of day', () => {
    expect(preferencesToCriteria(null)).toEqual({})
    const c = preferencesToCriteria({ mode: 'PHYSICAL', gender: 'FEMALE', characteristics: ['Structured'], days: [1, 6], timePreset: 'EVENING', budgetMax: 60 })
    expect(c).toMatchObject({ mode: 'PHYSICAL', gender: 'FEMALE', characteristics: ['Structured'], days: [1, 6], budgetMin: null, budgetMax: 60, timePreset: 'EVENING', timeStart: '18:00', timeEnd: '20:00' })
  })

  test('"any time" leaves the time window alone', () => {
    const c = preferencesToCriteria({ ...emptyPreferences(), mode: 'ONLINE' })
    expect(c.timeStart).toBeUndefined()
  })
})
