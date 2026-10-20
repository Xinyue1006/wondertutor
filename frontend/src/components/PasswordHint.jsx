// Strength bar and the password rule under a new-password field. The rule is the one the server enforces
// (checkPassword in lib/validation.js: 8-72 characters with a letter and a number); the bar only encourages a longer mix.
export default function PasswordHint({ value }) {
  const s = value || ''
  const valid = s.length >= 8 && s.length <= 72 && /[A-Za-z]/.test(s) && /\d/.test(s)
  const extras = [s.length >= 12, /[a-z]/.test(s) && /[A-Z]/.test(s), /[^A-Za-z0-9]/.test(s)].filter(Boolean).length
  const level = !s ? 0 : !valid ? 1 : extras === 0 ? 2 : extras === 1 ? 3 : 4
  const [word, colour] = [['', ''], ['Too weak', 'bg-red-500'], ['OK', 'bg-accent-600'], ['Good', 'bg-brand-500'], ['Strong', 'bg-ok']][level]
  return (
    <div className="mt-1.5">
      <div className="h-1.5 rounded-full bg-slate-100" aria-hidden="true">
        <div className={`h-1.5 rounded-full transition-all ${colour}`} style={{ width: `${level * 25}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-600">
        {word && <b className="text-navy">{word} · </b>}8 to 72 characters, with a letter and a number
      </p>
    </div>
  )
}
