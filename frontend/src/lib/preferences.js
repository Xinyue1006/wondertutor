import { TIME_PRESETS, defaultRange } from './times'

// A parent's saved tutor preferences, in the same shape as the matching wizard's criteria (see backend utils/preferences.js).
export const emptyPreferences = () => ({ mode: 'EITHER', gender: 'ANY', characteristics: [], days: [], timePreset: null, budgetMax: null })

export const isEmptyPreferences = (p) =>
  !p || (p.mode === 'EITHER' && p.gender === 'ANY' && !p.characteristics.length && !p.days.length && !p.timePreset && p.budgetMax == null)

// What the API stores: nothing chosen = null (so "no preferences" is never a pile of default values)
export const toApiPreferences = (p) => (isEmptyPreferences(p) ? null : p)

export const fromApiPreferences = (p) => ({ ...emptyPreferences(), ...(p || {}) })

// Turn saved preferences into the wizard's criteria fields (time preset also needs a concrete time window)
export function preferencesToCriteria(p) {
  if (!p) return {}
  const out = { mode: p.mode, gender: p.gender, characteristics: p.characteristics, days: p.days, budgetMin: null, budgetMax: p.budgetMax }
  if (p.timePreset && TIME_PRESETS[p.timePreset]) {
    const [s, e] = defaultRange(p.timePreset)
    Object.assign(out, { timePreset: p.timePreset, timeStart: s, timeEnd: e })
  }
  return out
}

export const BUDGET_CHOICES = [40, 50, 60, 70, 80, 100, 120]
