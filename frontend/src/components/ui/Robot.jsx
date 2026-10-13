// "Book Robot": the AI Tutor Assistant mascot (robot with a graduation cap and a book), from the brand assets.
// `sparkles` is kept as a prop for older call sites; the artwork already includes its own sparkles.
export default function Robot({ className = 'h-16 w-16' }) {
  return <img src="/img/art/robot.png" alt="" aria-hidden="true" draggable="false" className={`${className} select-none object-contain`} />
}
