import { subjectsForLevel } from '../lib/subjects'

// "Subjects that need help": tap as many as apply (up to `max`). Only the subjects that exist at the child's level are
// shown, so a Primary 3 child is not offered Physics, and a Form 5 student sees Additional Mathematics and the SPM electives.
export default function SubjectPicker({
  label = 'Subjects that need help', value = [], onChange, level, subjects = [], subjectLevels, max = 6, error, hint, required = false, idPrefix = 'subj',
}) {
  const options = subjectsForLevel(subjects, subjectLevels, level)
  const full = value.length >= max
  const toggle = (s) => onChange(value.includes(s) ? value.filter((x) => x !== s) : full ? value : [...value, s])

  return (
    <fieldset className="min-w-0" aria-describedby={`${idPrefix}-help`}>
      <legend className="mb-1.5 text-sm font-semibold text-navy">
        {label}{required ? <span className="text-red-700" aria-hidden="true"> *</span> : <span className="font-normal text-slate-600"> (optional)</span>}
      </legend>
      {!level ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm text-slate-600">Choose the education level first, then pick the subjects.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {options.map((s) => {
            const on = value.includes(s)
            return (
              <button
                key={s} type="button" aria-pressed={on} disabled={!on && full} onClick={() => toggle(s)}
                className={`chip min-h-10 px-3 py-1.5 text-[13px] disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'chip-on' : ''}`}
              >
                {s}
              </button>
            )
          })}
        </div>
      )}
      <p id={`${idPrefix}-help`} className={`mt-1.5 text-xs ${error ? 'font-medium text-red-700' : 'text-slate-600'}`}>
        {error || hint || (full ? `That is the most you can choose (${max}). Tap a subject to remove it.` : `Choose all that apply${value.length ? ` · ${value.length} chosen` : ''}.`)}
      </p>
    </fieldset>
  )
}
