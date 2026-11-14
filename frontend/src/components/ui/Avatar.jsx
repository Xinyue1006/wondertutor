import { useState } from 'react'

// Round profile photo with an initials fallback. The initials are shown when there is no photo, and also when the
// photo address exists but the picture cannot be loaded (deleted, blocked, offline), instead of a broken-image icon.
const COLORS = ['bg-brand-500', 'bg-emerald-500', 'bg-amber-500', 'bg-violet-500', 'bg-rose-500', 'bg-cyan-600']

// The old seed portraits were AI-generated demo assets. Do not show them again when an older
// response still contains their URL; new uploaded photos and Google account photos still work.
const isDemoPortrait = (src) => /^(?:(?:https?:)?\/\/[^/]+)?\/?img\/people\//i.test(src)

export default function Avatar({ src, name = '?', className = 'h-10 w-10', rounded = 'rounded-full', text = 'text-sm' }) {
  const [failedSrc, setFailedSrc] = useState(null)
  // no-referrer: some hosts (Google profile pictures) refuse images requested from another site's page
  if (src && !isDemoPortrait(src) && src !== failedSrc) return <img src={src} alt={name} referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} className={`${className} ${rounded} shrink-0 object-cover`} />
  const initials = name.replace(/^(Mr|Ms|Mrs|Dr)\.?\s+/i, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const color = COLORS[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % COLORS.length]
  return (
    <span aria-label={name} title={name} className={`${className} ${rounded} ${color} ${text} flex shrink-0 items-center justify-center font-semibold text-white`}>
      {initials}
    </span>
  )
}
