import Icon from './ui/Icon'
import { CHARACTERISTICS } from '../lib/education'
import { DAY_SHORT } from '../lib/format'
import { TIME_PRESETS } from '../lib/times'
import { BUDGET_CHOICES } from '../lib/preferences'

// The "Preferences" form used by Signup and My Profile. Everything is optional and only ranks tutors in the
// matching score, it never hides anyone. `value` is the preferences object, `onChange` gets the next one.
function Group({ label, hint, children }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold text-navy">{label}</legend>
      {children}
      {hint && <p className="mt-1.5 text-xs text-slate-600">{hint}</p>}
    </fieldset>
  )
}

// One-of-many buttons (radio behaviour) and many-of-many buttons (checkbox behaviour)
function Choice({ on, onClick, role, children, className = '' }) {
  return (
    <button type="button" role={role} aria-checked={on} onClick={onClick} className={`chip min-h-11 ${on ? 'chip-on' : ''} ${className}`}>
      {on && <Icon name="check" className="h-4 w-4" strokeWidth={3} />} {children}
    </button>
  )
}

export default function PreferencesFields({ value, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const toggle = (key, item) => set({ [key]: value[key].includes(item) ? value[key].filter((x) => x !== item) : [...value[key], item].sort() })

  return (
    <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
      <Group label="Teaching mode">
        <div role="radiogroup" aria-label="Teaching mode" className="flex flex-wrap gap-2">
          {[['PHYSICAL', 'Physical'], ['ONLINE', 'Online'], ['EITHER', 'Either']].map(([v, l]) => (
            <Choice key={v} role="radio" on={value.mode === v} onClick={() => set({ mode: v })}>{l}</Choice>
          ))}
        </div>
      </Group>

      <Group label="Tutor gender">
        <div role="radiogroup" aria-label="Tutor gender" className="flex flex-wrap gap-2">
          {[['ANY', 'No preference'], ['FEMALE', 'Female'], ['MALE', 'Male']].map(([v, l]) => (
            <Choice key={v} role="radio" on={value.gender === v} onClick={() => set({ gender: v })}>{l}</Choice>
          ))}
        </div>
      </Group>

      <Group label="Preferred lesson days">
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 0].map((d) => (
            <Choice key={d} role="checkbox" on={value.days.includes(d)} onClick={() => toggle('days', d)} className="min-w-14 justify-center">{DAY_SHORT[d]}</Choice>
          ))}
        </div>
      </Group>

      <Group label="Preferred time of day">
        <div className="flex flex-wrap gap-2">
          <Choice role="radio" on={!value.timePreset} onClick={() => set({ timePreset: null })}>Any time</Choice>
          {Object.entries(TIME_PRESETS).map(([k, p]) => (
            <Choice key={k} role="radio" on={value.timePreset === k} onClick={() => set({ timePreset: k })}>{p.label}</Choice>
          ))}
        </div>
      </Group>

      <Group label="Teaching style">
        <div className="flex flex-wrap gap-2">
          {CHARACTERISTICS.map((c) => (
            <Choice key={c} role="checkbox" on={value.characteristics.includes(c)} onClick={() => toggle('characteristics', c)}>{c}</Choice>
          ))}
        </div>
      </Group>

      <Group label="Budget per hour (maximum)" hint="A guide for ranking tutors, not a hard limit.">
        <select
          className="input h-11 md:max-w-56"
          aria-label="Maximum budget per hour"
          value={value.budgetMax ?? ''}
          onChange={(e) => set({ budgetMax: e.target.value === '' ? null : Number(e.target.value) })}
        >
          <option value="">No limit</option>
          {BUDGET_CHOICES.map((b) => <option key={b} value={b}>Up to RM {b} / hour</option>)}
        </select>
      </Group>
    </div>
  )
}
