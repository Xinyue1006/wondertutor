import { useEffect, useId, useState } from 'react'
import Icon from './ui/Icon'
import { COUNTRIES, hasForbiddenCharacters, joinPhone, splitPhone } from '../lib/phone'

// Phone box with a country-code dropdown (Malaysia +60 first) and the number beside it.
// `value` and `onChange` use the full international form ("+60123456789"), which is what the server stores, so the
// parent form never has to think about countries. A leading 0 ("012-345 6789") is accepted and removed for you.
export default function PhoneInput({ label = 'Phone number', value, onChange, onBlur, error, hint, required = false, disabled = false }) {
  const id = useId()
  const start = splitPhone(value)
  const [country, setCountry] = useState(start.country)
  const [national, setNational] = useState(start.national)

  // The form loaded or was reset from outside: show that number. A change made by typing here is not "outside".
  useEffect(() => {
    if (value !== joinPhone(country, national)) {
      const next = splitPhone(value)
      setCountry(next.country)
      setNational(next.national)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const pickCountry = (iso) => {
    const next = COUNTRIES.find((c) => c.iso === iso)
    setCountry(next)
    onChange(joinPhone(next, national))
  }
  const type = (text) => {
    setNational(text)
    onChange(joinPhone(country, text))
  }

  // Said at once, while typing, so nobody wonders why a number with letters in it is not accepted
  const letters = hasForbiddenCharacters(national)
  const shown = error || (letters ? 'Use numbers only, for example ' + country.example + '.' : '')

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold text-navy">
        {label}{required && <span className="text-red-700" aria-hidden="true"> *</span>}
      </label>
      <div className="flex gap-2">
        {/* The visible box shows the short "MY +60"; the real <select> sits on top, invisible, and lists country names */}
        <div className={`relative flex h-11 w-[6.75rem] shrink-0 items-center justify-between rounded-lg border bg-white px-3 text-sm font-semibold text-navy focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-500/30 ${shown ? 'border-red-500' : 'border-slate-300'} ${disabled ? 'opacity-60' : ''}`}>
          <span><span className="mr-1.5 rounded bg-brand-50 px-1 text-[10px] font-bold text-brand-700">{country.iso}</span>+{country.dial}</span>
          <Icon name="down" className="h-4 w-4 text-slate-500" />
          <select
            aria-label="Country code" value={country.iso} disabled={disabled} onChange={(e) => pickCountry(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          >
            {COUNTRIES.map((c) => <option key={c.iso} value={c.iso}>{c.name} (+{c.dial})</option>)}
          </select>
        </div>
        <input
          id={id} type="tel" inputMode="tel" autoComplete="tel-national" disabled={disabled} data-field="phone"
          className="input h-11" placeholder={country.example} value={national} onChange={(e) => type(e.target.value)} onBlur={onBlur}
          aria-invalid={shown ? true : undefined} aria-describedby={shown ? `${id}-error` : `${id}-hint`}
        />
      </div>
      {shown ? (
        <p id={`${id}-error`} className="mt-1 flex items-center gap-1.5 text-sm font-medium text-red-700">
          <Icon name="info" className="h-4 w-4 shrink-0" /> {shown}
        </p>
      ) : (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-600">{hint || `Example: ${country.example}`}</p>
      )}
    </div>
  )
}
