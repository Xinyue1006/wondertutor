// "Book Robot": the AI Tutor Assistant mascot (robot with a graduation cap and a book).
// Drawn as inline SVG so it stays sharp at any size and needs no image file.
export default function Robot({ className = 'h-16 w-16', sparkles = true }) {
  return (
    <svg viewBox="0 0 128 132" className={className} aria-hidden="true">
      {sparkles && (
        <g fill="#ffc83d">
          <path d="M116 14l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
          <path d="M8 52l1.6 4.4L14 58l-4.4 1.6L8 64l-1.6-4.4L2 58l4.4-1.6z" />
          <path d="M112 62l1.2 3.3 3.3 1.2-3.3 1.2-1.2 3.3-1.2-3.3-3.3-1.2 3.3-1.2z" />
        </g>
      )}
      {/* open book */}
      <path d="M10 96q26-9 54 2 28-11 54-2v20q-26-9-54 2-28-11-54-2z" fill="#1a6dff" />
      <path d="M16 97q24-7 48 3 24-10 48-3v13q-24-7-48 3-24-10-48-3z" fill="#fff" />
      <path d="M64 100v13" stroke="#cfe0ff" strokeWidth="2" />
      <path d="M10 116q26-9 54 2 28-11 54-2v5q-26-9-54 2-28-11-54-2z" fill="#ffc83d" />
      {/* body */}
      <rect x="44" y="80" width="40" height="22" rx="11" fill="#e8f1ff" />
      <circle cx="64" cy="91" r="4" fill="#5fd3ff" />
      {/* ears */}
      <rect x="14" y="48" width="12" height="20" rx="6" fill="#1a6dff" />
      <rect x="102" y="48" width="12" height="20" rx="6" fill="#1a6dff" />
      {/* head */}
      <rect x="24" y="30" width="80" height="58" rx="28" fill="#fff" stroke="#cfe0ff" strokeWidth="2" />
      <rect x="33" y="41" width="62" height="38" rx="18" fill="#0b2a6f" />
      <circle cx="50" cy="58" r="6.5" fill="#5fd3ff" />
      <circle cx="78" cy="58" r="6.5" fill="#5fd3ff" />
      <circle cx="52" cy="56" r="2" fill="#fff" />
      <circle cx="80" cy="56" r="2" fill="#fff" />
      <path d="M56 69q8 6 16 0" stroke="#5fd3ff" strokeWidth="3" strokeLinecap="round" fill="none" />
      {/* graduation cap */}
      <path d="M40 30v10q24 10 48 0V30" fill="#12388f" />
      <path d="M64 6l46 18-46 17L18 24z" fill="#0b2a6f" />
      <path d="M64 6l46 18-46 17" fill="none" stroke="#1d4bb5" strokeWidth="1.5" />
      <path d="M104 26v18" stroke="#ffc83d" strokeWidth="3" strokeLinecap="round" />
      <circle cx="104" cy="47" r="4" fill="#ffc83d" />
    </svg>
  )
}
