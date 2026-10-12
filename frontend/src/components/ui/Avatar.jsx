// Round profile photo with an initials fallback (used when a tutor has no photo yet)
const COLORS = ['bg-brand-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500', 'bg-cyan-600']

export default function Avatar({ src, name = '?', className = 'h-10 w-10', rounded = 'rounded-full', text = 'text-sm' }) {
  if (src) return <img src={src} alt={name} className={`${className} ${rounded} shrink-0 object-cover`} />
  const initials = name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const color = COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length]
  return (
    <span className={`${className} ${rounded} ${color} ${text} flex shrink-0 items-center justify-center font-semibold text-white`}>
      {initials}
    </span>
  )
}
