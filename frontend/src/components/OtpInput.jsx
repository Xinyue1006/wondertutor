import { useEffect, useRef } from 'react'

// Six one-digit boxes for an emailed code. Typing moves to the next box, Backspace on an empty box goes back,
// and pasting (or phone autofill into the first box) spreads the whole code across the boxes.
export default function OtpInput({ value, onChange, label = '6-digit code', length = 6 }) {
  const boxes = useRef([])
  // The code as just typed: moving focus happens before React re-renders with the new value
  const latest = useRef(value)
  useEffect(() => { latest.current = value }, [value])
  const change = (next) => {
    latest.current = next
    onChange(next)
  }
  const digits = Array.from({ length }, (_, i) => value[i] || '')

  const focus = (i) => boxes.current[Math.max(0, Math.min(length - 1, i))]?.focus()

  function put(i, text) {
    const clean = text.replace(/\D/g, '')
    if (!clean) return
    const next = (value.slice(0, i) + clean).slice(0, length)
    change(next)
    focus(next.length)
  }

  function onKeyDown(i, e) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[i]) change(value.slice(0, i) + value.slice(i + 1))
      else if (i > 0) {
        change(value.slice(0, i - 1) + value.slice(i))
        focus(i - 1)
      }
    } else if (e.key === 'ArrowLeft') focus(i - 1)
    else if (e.key === 'ArrowRight') focus(i + 1)
  }

  return (
    <div role="group" aria-label={label} className="flex justify-center gap-2">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { boxes.current[i] = el }}
          value={d}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1} of ${length}`}
          autoFocus={i === 0}
          // Only the first empty box (or the last one) is a typing target, so the code is always filled left to right
          onFocus={(e) => { if (i > latest.current.length) focus(latest.current.length); else e.target.select() }}
          // A box that already held a digit now holds two: keep the one just typed
          onChange={(e) => put(i, d && e.target.value.length === 2 ? e.target.value.replace(d, '') || d : e.target.value)}
          onPaste={(e) => { e.preventDefault(); put(0, e.clipboardData.getData('text')) }}
          onKeyDown={(e) => onKeyDown(i, e)}
          className="input h-14 w-12 text-center text-2xl font-bold text-navy"
        />
      ))}
    </div>
  )
}
