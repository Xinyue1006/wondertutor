// Real WonderTutor logo (from the mockups), background removed so it sits on any colour
export default function Logo({ className = 'h-9', mark = false }) {
  return (
    <img
      src={mark ? '/img/art/logo-mark.png' : '/img/art/logo-full.png'}
      alt="WonderTutor"
      className={`w-auto select-none ${className}`}
      draggable="false"
    />
  )
}
